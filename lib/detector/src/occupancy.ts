import type { Sensor } from '@occupancy/r49';
import { carWidthPx, covers } from './geometry.ts';
import type { Detection, Frame, SensorState } from './types.ts';

/**
 * L1: per-sensor occupancy, as a pure function of L0.
 *
 * Never calls a second model, so it cannot contradict the boxes drawn beside
 * it, needs no second inference, and costs the same whether a layout has three
 * sensors or three hundred — the detector runs once per frame regardless.
 *
 * **Total**: one entry per sensor, always. `detections` and `dpt` are nullable
 * because three of SPEC's `unknown` causes are conditions of the *system*, not
 * of the geometry, and folding them in here is what stops the live view and the
 * diagnostics view from each building unknown-maps in their own branches —
 * three places that would have to agree about a contract SPEC wrote once.
 *
 * The box tested is **width-normalized**: centre, orientation and length come
 * from the detector, but `carWidthPx(dpt)` replaces the predicted width. Width
 * is a fit to a constant, so its deviation is pure error and directional: at
 * DPT 20 a car is ~42 px wide, so a centreline sensor sits ~21 px inside the
 * boundary, and an under-predicted 25 px width cuts that to ~12 px and can flip
 * a covered sensor to `clear`. Substituting the constant only ever widens an
 * under-predicted box, which is the safe direction. L0 still reports the raw
 * box — and the `Detection` returned on `occupied` is the raw one.
 *
 * @param input.detections L0 for this frame, or `null` when no model is loaded.
 * @param input.sensors    The layout's sensors, in `frame` coordinates.
 * @param input.dpt        Resolution in dots per track, or `null` when the
 *                         layout is uncalibrated.
 * @param input.frame      The frame sensors and detections are expressed in —
 *                         `camera.resolution`, normally.
 */
export function occupancy(input: {
  detections: readonly Detection[] | null;
  sensors: readonly Sensor[];
  dpt: number | null;
  frame: Frame;
}): ReadonlyMap<string, SensorState> {
  const { detections, sensors, dpt, frame } = input;
  const states = new Map<string, SensorState>();

  // Precedence: the two whole-system conditions first, then the per-sensor one.
  // A sensor outside the frame of a layout with no model loaded is unanswerable
  // for both reasons; reporting the system-wide cause is the one that tells a
  // human what to fix.
  if (detections === null) {
    for (const sensor of sensors) states.set(sensor.id, unknown('no-model'));
    return states;
  }
  if (dpt === null) {
    for (const sensor of sensors) states.set(sensor.id, unknown('no-calibration'));
    return states;
  }

  const widthPx = carWidthPx(dpt);

  for (const sensor of sensors) {
    if (sensor.x < 0 || sensor.x > frame.width || sensor.y < 0 || sensor.y > frame.height) {
      states.set(sensor.id, unknown('outside-frame'));
      continue;
    }

    // Where several boxes cover the point the highest-confidence one wins, per
    // SPEC. Every covering detection makes the sensor `occupied` — including
    // low-confidence ones; the threshold was already applied during decoding,
    // and `unknown` is never a confidence outcome.
    let best: Detection | null = null;
    for (const detection of detections) {
      if (!covers(detection, widthPx, sensor)) continue;
      if (best === null || detection.confidence > best.confidence) best = detection;
    }

    states.set(sensor.id, best === null ? { state: 'clear' } : { state: 'occupied', detection: best });
  }

  return states;
}

function unknown(reason: 'no-model' | 'no-calibration' | 'outside-frame'): SensorState {
  return { state: 'unknown', reason };
}
