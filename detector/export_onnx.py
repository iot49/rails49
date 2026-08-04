"""Take trained weights to the artifact the browser loads: `.pt` → ONNX → static-INT8 → `.ort`.

Three conversions, each of which can fail in a way the next stage would hide:

1. **ONNX export at `detector.input`.** The rectangular 960x544 shape is applied
   here, not during training — this is the graph that gets deployed. `nms=False`
   still yields final detections, because YOLO26's `end2end` head does the
   300-detection selection *inside* the graph with `TopK`. That is what keeps a
   rotated-NMS implementation out of the browser.
2. **Static INT8 quantization.** Static, never dynamic: dynamic emits
   `ConvInteger`, which the ORT CPU provider does not implement, so the model
   quantizes fine and then refuses to load. Static emits `QLinearConv`, which it
   does. Calibration data is therefore mandatory, and the corpus is its own
   calibration set.
3. **`.ort` conversion**, the format `onnxruntime-web` loads.

All three were verified end-to-end on the released DOTA weights during the
feasibility research (issue #3); this script is that path, run on trained
weights instead. Expect ~3.3 MiB out.

Usage:
    uv run python export_onnx.py [--weights runs/tracer/weights/best.pt]
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path
from typing import cast

import numpy as np
import onnx
import onnxruntime as ort
import yaml
from onnxruntime.quantization import (
    CalibrationDataReader,
    QuantFormat,
    QuantType,
    quantize_static,
)
from PIL import Image
from ultralytics import YOLO

from letterbox import letterboxed

HERE = Path(__file__).parent
REPO = HERE.parent


def _detector_config() -> dict:
    return yaml.safe_load((REPO / "config.yaml").read_text())["detector"]


def detector_input() -> tuple[int, int]:
    """`detector.input` from config.yaml, as `(width, height)`."""
    width, height = _detector_config()["input"]
    return int(width), int(height)


def confidence_threshold() -> float:
    """`detector.confidence_threshold` — the score below which a slot is padding."""
    return float(_detector_config()["confidence_threshold"])


class FrameCalibrationReader(CalibrationDataReader):
    """Feeds real frames through the quantizer to fix its activation ranges.

    Real frames, not noise: static quantization picks per-tensor scales from
    observed activations, so calibrating on anything that does not look like the
    deployment distribution sets the ranges wrong and costs accuracy silently.
    The exported training images are exactly the right distribution and cost
    nothing to reuse.
    """

    def __init__(
        self, images: list[Path], width: int, height: int, input_name: str
    ) -> None:
        self._input_name = input_name
        self._batches = iter(
            [{input_name: self._preprocess(path, width, height)} for path in images]
        )

    @staticmethod
    def _preprocess(path: Path, width: int, height: int) -> np.ndarray:
        # Letterbox, matching `loadDetector`'s browser path exactly — the
        # quantizer fixes its activation ranges on whatever geometry it is shown,
        # so a frame preprocessed differently from the deployed one calibrates the
        # model for a distribution it will never be given. Worth 2 px per edge on
        # today's 1920x1080 corpus; worth 42 px bars at the intended capture
        # geometry (~4440x2130, aspect 2.08:1). See issue #100.
        image = letterboxed(Image.open(path).convert("RGB"), (width, height))
        array = np.asarray(image, dtype=np.float32) / 255.0
        return np.transpose(array, (2, 0, 1))[np.newaxis, ...]

    # `None` is how the reader signals exhaustion — ORT's consumer loop breaks on
    # a falsy return. Its own base class annotates `-> dict` and so cannot
    # express that; the runtime contract is the documented one, not the stub.
    def get_next(self) -> dict[str, np.ndarray] | None:  # type: ignore[override]
        return next(self._batches, None)


def calibration_images(limit: int) -> list[Path]:
    """Frames from the exported training split, deterministically ordered."""
    root = REPO / "dataset" / "yolo" / "images" / "train"
    images = sorted(
        p for p in root.glob("*") if p.suffix.lower() in {".jpg", ".jpeg", ".png"}
    )
    if not images:
        raise SystemExit(
            f"no calibration images under {root}. Export the dataset first:\n"
            f"    pnpm --filter dataset run export:yolo\n"
        )
    return images[:limit]


def main() -> None:
    width, height = detector_input()

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--weights", type=Path, default=HERE / "runs" / "tracer" / "weights" / "best.pt"
    )
    parser.add_argument("--out", type=Path, default=HERE / "models")
    parser.add_argument(
        "--calibration-frames",
        type=int,
        default=10,
        help="Ten sufficed in the #3 research; more costs quantization time for little gain.",
    )
    args = parser.parse_args()

    if not args.weights.exists():
        raise SystemExit(
            f"{args.weights} does not exist. Train first: uv run python train.py"
        )

    args.out.mkdir(parents=True, exist_ok=True)

    # 1. ONNX. imgsz is (height, width) here — Ultralytics takes rows first.
    print(f"→ ONNX at {width}x{height}")
    exported = Path(
        YOLO(str(args.weights)).export(
            format="onnx",
            imgsz=[height, width],
            simplify=True,
            batch=1,
            nms=False,
            half=False,
            dynamic=False,
        )
    )
    fp32 = args.out / "detector.onnx"
    shutil.move(str(exported), fp32)
    print(f"   {fp32.name}  {fp32.stat().st_size / 1024 / 1024:.2f} MiB")

    # 2. Static INT8.
    input_name = (
        ort.InferenceSession(str(fp32), providers=["CPUExecutionProvider"])
        .get_inputs()[0]
        .name
    )
    frames = calibration_images(args.calibration_frames)
    print(f"→ static INT8, calibrating on {len(frames)} frames")

    int8 = args.out / "detector_int8.onnx"
    quantize_static(
        model_input=str(fp32),
        model_output=str(int8),
        calibration_data_reader=FrameCalibrationReader(
            frames, width, height, input_name
        ),
        quant_format=QuantFormat.QDQ,
        activation_type=QuantType.QInt8,
        weight_type=QuantType.QInt8,
        per_channel=True,
        # Convolutions only, and this is load-bearing — quantizing the whole
        # graph produces a model that loads, runs, and returns the right shape
        # with **every score zero**.
        #
        # The head's last `Concat` fuses box coordinates (0..960) with scores
        # (0..1) into one output tensor. One activation scale has to cover both,
        # it gets sized for the coordinates, and the entire score range collapses
        # into the zero bucket. Nothing errors: you get 300 detections at
        # confidence 0.0, which reads as "detects nothing".
        #
        # Restricting quantization to `Conv` leaves the head's tensor plumbing in
        # float and costs ~0.5 px of centre agreement against fp32. Excluding the
        # head by node name works equally well, but silently degrades to
        # quantizing everything if Ultralytics ever renumbers its layers — this
        # does not depend on any naming convention.
        op_types_to_quantize=["Conv"],
    )
    print(f"   {int8.name}  {int8.stat().st_size / 1024 / 1024:.2f} MiB")

    # 3. .ort — the format onnxruntime-web loads.
    print("→ .ort")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "onnxruntime.tools.convert_onnx_models_to_ort",
            str(int8),
            "--output_dir",
            str(args.out),
            "--optimization_style",
            "Fixed",
        ],
        check=True,
    )

    ort_file = args.out / "detector_int8.ort"
    if not ort_file.exists():
        produced = sorted(p.name for p in args.out.glob("*.ort"))
        raise SystemExit(f"expected {ort_file.name}; the converter produced {produced}")

    size = ort_file.stat().st_size
    print(f"   {ort_file.name}  {size / 1024 / 1024:.2f} MiB")

    # 4. Run both models and compare what they detect.
    #
    # Every cheaper check passes on a model that detects nothing. Loading it
    # succeeds, running it succeeds, and the output shape is exactly right — the
    # scores are just all zero. So the check has to be against the fp32 model's
    # actual detections, on a real frame, or it does not catch the failure mode
    # this pipeline has already hit once.
    print("→ verifying")
    threshold = confidence_threshold()
    batch = [FrameCalibrationReader._preprocess(path, width, height) for path in frames]

    def detections(model: Path) -> int:
        """Detections above the confidence threshold across every probe frame."""
        session = ort.InferenceSession(str(model), providers=["CPUExecutionProvider"])
        total = 0
        for frame in batch:
            # ORT annotates `run` as returning any of several container types; on
            # a dense float graph it is a list of arrays.
            outputs = cast(list[np.ndarray], session.run(None, {input_name: frame}))
            result = outputs[0]

            # [1, 300, 7] is YOLO26's NMS-free head: 300 candidate slots, each
            # (cx, cy, w, h, score, class, angle). Its survival through a
            # *rectangular* export is not a given, and it is what keeps a
            # rotated-NMS stage out of the browser — asserted, not assumed.
            if result.shape != (1, 300, 7):
                raise SystemExit(
                    f"{model.name}: expected the end2end head's (1, 300, 7) output, "
                    f"got {result.shape}. A JS-side NMS stage would now be required."
                )
            total += int((result[0][:, 4] > threshold).sum())
        return total

    # Across every probe frame, not one: a single frame can legitimately hold one
    # car, and "1 vs 1" is too little signal to tell a working model from a lucky
    # one.
    reference = detections(fp32)
    quantized = detections(int8)
    print(
        f"   {len(batch)} frames: fp32 {reference} detections, int8 {quantized} "
        f"(≥{threshold} confidence)"
    )

    if reference == 0:
        raise SystemExit(
            f"the fp32 model finds nothing in any of the {len(batch)} probe frames, so "
            f"there is nothing to check the quantized model against. Suspect the "
            f"training run, not the export."
        )
    # Quantization moves scores around the threshold, so a couple either way is
    # normal and a collapse is not subtle — the broken model scored exactly zero
    # on all 300 slots.
    if quantized < reference / 2:
        raise SystemExit(
            f"quantization lost {1 - quantized / reference:.0%} of the detections. See "
            f"the `op_types_to_quantize` comment above: this is what quantizing the "
            f"head's output Concat does."
        )
    print(f"   opset {onnx.load(str(int8)).opset_import[0].version}")

    # Cloudflare Pages rejects anything over 25 MiB, which is the constraint
    # that shapes this whole path. Checked here rather than at deploy time so a
    # bad export is caught where it is made.
    ceiling = 25 * 1024 * 1024
    verdict = "under" if size < ceiling else "OVER — will not deploy"
    print(
        f"\n{ort_file.name}: {size:,} bytes, {size / ceiling:.0%} of the 25 MiB ceiling ({verdict})"
    )


if __name__ == "__main__":
    main()
