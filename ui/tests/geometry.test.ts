import { describe, it, expect } from 'vitest';
import type { CalibrationPoint, CarLabel, Sensor } from '@occupancy/r49';
import { STANDARD_GAUGE, STANDARD_WIDTH } from '@occupancy/config';
import {
  carWidthPx,
  carCorners,
  dragHandles,
  dragTo,
  estimateLabelWidthPx,
  hitTest,
  isClick,
  placeLabel,
} from '../src/geometry.js';
import type { HitScene, HitTolerance } from '../src/geometry.js';

function car(id: string, p0: { x: number; y: number }, p1: { x: number; y: number }): CarLabel {
  return { id, class: 'stock', p0, p1, provenance: 'human' };
}

function sensor(id: string, x: number, y: number): Sensor {
  return { id, x, y };
}

function calibrationPoint(x: number, y: number): CalibrationPoint {
  return { px: { x, y }, world: { x: 0, y: 0, z: 0 } };
}

const emptyScene: HitScene = { cars: [], sensors: [], calibrationPoints: [] };

/** 10 image pixels of grab radius: 5 screen px at 2 image px per screen px. */
const tolerance: HitTolerance = { screenPx: 5, imagePxPerScreenPx: 2 };

describe('carWidthPx', () => {
  it('is DPT x STANDARD_WIDTH / STANDARD_GAUGE', () => {
    expect(carWidthPx(20)).to.be.closeTo((20 * STANDARD_WIDTH) / STANDARD_GAUGE, 1e-9);
  });

  it('is 2.09 track widths at any DPT, so no scale enters the arithmetic', () => {
    // The scale ratio cancels out of `DPT * standard_width / standard_gauge`,
    // which is why the editor never looks a scale up. Same multiple at every DPT.
    for (const dpt of [1, 18.4, 20, 137]) {
      expect(carWidthPx(dpt) / dpt).to.be.closeTo(2.0906, 1e-4);
    }
  });

  it('is zero at zero DPT rather than throwing', () => {
    expect(carWidthPx(0)).to.equal(0);
  });
});

describe('carCorners', () => {
  const dpt = 20;
  const half = carWidthPx(dpt) / 2;

  it('offsets a horizontal span perpendicular to its axis', () => {
    const corners = carCorners({ x: 100, y: 50 }, { x: 300, y: 50 }, dpt);
    expect(corners).to.deep.equal([
      { x: 100, y: 50 - half },
      { x: 300, y: 50 - half },
      { x: 300, y: 50 + half },
      { x: 100, y: 50 + half },
    ]);
  });

  it('offsets a vertical span perpendicular to its axis', () => {
    const [a, b, c, d] = carCorners({ x: 40, y: 10 }, { x: 40, y: 90 }, dpt);
    expect(a.x).to.be.closeTo(40 + half, 1e-9);
    expect(a.y).to.be.closeTo(10, 1e-9);
    expect(b.x).to.be.closeTo(40 + half, 1e-9);
    expect(b.y).to.be.closeTo(90, 1e-9);
    expect(c.x).to.be.closeTo(40 - half, 1e-9);
    expect(d.x).to.be.closeTo(40 - half, 1e-9);
  });

  it('keeps the rectangle the derived width wide however the span is angled', () => {
    const [a, , , d] = carCorners({ x: 0, y: 0 }, { x: 120, y: 120 }, dpt);
    const width = Math.hypot(a.x - d.x, a.y - d.y);
    expect(width).to.be.closeTo(carWidthPx(dpt), 1e-9);
  });

  it('keeps the long sides parallel to the span', () => {
    const p0 = { x: 30, y: 70 };
    const p1 = { x: 210, y: 10 };
    const [a, b] = carCorners(p0, p1, dpt);
    // Cross product of the span and the long side is zero when they are parallel.
    const cross = (p1.x - p0.x) * (b.y - a.y) - (p1.y - p0.y) * (b.x - a.x);
    expect(cross).to.be.closeTo(0, 1e-9);
  });

  it('collapses to the point itself when the span has no length', () => {
    // The first click of a chain has no second point yet, so the direction is
    // undefined. Collapsing is honest; picking an arbitrary axis is not.
    const corners = carCorners({ x: 5, y: 6 }, { x: 5, y: 6 }, dpt);
    expect(corners).to.deep.equal([
      { x: 5, y: 6 },
      { x: 5, y: 6 },
      { x: 5, y: 6 },
      { x: 5, y: 6 },
    ]);
  });
});

