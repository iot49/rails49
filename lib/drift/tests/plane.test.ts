import { describe, it, expect } from 'vitest';
import { assertPlane, fromImageData, resamplePlane } from '../src/plane.ts';
import type { GrayPlane } from '../src/types.ts';

function plane(width: number, height: number, fill: (x: number, y: number) => number): GrayPlane {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = fill(x, y);
  }
  return { width, height, data };
}

describe('fromImageData', () => {
  it('applies Rec. 601 luma and scales to 0…1', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
    const gray = fromImageData({ width: 2, height: 1, data });
    expect(gray.data[0]).toBeCloseTo(0.299, 5);
    expect(gray.data[1]).toBeCloseTo(0.587, 5);
  });

  it('ignores alpha', () => {
    // A canvas holding a decoded photo is opaque; premultiplying a transparent
    // pixel against an unknown background would invent structure the frame does
    // not have.
    const opaque = fromImageData({ width: 1, height: 1, data: new Uint8ClampedArray([128, 128, 128, 255]) });
    const clear = fromImageData({ width: 1, height: 1, data: new Uint8ClampedArray([128, 128, 128, 0]) });
    expect(clear.data[0]).toBe(opaque.data[0]);
  });

  it('rejects a buffer that disagrees with the dimensions', () => {
    expect(() => fromImageData({ width: 2, height: 2, data: new Uint8ClampedArray(4) })).toThrow(
      /needs 16 bytes/,
    );
  });
});

describe('resamplePlane', () => {
  it('returns the same object when the size already matches', () => {
    const p = plane(4, 4, () => 0.5);
    expect(resamplePlane(p, 4, 4)).toBe(p);
  });

  it('preserves a constant', () => {
    const out = resamplePlane(plane(9, 7, () => 0.25), 4, 3);
    expect(out.width).toBe(4);
    expect(out.height).toBe(3);
    for (const v of out.data) expect(v).toBeCloseTo(0.25, 6);
  });

  it('averages the pair a 2:1 reduction covers', () => {
    // Sampling at pixel centres is what makes this an average rather than a
    // pick: 0,1,2,3 halved reads 0.5 and 2.5, not 0 and 2.
    const out = resamplePlane(plane(4, 1, x => x / 10), 2, 1);
    expect(out.data[0]).toBeCloseTo(0.05, 6);
    expect(out.data[1]).toBeCloseTo(0.25, 6);
  });

  it('stretches the two axes independently', () => {
    const out = resamplePlane(plane(8, 4, () => 0.5), 4, 4);
    expect(out.width).toBe(4);
    expect(out.height).toBe(4);
  });

  it('rejects an empty target', () => {
    expect(() => resamplePlane(plane(4, 4, () => 0), 0, 4)).toThrow(/is empty/);
  });
});

describe('assertPlane', () => {
  it('accepts a well-formed plane', () => {
    expect(() => assertPlane(plane(3, 2, () => 0), 'x')).not.toThrow();
  });

  it('rejects an empty one', () => {
    expect(() => assertPlane({ width: 0, height: 4, data: new Float32Array(0) }, 'x')).toThrow(
      /is empty/,
    );
  });

  it('rejects a buffer of the wrong length', () => {
    expect(() => assertPlane({ width: 3, height: 3, data: new Float32Array(8) }, 'x')).toThrow(
      /needs 9 samples/,
    );
  });
});
