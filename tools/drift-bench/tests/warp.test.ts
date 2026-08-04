import { describe, expect, it } from 'vitest';
import { makeImage, cropBorder, GrayImage } from '../src/image.ts';
import {
  driftHomography,
  warpImage,
  cornerDisplacement,
  applyMat,
  matInv,
  matMul,
  IDENTITY,
} from '../src/warp.ts';

function spikeImage(width: number, height: number, x: number, y: number): GrayImage {
  const img = makeImage(width, height, 0);
  img.data[y * width + x] = 1;
  return img;
}

function argmax(img: GrayImage): { x: number; y: number } {
  let best = 0;
  let idx = 0;
  for (let i = 0; i < img.data.length; i++) {
    if (img.data[i] > best) {
      best = img.data[i];
      idx = i;
    }
  }
  return { x: idx % img.width, y: Math.floor(idx / img.width) };
}

describe('homography algebra', () => {
  it('inverts to identity', () => {
    const h = driftHomography({ tx: 3, ty: -7, rotateDeg: 2, scale: 1.01, px: 1e-5 }, 100, 80);
    const round = matMul(h, matInv(h));
    for (let i = 0; i < 9; i++) {
      expect(round[i]).toBeCloseTo(IDENTITY[i], 8);
    }
  });

  it('leaves the center fixed under rotation and scale', () => {
    const h = driftHomography({ rotateDeg: 10, scale: 1.05 }, 200, 100);
    const p = applyMat(h, 100, 50);
    expect(p.x).toBeCloseTo(100, 6);
    expect(p.y).toBeCloseTo(50, 6);
  });
});

describe('warpImage', () => {
  it('identity params reproduce the image', () => {
    const img = spikeImage(40, 30, 17, 11);
    const out = warpImage(img, {});
    expect(Array.from(out.data)).toEqual(Array.from(img.data));
  });

  it('translation moves a spike by the stated pixels', () => {
    const img = spikeImage(60, 40, 20, 15);
    const out = warpImage(img, { tx: 7, ty: 3 });
    expect(argmax(out)).toEqual({ x: 27, y: 18 });
  });

  it('rotation about the center sends a spike where the matrix says', () => {
    const img = spikeImage(101, 101, 80, 50); // 30px right of center
    const h = driftHomography({ rotateDeg: 90 }, 101, 101);
    const predicted = applyMat(h, 80, 50);
    const out = warpImage(img, { rotateDeg: 90 });
    const peak = argmax(out);
    expect(peak.x).toBeCloseTo(predicted.x, 0);
    expect(peak.y).toBeCloseTo(predicted.y, 0);
  });
});

describe('cornerDisplacement', () => {
  it('equals the translation magnitude for pure translation', () => {
    expect(cornerDisplacement({ tx: 3, ty: 4 }, 960, 540)).toBeCloseTo(5, 6);
  });

  it('grows with rotation', () => {
    const small = cornerDisplacement({ rotateDeg: 0.5 }, 960, 540);
    const large = cornerDisplacement({ rotateDeg: 2 }, 960, 540);
    expect(large).toBeGreaterThan(small);
    // 2 deg at the ~550px corner radius is ~19px
    expect(large).toBeGreaterThan(15);
    expect(large).toBeLessThan(25);
  });
});

describe('cropBorder', () => {
  it('cuts the stated margin from every side', () => {
    const img = makeImage(10, 8, 0.5);
    img.data[2 * 10 + 3] = 1; // (3, 2) -> (1, 0) after margin 2
    const out = cropBorder(img, 2);
    expect(out.width).toBe(6);
    expect(out.height).toBe(4);
    expect(out.data[0 * 6 + 1]).toBe(1);
  });

  it('rejects a margin that consumes the image', () => {
    expect(() => cropBorder(makeImage(10, 8), 4)).toThrow();
  });
});