describe('hitTest', () => {
  it('finds nothing in an empty scene', () => {
    expect(hitTest(emptyScene, { x: 0, y: 0 }, tolerance)).to.equal(null);
  });

  describe('car endpoints', () => {
    const scene: HitScene = {
      ...emptyScene,
      cars: [car('c1', { x: 100, y: 100 }, { x: 200, y: 100 })],
    };

    it('hits p0 within the tolerance', () => {
      const hit = hitTest(scene, { x: 104, y: 100 }, tolerance);
      expect(hit).to.deep.equal({ kind: 'car-endpoint', ends: [{ id: 'c1', end: 'p0' }] });
    });

    it('hits p1 within the tolerance', () => {
      const hit = hitTest(scene, { x: 200, y: 106 }, tolerance);
      expect(hit).to.deep.equal({ kind: 'car-endpoint', ends: [{ id: 'c1', end: 'p1' }] });
    });

    it('misses just outside the tolerance', () => {
      expect(hitTest(scene, { x: 111, y: 100 }, tolerance)).to.equal(null);
    });

    it('does not hit the middle of the span — only its ends are handles', () => {
      expect(hitTest(scene, { x: 150, y: 100 }, tolerance)).to.equal(null);
    });

    it('takes the nearer of two endpoints in range', () => {
      const crowded: HitScene = {
        ...emptyScene,
        cars: [car('c1', { x: 100, y: 100 }, { x: 106, y: 100 })],
      };
      const hit = hitTest(crowded, { x: 105, y: 100 }, tolerance);
      expect(hit).to.deep.equal({ kind: 'car-endpoint', ends: [{ id: 'c1', end: 'p1' }] });
    });
  });

  describe('couplers', () => {
    // A coupling is not stored: it is two car endpoints at exactly the same
    // pixel, which chaining and the shared handle both guarantee.
    const scene: HitScene = {
      ...emptyScene,
      cars: [
        car('c1', { x: 100, y: 100 }, { x: 200, y: 100 }),
        car('c2', { x: 200, y: 100 }, { x: 300, y: 100 }),
      ],
    };

    it('reports both ends as one coupler', () => {
      const hit = hitTest(scene, { x: 202, y: 101 }, tolerance);
      expect(hit).to.deep.equal({
        kind: 'coupler',
        ends: [
          { id: 'c1', end: 'p1' },
          { id: 'c2', end: 'p0' },
        ],
      });
    });

    it('reports every end of a three-way coincidence', () => {
      const yard: HitScene = {
        ...scene,
        cars: [...scene.cars, car('c3', { x: 200, y: 100 }, { x: 200, y: 400 })],
      };
      const hit = hitTest(yard, { x: 200, y: 100 }, tolerance);
      expect(hit).to.deep.equal({
        kind: 'coupler',
        ends: [
          { id: 'c1', end: 'p1' },
          { id: 'c2', end: 'p0' },
          { id: 'c3', end: 'p0' },
        ],
      });
    });

    it('keeps endpoints that are merely near each other separate', () => {
      // Coincidence is exact. Two cars parked a pixel apart are two cars, and
      // fusing them under a tolerance would move geometry the user never joined.
      const nearly: HitScene = {
        ...emptyScene,
        cars: [
          car('c1', { x: 100, y: 100 }, { x: 200, y: 100 }),
          car('c2', { x: 201, y: 100 }, { x: 300, y: 100 }),
        ],
      };
      const hit = hitTest(nearly, { x: 200, y: 100 }, tolerance);
      expect(hit).to.deep.equal({ kind: 'car-endpoint', ends: [{ id: 'c1', end: 'p1' }] });
    });
  });

  describe('sensors and calibration points', () => {
    const scene: HitScene = {
      cars: [car('c1', { x: 100, y: 100 }, { x: 200, y: 100 })],
      sensors: [sensor('s1', 400, 400)],
      calibrationPoints: [calibrationPoint(0, 0), calibrationPoint(600, 600)],
    };

    it('hits a sensor by its id', () => {
      expect(hitTest(scene, { x: 403, y: 400 }, tolerance)).to.deep.equal({
        kind: 'sensor',
        id: 's1',
      });
    });

    it('hits a calibration point by its index', () => {
      expect(hitTest(scene, { x: 600, y: 604 }, tolerance)).to.deep.equal({
        kind: 'calibration',
        index: 1,
      });
    });

    it('takes the nearest object regardless of kind', () => {
      const overlapping: HitScene = {
        cars: [car('c1', { x: 500, y: 500 }, { x: 600, y: 500 })],
        sensors: [sensor('s1', 506, 500)],
        calibrationPoints: [calibrationPoint(502, 500)],
      };
      expect(hitTest(overlapping, { x: 503, y: 500 }, tolerance)).to.deep.equal({
        kind: 'calibration',
        index: 0,
      });
    });
  });

  describe('tolerance', () => {
    const scene: HitScene = { ...emptyScene, sensors: [sensor('s1', 100, 100)] };

    it('is measured in screen pixels, so a zoomed-out view grabs a wider area', () => {
      const zoomedOut: HitTolerance = { screenPx: 5, imagePxPerScreenPx: 8 };
      // 40 image px of reach at this zoom, 10 at the default.
      expect(hitTest(scene, { x: 130, y: 100 }, zoomedOut)).to.deep.equal({
        kind: 'sensor',
        id: 's1',
      });
      expect(hitTest(scene, { x: 130, y: 100 }, tolerance)).to.equal(null);
    });

    it('hits exactly on the tolerance boundary', () => {
      expect(hitTest(scene, { x: 110, y: 100 }, tolerance)).to.deep.equal({
        kind: 'sensor',
        id: 's1',
      });
    });
  });
});

