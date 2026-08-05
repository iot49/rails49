import { describe, it, expect } from 'vitest';
import { convexIntersectionArea, polygonArea, polygonIoU } from '../src/overlap.ts';

// Moved down from `ui/tests/diagnostics.test.ts` with the arithmetic itself
// (#107), when the decode became a second consumer.

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('polygonArea', () => {
  it('measures area regardless of winding', () => {
    expect(polygonArea(square)).toBe(100);
    expect(polygonArea([...square].reverse())).toBe(100);
  });

  it('measures a rotated rectangle at its true area', () => {
    // 45°, so no edge is axis-aligned and a bounding-box answer would be wrong.
    const rotated = [
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 10 },
      { x: -5, y: 5 },
    ];
    expect(polygonArea(rotated)).toBeCloseTo(50, 9);
  });
});

describe('convexIntersectionArea', () => {
  it('intersects identical, overlapping and disjoint squares', () => {
    expect(convexIntersectionArea(square, square)).toBeCloseTo(100, 9);
    const shifted = square.map(p => ({ x: p.x + 5, y: p.y }));
    expect(convexIntersectionArea(square, shifted)).toBeCloseTo(50, 9);
    const away = square.map(p => ({ x: p.x + 50, y: p.y }));
    expect(convexIntersectionArea(square, away)).toBe(0);
  });

  it('is winding-agnostic, because the corner builders disagree about it', () => {
    // A span running right-to-left builds its normal the other way, so a rule
    // that assumed one winding would clip to nothing — which reads as two
    // boxes that do not overlap at all, and would leave every duplicate in.
    const reversed = [...square].reverse();
    const shifted = square.map(p => ({ x: p.x + 5, y: p.y }));
    expect(convexIntersectionArea(reversed, shifted)).toBeCloseTo(50, 9);
    expect(convexIntersectionArea(shifted, reversed)).toBeCloseTo(50, 9);
  });

  it('touching edges share no area', () => {
    // The coupled-car case: abutting spans must not read as overlapping, or
    // suppression would eat a car out of every consist.
    const abutting = square.map(p => ({ x: p.x + 10, y: p.y }));
    expect(convexIntersectionArea(square, abutting)).toBeCloseTo(0, 9);
  });
});

describe('polygonIoU', () => {
  it('scores 1 for identical and 0 for disjoint', () => {
    expect(polygonIoU(square, square)).toBeCloseTo(1, 9);
    expect(polygonIoU(square, square.map(p => ({ x: p.x + 50, y: p.y })))).toBe(0);
  });

  it('halves as the overlap halves', () => {
    // Two equal squares sharing half their area: intersection 50, union 150.
    const shifted = square.map(p => ({ x: p.x + 5, y: p.y }));
    expect(polygonIoU(square, shifted)).toBeCloseTo(50 / 150, 9);
  });
});
