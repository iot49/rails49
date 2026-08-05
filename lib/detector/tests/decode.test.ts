import { describe, expect, it } from 'vitest';
import { decodeDetections } from '../src/decode.ts';
import { gridToReport, letterbox } from '../src/letterbox.ts';

/**
 * The decode, driven by hand-built tensors.
 *
 * Nothing here needs a model file, which is the point: a wrong field offset, an
 * unswapped axis or a forgotten letterbox bar is arithmetic, and arithmetic can
 * be pinned. What a model file would add is confidence that the *weights* are
 * good, which is a question `bin/test.sh` deliberately does not ask.
 */

const GRID = { width: 960, height: 544 };

/** One `[1, slots, 7]` buffer, from `(cx, cy, w, h, score, class, angle)` rows. */
function tensor(rows: number[][], slots = rows.length): Float32Array {
  const data = new Float32Array(slots * 7);
  rows.forEach((row, i) => data.set(row, i * 7));
  return data;
}

const dims = (slots: number) => [1, slots, 7];

describe('the output tensor', () => {
  it("is rejected unless it is the end2end head's [1, n, 7]", () => {
    const map = gridToReport(GRID, GRID, GRID);
    expect(() => decodeDetections(tensor([]), [1, 300, 6], map, 0.25)).toThrow(/end2end/);
    expect(() => decodeDetections(tensor([]), [300, 7], map, 0.25)).toThrow(/end2end/);
  });

  it('drops the padding slots the fixed-size buffer is mostly made of', () => {
    // 300 slots, one car. Thresholding is decoding, not filtering: a caller
    // that received all 300 would have 299 phantoms, not a rawer L0.
    const data = tensor([[480, 272, 200, 42, 0.9, 0, 0]], 300);
    const detections = decodeDetections(data, dims(300), gridToReport(GRID, GRID, GRID), 0.25);
    expect(detections).toHaveLength(1);
  });

  it('cuts strictly above the threshold, as export_onnx.py does', () => {
    const data = tensor([
      [480, 272, 200, 42, 0.25, 0, 0],
      [480, 272, 200, 42, 0.2500001, 0, 0],
    ]);
    // The buffer is float32, so the survivor is identified by being the one
    // above the cut rather than by an exact decimal that never survives the
    // round trip.
    const detections = decodeDetections(data, dims(2), gridToReport(GRID, GRID, GRID), 0.25);
    expect(detections).toHaveLength(1);
    expect(detections[0].confidence).toBeGreaterThan(0.25);
  });

  it('honours a lower threshold, so diagnostics can see what was cut', () => {
    const data = tensor([[480, 272, 200, 42, 0.1, 0, 0]]);
    expect(decodeDetections(data, dims(1), gridToReport(GRID, GRID, GRID), 0.25)).toHaveLength(0);
    expect(decodeDetections(data, dims(1), gridToReport(GRID, GRID, GRID), 0.05)).toHaveLength(1);
  });

  it('refuses a class index the config does not have', () => {
    // The weights and config.yaml having drifted apart puts every box's
    // identity in doubt; DETECTOR_CLASSES is append-only precisely so this
    // cannot happen quietly.
    const data = tensor([[480, 272, 200, 42, 0.9, 7, 0]]);
    expect(() =>
      decodeDetections(data, dims(1), gridToReport(GRID, GRID, GRID), 0.25)
    ).toThrow(/class index 7/);
  });
});

describe('a decoded detection', () => {
  it('comes out in grid pixels when the report frame is the grid', () => {
    const data = tensor([[480, 272, 200, 42, 0.87, 0, 0]]);
    const [car] = decodeDetections(data, dims(1), gridToReport(GRID, GRID, GRID), 0.25);

    expect(car.centre.x).toBeCloseTo(480, 9);
    expect(car.centre.y).toBeCloseTo(272, 9);
    expect(car.length).toBeCloseTo(200, 9);
    expect(car.width).toBeCloseTo(42, 9);
    expect(car.angle).toBeCloseTo(0, 9);
    expect(car.class).toBe('stock');
    expect(car.confidence).toBeCloseTo(0.87, 6);
  });

  it('names the long axis `length`, whichever axis the head put it on', () => {
    // The head emits extents along its own rotated axes and does not promise
    // the longer one is `w`. A car reported 42 long and 200 wide would make
    // every downstream box a quarter turn wrong and stubbier than the car.
    const data = tensor([[480, 272, 42, 200, 0.9, 0, 0]]);
    const [car] = decodeDetections(data, dims(1), gridToReport(GRID, GRID, GRID), 0.25);

    expect(car.length).toBeCloseTo(200, 9);
    expect(car.width).toBeCloseTo(42, 9);
    expect(car.angle).toBeCloseTo(Math.PI / 2, 9);
  });

  it('carries its angle through in radians from +x', () => {
    // Six places, not more: the tensor is float32, so π/6 loses its last digits
    // on the way in. What is being pinned is that the angle arrives, not that
    // the buffer is lossless.
    const data = tensor([[480, 272, 200, 42, 0.9, 0, Math.PI / 6]]);
    const [car] = decodeDetections(data, dims(1), gridToReport(GRID, GRID, GRID), 0.25);
    expect(car.angle).toBeCloseTo(Math.PI / 6, 6);
  });
});