describe('dragHandles', () => {
  const scene: HitScene = {
    cars: [
      car('c1', { x: 100, y: 100 }, { x: 200, y: 100 }),
      car('c2', { x: 200, y: 100 }, { x: 300, y: 100 }),
    ],
    sensors: [sensor('s1', 400, 400)],
    calibrationPoints: [calibrationPoint(10, 20), calibrationPoint(600, 600)],
  };

  it('gives a calibration point one handle, anchored where it is now', () => {
    expect(dragHandles({ kind: 'calibration', index: 1 }, scene)).to.deep.equal([
      { ref: { kind: 'calibration', index: 1 }, from: { x: 600, y: 600 } },
    ]);
  });

  it('gives a sensor one handle', () => {
    expect(dragHandles({ kind: 'sensor', id: 's1' }, scene)).to.deep.equal([
      { ref: { kind: 'sensor', id: 's1' }, from: { x: 400, y: 400 } },
    ]);
  });

  it('gives a free car end one handle, at the end that was grabbed', () => {
    const hit = { kind: 'car-endpoint', ends: [{ id: 'c1', end: 'p0' }] } as const;
    expect(dragHandles(hit, scene)).to.deep.equal([
      { ref: { kind: 'car-end', id: 'c1', end: 'p0' }, from: { x: 100, y: 100 } },
    ]);
  });

  it('gives a coupler one handle per end, which is how one entry covers two cars', () => {
    const hit = {
      kind: 'coupler',
      ends: [
        { id: 'c1', end: 'p1' },
        { id: 'c2', end: 'p0' },
      ],
    } as const;
    expect(dragHandles(hit, scene)).to.deep.equal([
      { ref: { kind: 'car-end', id: 'c1', end: 'p1' }, from: { x: 200, y: 100 } },
      { ref: { kind: 'car-end', id: 'c2', end: 'p0' }, from: { x: 200, y: 100 } },
    ]);
  });

  it('drops a handle the scene no longer holds', () => {
    expect(dragHandles({ kind: 'sensor', id: 'gone' }, scene)).to.deep.equal([]);
    expect(dragHandles({ kind: 'calibration', index: 9 }, scene)).to.deep.equal([]);
  });
});

