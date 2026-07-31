import { describe, it, expect } from 'vitest';
import type { CalibrationPoint, CarLabel, Sensor } from '@occupancy/r49';
import { STANDARD_GAUGE, STANDARD_WIDTH } from '@occupancy/config';
import { carWidthPx, carCorners, hitTest } from '../src/geometry.js';
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