describe('the report frame', () => {
  it('undoes the letterbox bars a 2.08:1 source is padded with', () => {
    // The intended capture geometry: one camera over the whole layout. 4440x2130
    // into a 960x544 grid scales by 960/4440, leaving ~42 px bars top and bottom
    // — a box's y is meaningless until they come off.
    const source = { width: 4440, height: 2130 };
    const fit = letterbox(source, GRID);
    expect(fit.padX).toBeCloseTo(0, 9);
    expect(fit.padY).toBeGreaterThan(40);

    // A detection at the exact centre of the grid is the exact centre of the
    // source, whatever the bars.
    const data = tensor([[480, 272, 200, 42, 0.9, 0, 0]]);
    const [car] = decodeDetections(data, dims(1), gridToReport(source, GRID, source), 0.25);
    expect(car.centre.x).toBeCloseTo(source.width / 2, 6);
    expect(car.centre.y).toBeCloseTo(source.height / 2, 6);

    // And a detection sitting on the top bar's inner edge maps to y = 0 — to
    // within the float32 the bar's own height survives the tensor as.
    const edge = tensor([[480, fit.padY, 200, 42, 0.9, 0, 0]]);
    const [atTop] = decodeDetections(edge, dims(1), gridToReport(source, GRID, source), 0.25);
    expect(atTop.centre.y).toBeCloseTo(0, 4);
  });

  it('scales lengths by the same factor as positions', () => {
    // A source scaled 1/4 into the grid must give back a box 4x the grid size.
    const source = { width: 3840, height: 2176 };
    const data = tensor([[480, 272, 200, 42, 0.9, 0, 0]]);
    const [car] = decodeDetections(data, dims(1), gridToReport(source, GRID, source), 0.25);

    expect(car.length).toBeCloseTo(800, 6);
    expect(car.width).toBeCloseTo(168, 6);
  });

  it('answers in camera.resolution even when the capture is a different size', () => {
    // What rr-live-view has been doing by hand: the phone hands over 1280x720,
    // the layout's sensors and labels are authored at 1920x1080.
    const source = { width: 1280, height: 720 };
    const report = { width: 1920, height: 1080 };
    const data = tensor([[480, 272, 200, 42, 0.9, 0, Math.PI / 3]]);

    const [car] = decodeDetections(data, dims(1), gridToReport(source, GRID, report), 0.25);
    const [same] = decodeDetections(data, dims(1), gridToReport(report, GRID, report), 0.25);

    // Same scene, same frame to answer in — so the pixel count it arrived at
    // must not change the answer.
    expect(car.centre.x).toBeCloseTo(same.centre.x, 6);
    expect(car.centre.y).toBeCloseTo(same.centre.y, 6);
    expect(car.length).toBeCloseTo(same.length, 6);
    expect(car.angle).toBeCloseTo(same.angle, 9);
  });
});

describe('duplicate suppression (#107)', () => {
  const map = () => gridToReport(GRID, GRID, GRID);

  it('keeps only the most confident of several boxes on one car', () => {
    // What the shipped model actually emits. Measured across the fixture
    // corpus: 130 boxes over 87 distinct vehicles at fp32, 139 over 89 at
    // INT8 — up to four boxes on one car. `end2end`'s TopK selects the top 300
    // slots; it suppresses nothing.
    const data = tensor([
      [480, 270, 200, 40, 0.55, 0, 0],
      [484, 271, 205, 41, 0.83, 0, 0.02],
      [477, 269, 198, 39, 0.46, 0, -0.01],
    ]);

    const detections = decodeDetections(data, dims(3), map(), 0.25);

    expect(detections).toHaveLength(1);
    expect(detections[0].confidence).toBeCloseTo(0.83, 6);
  });

  it('keeps both cars of a coupling, which abut rather than overlap', () => {
    // The case suppression must never eat. Coupled cars share an endpoint, so
    // their rectangles touch along one edge and score ~0 against each other —
    // which is why 0.5 is safe here where a general-purpose default would not
    // have to be.
    const data = tensor([
      [400, 270, 200, 40, 0.8, 0, 0],
      [600, 270, 200, 40, 0.7, 0, 0],
    ]);

    const detections = decodeDetections(data, dims(2), map(), 0.25);

    expect(detections).toHaveLength(2);
    expect(detections.map(d => Math.round(d.centre.x)).sort((a, b) => a - b)).toEqual([400, 600]);
  });

  it('keeps two cars on parallel tracks, side by side', () => {
    // Across the axis rather than along it: adjacent sidings put two cars a
    // track apart with no overlap at all.
    const data = tensor([
      [480, 200, 200, 40, 0.8, 0, 0],
      [480, 300, 200, 40, 0.7, 0, 0],
    ]);

    expect(decodeDetections(data, dims(2), map(), 0.25)).toHaveLength(2);
  });

  it('returns survivors in confidence order', () => {
    // The raw decode was slot-ordered; slot order carries no meaning, and the
    // sort suppression needs anyway is a better one to expose.
    const data = tensor([
      [200, 200, 100, 40, 0.4, 0, 0],
      [500, 200, 100, 40, 0.9, 0, 0],
      [800, 200, 100, 40, 0.6, 0, 0],
    ]);

    const detections = decodeDetections(data, dims(3), map(), 0.25);

    expect(detections.map(d => d.confidence)).toEqual([0.9, 0.6, 0.4].map(v => expect.closeTo(v, 6)));
  });

  it('suppresses after thresholding, never before', () => {
    // A high-scoring box must not be suppressed by one that never survived the
    // confidence cut — that would drop a real car on the say-so of noise.
    const data = tensor([
      [480, 270, 200, 40, 0.30, 0, 0],
      [482, 270, 200, 40, 0.10, 0, 0],
    ]);

    const detections = decodeDetections(data, dims(2), map(), 0.25);

    expect(detections).toHaveLength(1);
    expect(detections[0].confidence).toBeCloseTo(0.3, 6);
  });
});