describe('dragTo', () => {
  const handle = { ref: { kind: 'calibration', index: 0 }, from: { x: 100, y: 50 } } as const;

  it('applies the delta to where the handle started, so the grab offset survives', () => {
    // Measured from the press, not snapped to the pointer: grabbing a point
    // three pixels off-center must not teleport it under the cursor.
    expect(dragTo(handle, { x: 40, y: -10 })).to.deep.equal({ x: 140, y: 40 });
  });

  it('rounds, because a dragged handle names a pixel', () => {
    expect(dragTo(handle, { x: 0.4, y: 0.6 })).to.deep.equal({ x: 100, y: 51 });
  });

  it('is the identity at zero delta, so a drag home restores the exact pixel', () => {
    expect(dragTo(handle, { x: 0, y: 0 })).to.deep.equal(handle.from);
  });

  it('keeps a coupler coincident: one delta lands every end on the same pixel', () => {
    const coupler = dragHandles(
      {
        kind: 'coupler',
        ends: [
          { id: 'c1', end: 'p1' },
          { id: 'c2', end: 'p0' },
        ],
      },
      {
        cars: [
          car('c1', { x: 100, y: 100 }, { x: 200, y: 100 }),
          car('c2', { x: 200, y: 100 }, { x: 300, y: 100 }),
        ],
        sensors: [],
        calibrationPoints: [],
      }
    );
    const delta = { x: 17.5, y: -3.2 };
    const moved = coupler.map(h => dragTo(h, delta));
    expect(moved).to.have.length(2);
    // Exact equality, because that is what makes them still a coupling.
    expect(moved[0]).to.deep.equal(moved[1]);
  });
});

describe('isClick', () => {
  const slop: HitTolerance = { screenPx: 5, imagePxPerScreenPx: 1 };

  it('accepts a release on the pixel it was pressed on', () => {
    expect(isClick({ x: 100, y: 100 }, { x: 100, y: 100 }, slop)).to.be.true;
  });

  it('accepts the tremor inside the slop, and the boundary itself', () => {
    expect(isClick({ x: 100, y: 100 }, { x: 103, y: 96 }, slop)).to.be.true;
  });

  it('rejects a release beyond the slop — that is a drag', () => {
    expect(isClick({ x: 100, y: 100 }, { x: 106, y: 100 }, slop)).to.be.false;
  });

  it('measures in screen pixels, so the same swipe is a drag at any zoom', () => {
    const zoomedOut: HitTolerance = { screenPx: 5, imagePxPerScreenPx: 8 };
    // 30 image px is under 4 screen px zoomed out, and 30 screen px at 1:1.
    expect(isClick({ x: 100, y: 100 }, { x: 130, y: 100 }, zoomedOut)).to.be.true;
    expect(isClick({ x: 100, y: 100 }, { x: 130, y: 100 }, slop)).to.be.false;
  });
});

