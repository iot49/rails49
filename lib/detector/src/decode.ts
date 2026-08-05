import { DETECTOR_CLASSES, DETECTOR_NMS_IOU } from '@occupancy/config';
import { mapPoint, mapVector, type GridToReport } from './letterbox.ts';
import { boxCorners } from './geometry.ts';
import { polygonIoU } from './overlap.ts';
import type { Detection } from './types.ts';

/** Fields per slot in the end2end head's output: `(cx, cy, w, h, score, class, angle)`. */
const STRIDE = 7;

/**
 * Turn the model's raw output tensor into L0 detections in the report frame.
 *
 * Separated from the ORT session so it can be driven by synthetic tensors: a
 * decode is where a wrong index or an unswapped axis hides, and none of that
 * needs a model file to catch. `browser.ts` supplies the real tensor; the tests
 * supply hand-built ones.
 *
 * **Thresholding happens here, not downstream.** The export is `end2end: True`
 * with a fixed 300-slot buffer emitted every frame, mostly padding, so a
 * caller who skipped the cut would receive 300 phantom cars rather than an
 * unfiltered L0. SPEC calls this decoding, not filtering, for exactly that
 * reason — there is no version of L0 that skips it.
 *
 * @param data  The flat output buffer, `[1, slots, 7]` in model-grid pixels.
 * @param dims  Its dimensions, as ORT reports them.
 * @param map   Grid → report frame, from `gridToReport`.
 * @param minConfidence Scores must exceed this, matching `export_onnx.py`'s
 *              strict `>` so the two agree on what a detection is.
 * @throws If the tensor is not the end2end head's `[1, n, 7]`, or if a slot
 *         names a class index outside `DETECTOR_CLASSES`. Both mean the model
 *         and the config have drifted apart, which puts every box somewhere
 *         wrong — loudly wrong beats subtly wrong.
 */
export function decodeDetections(
  data: Float32Array,
  dims: readonly number[],
  map: GridToReport,
  minConfidence: number
): Detection[] {
  if (dims.length !== 3 || dims[0] !== 1 || dims[2] !== STRIDE) {
    throw new Error(
      `expected the end2end head's [1, n, ${STRIDE}] output, got [${dims.join(', ')}]. ` +
        `The suppression below assumes that layout.`
    );
  }

  const slots = dims[1];
  const detections: Detection[] = [];

  for (let slot = 0; slot < slots; slot++) {
    const base = slot * STRIDE;
    const confidence = data[base + 4];
    if (!(confidence > minConfidence)) continue;

    const classIndex = Math.round(data[base + 5]);
    const className = DETECTOR_CLASSES[classIndex];
    if (className === undefined) {
      throw new Error(
        `detection ${slot} names class index ${classIndex}, but the model was ` +
          `built against ${DETECTOR_CLASSES.length} class(es): ` +
          `[${DETECTOR_CLASSES.join(', ')}]. The weights and config.yaml disagree.`
      );
    }

    // The head emits the box's extents along its own rotated axes, and does not
    // promise the longer one is `w`. `length` is defined as the long axis, so
    // where it is not, swap the extents and turn the angle a quarter turn —
    // the same rectangle, named the way L1 and the drawing code expect.
    const w = data[base + 2];
    const h = data[base + 3];
    const upright = w >= h;
    const length = upright ? w : h;
    const width = upright ? h : w;
    const angle = data[base + 6] + (upright ? 0 : Math.PI / 2);

    // Map the long axis by its endpoints rather than mapping centre, length and
    // angle separately: under the report map an endpoint pair transforms
    // exactly, so centre, length and orientation all fall out of it and stay
    // mutually consistent even when the report frame's aspect differs from the
    // source's. The short axis has no such handle — a rectangle is not one
    // after an anisotropic map — so its half-vector is mapped and measured,
    // which is exact whenever the two aspects agree, i.e. always in practice.
    const half = length / 2;
    const e0 = mapPoint(map, data[base] - Math.cos(angle) * half, data[base + 1] - Math.sin(angle) * half);
    const e1 = mapPoint(map, data[base] + Math.cos(angle) * half, data[base + 1] + Math.sin(angle) * half);
    const across = mapVector(map, -Math.sin(angle) * width, Math.cos(angle) * width);

    detections.push({
      centre: { x: (e0.x + e1.x) / 2, y: (e0.y + e1.y) / 2 },
      length: Math.hypot(e1.x - e0.x, e1.y - e0.y),
      width: Math.hypot(across.x, across.y),
      angle: Math.atan2(e1.y - e0.y, e1.x - e0.x),
      class: className,
      confidence,
    });
  }

  return suppressDuplicates(detections);
}

/**
 * Drop every box that is a second opinion about a car already accounted for.
 *
 * **The graph does not do this, contrary to what the export long assumed**
 * (issue #107). `end2end`'s `TopK` selects the 300 highest-scoring slots and
 * suppresses nothing, so the head routinely emits two, three or four boxes on
 * one vehicle. Measured across the fixture corpus: 130 boxes over 87 distinct
 * vehicles at fp32, 139 over 89 at INT8 — quantization is not the cause, the
 * premise was simply wrong.
 *
 * It belongs here rather than downstream because L0 is defined as *every car
 * the model found* (`SPEC.md` § Occupancy Output), and a list naming one car
 * four times is not that. The same reasoning already puts thresholding here.
 *
 * Greedy by descending confidence, the standard construction: take the best
 * box, drop everything overlapping it beyond `DETECTOR_NMS_IOU`, repeat.
 *
 * **Class-agnostic**, and deliberately: `DETECTOR_CLASSES` holds one entry, and
 * two boxes on one vehicle disagreeing about its class is exactly the case
 * worth collapsing to the more confident answer rather than reporting twice.
 * Revisit if the vocabulary ever grows classes that legitimately nest.
 *
 * The result is **confidence-ordered**, where the raw decode was slot-ordered.
 * Slot order carries no meaning, and the survivors come out of the sort this
 * needs anyway; nothing downstream depended on the old order.
 */
function suppressDuplicates(detections: readonly Detection[]): Detection[] {
  // Corners once per box, not once per comparison: this runs per frame in the
  // live view, and the polygon clip is the expensive part.
  const ranked = detections
    .map(detection => ({ detection, corners: boxCorners(detection) }))
    .sort((a, b) => b.detection.confidence - a.detection.confidence);

  const kept: { detection: Detection; corners: readonly { x: number; y: number }[] }[] = [];
  for (const candidate of ranked) {
    const duplicate = kept.some(
      winner => polygonIoU(candidate.corners, winner.corners) > DETECTOR_NMS_IOU
    );
    if (!duplicate) kept.push(candidate);
  }

  return kept.map(entry => entry.detection);
}
