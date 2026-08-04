import { DETECTOR_CLASSES } from '@occupancy/config';
import { mapPoint, mapVector, type GridToReport } from './letterbox.ts';
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
        `A JS-side NMS stage would now be required.`
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

  return detections;
}