describe('estimateLabelWidthPx', () => {
  it('grows with both the character count and the font size', () => {
    expect(estimateLabelWidthPx('abcd', 10)).to.equal(estimateLabelWidthPx('ab', 10) * 2);
    expect(estimateLabelWidthPx('ab', 20)).to.equal(estimateLabelWidthPx('ab', 10) * 2);
  });

  it('is zero for an empty label', () => {
    expect(estimateLabelWidthPx('', 20)).to.equal(0);
  });

  it('stays within a monospace advance of the truth', () => {
    // The estimate is deliberately not a measurement — jsdom cannot measure —
    // so what is asserted is that it lands in the plausible band for a
    // monospace face, between half and a full em per character.
    const width = estimateLabelWidthPx('0, 250, 0 mm', 16);
    expect(width).to.be.greaterThan(12 * 16 * 0.5);
    expect(width).to.be.lessThan(12 * 16 * 1.0);
  });
});

describe('placeLabel', () => {
  const frame = { width: 1920, height: 1080 };
  const fontSize = 16;
  const offset = 8;
  const text = '0, 250, 0 mm';

  it('draws up and to the right of a point comfortably inside the frame', () => {
    const placed = placeLabel({ x: 500, y: 500 }, text, fontSize, offset, frame);
    expect(placed).to.deep.equal({
      x: 508,
      y: 492,
      textAnchor: 'start',
      dominantBaseline: 'text-after-edge',
    });
  });

  it('flips to the left of a point whose label would run past the right edge', () => {
    const near = { x: frame.width - 20, y: 500 };
    const placed = placeLabel(near, text, fontSize, offset, frame);
    expect(placed.textAnchor).to.equal('end');
    expect(placed.x).to.equal(near.x - offset);
    // Still above: only the axis that overflows flips.
    expect(placed.dominantBaseline).to.equal('text-after-edge');
    expect(placed.y).to.equal(500 - offset);
  });

  it('flips below a point whose label would run past the top edge', () => {
    const placed = placeLabel({ x: 500, y: 10 }, text, fontSize, offset, frame);
    expect(placed.dominantBaseline).to.equal('text-before-edge');
    expect(placed.y).to.equal(10 + offset);
    expect(placed.textAnchor).to.equal('start');
    expect(placed.x).to.equal(508);
  });

  it('flips both axes in the top-right corner', () => {
    const placed = placeLabel({ x: frame.width - 5, y: 5 }, text, fontSize, offset, frame);
    expect(placed.textAnchor).to.equal('end');
    expect(placed.dominantBaseline).to.equal('text-before-edge');
  });

  it('leaves the left and bottom edges alone — the preferred side already fits', () => {
    const placed = placeLabel({ x: 0, y: frame.height }, text, fontSize, offset, frame);
    expect(placed.textAnchor).to.equal('start');
    expect(placed.dominantBaseline).to.equal('text-after-edge');
  });

  it('flips on the estimate, so a longer label flips further from the edge', () => {
    const at = { x: frame.width - 120, y: 500 };
    expect(placeLabel(at, 'x', fontSize, offset, frame).textAnchor).to.equal('start');
    expect(
      placeLabel(at, '-1234.5, -1234.5, -1234.5 mm', fontSize, offset, frame).textAnchor
    ).to.equal('end');
  });

  it('does not flip into an edge that fits the label even less well', () => {
    // A frame narrower than the label overflows either way; flipping there
    // would trade a clipped tail for a clipped head and lose the leading
    // digits, which are the ones that identify the point.
    const narrow = { width: 60, height: 1080 };
    const placed = placeLabel({ x: 50, y: 500 }, text, fontSize, offset, narrow);
    expect(placed.textAnchor).to.equal('start');
  });

  it('is callable for any symbol that carries a label, not just a crosshair', () => {
    // The sensor symbol (#31) sits in the same frame with the same edges and
    // reads the same rule; only its offset differs.
    const placed = placeLabel({ x: 500, y: 500 }, 'siding-3', fontSize, 20, frame);
    expect(placed.x).to.equal(520);
    expect(placed.y).to.equal(480);
  });
});
