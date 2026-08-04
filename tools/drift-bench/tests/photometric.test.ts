import { describe, expect, it } from 'vitest';
import { makeImage } from '../src/image.ts';
import { brightness, contrast, gamma } from '../src/photometric.ts';

describe('photometric perturbations', () => {
  it('brightness shifts and clamps', () => {
    const img = makeImage(2, 1, 0.5);
    img.data[1] = 0.98;
    const out = brightness(img, 0.08);
    expect(out.data[0]).toBeCloseTo(0.58, 6);
    expect(out.data[1]).toBe(1);
  });

  it('contrast preserves the mean and spreads about it', () => {
    const img = makeImage(2, 1);
    img.data[0] = 0.4;
    img.data[1] = 0.6;
    const out = contrast(img, 1.5);
    expect((out.data[0] + out.data[1]) / 2).toBeCloseTo(0.5, 6);
    expect(out.data[1] - out.data[0]).toBeCloseTo(0.3, 6);
  });

  it('gamma > 1 darkens midtones and fixes the endpoints', () => {
    const img = makeImage(3, 1);
    img.data[0] = 0;
    img.data[1] = 0.5;
    img.data[2] = 1;
    const out = gamma(img, 2);
    expect(out.data[0]).toBe(0);
    expect(out.data[1]).toBeCloseTo(0.25, 6);
    expect(out.data[2]).toBe(1);
  });
});
