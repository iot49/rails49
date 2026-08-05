import { describe, it, expect } from 'vitest';
import { fft1, fft2 } from '../src/fft.ts';

/**
 * The FFT is tested against closed forms rather than against another FFT: a
 * second implementation would only prove the two agree, and this one exists
 * because there is no dependency to agree with.
 */

function dft1(re: number[], im: number[]): { re: number[]; im: number[] } {
  const n = re.length;
  const outRe = new Array<number>(n).fill(0);
  const outIm = new Array<number>(n).fill(0);
  for (let k = 0; k < n; k++) {
    for (let t = 0; t < n; t++) {
      const angle = (-2 * Math.PI * k * t) / n;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      outRe[k] += re[t] * c - im[t] * s;
      outIm[k] += re[t] * s + im[t] * c;
    }
  }
  return { re: outRe, im: outIm };
}

describe('fft1', () => {
  it('matches a direct DFT', () => {
    const n = 32;
    const re = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + i / n);
    const im = Array.from({ length: n }, (_, i) => Math.cos(i * 1.3));
    const expected = dft1(re, im);

    const actualRe = Float64Array.from(re);
    const actualIm = Float64Array.from(im);
    fft1(actualRe, actualIm, n, false);

    for (let k = 0; k < n; k++) {
      expect(actualRe[k]).toBeCloseTo(expected.re[k], 8);
      expect(actualIm[k]).toBeCloseTo(expected.im[k], 8);
    }
  });

  it('walks a column when given a stride', () => {
    // The 2D transform reads columns out of a row-major buffer this way, so a
    // stride that silently read the wrong samples would be invisible in fft2's
    // round-trip (which is symmetric in x and y) and visible only in a real
    // correlation.
    const n = 8;
    const buffer = new Float64Array(n * n);
    const im = new Float64Array(n * n);
    // Column 3 holds an impulse at row 0; every other sample is nonzero noise
    // that must not reach the transform.
    for (let i = 0; i < buffer.length; i++) buffer[i] = 7;
    for (let y = 0; y < n; y++) buffer[y * n + 3] = y === 0 ? 1 : 0;

    fft1(buffer, im, n, false, 3, n);

    // An impulse at 0 transforms to a flat 1 across every bin.
    for (let k = 0; k < n; k++) {
      expect(buffer[k * n + 3]).toBeCloseTo(1, 10);
      expect(im[k * n + 3]).toBeCloseTo(0, 10);
    }
  });

  it('rejects a size that is not a power of two', () => {
    expect(() => fft1(new Float64Array(6), new Float64Array(6), 6, false)).toThrow(/power of two/);
  });
});

describe('fft2', () => {
  it('round-trips through the inverse', () => {
    const n = 16;
    const re = new Float64Array(n * n);
    const im = new Float64Array(n * n);
    for (let i = 0; i < re.length; i++) re[i] = Math.sin(i * 0.31) * 0.5 + 0.5;
    const original = re.slice();

    fft2(re, im, n, false);
    fft2(re, im, n, true);

    for (let i = 0; i < re.length; i++) {
      expect(re[i]).toBeCloseTo(original[i], 10);
      expect(im[i]).toBeCloseTo(0, 10);
    }
  });

  it('transforms a 2D impulse to a flat spectrum', () => {
    const n = 8;
    const re = new Float64Array(n * n);
    const im = new Float64Array(n * n);
    re[0] = 1;

    fft2(re, im, n, false);

    for (let i = 0; i < re.length; i++) {
      expect(re[i]).toBeCloseTo(1, 10);
      expect(im[i]).toBeCloseTo(0, 10);
    }
  });

  it('puts a single spatial frequency in exactly two bins', () => {
    // cos(2πx/n) along x only: bins (0, 1) and (0, n-1), amplitude n²/2 each.
    const n = 16;
    const re = new Float64Array(n * n);
    const im = new Float64Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) re[y * n + x] = Math.cos((2 * Math.PI * x) / n);
    }

    fft2(re, im, n, false);

    for (let i = 0; i < re.length; i++) {
      const x = i % n;
      const y = (i - x) / n;
      const expected = y === 0 && (x === 1 || x === n - 1) ? (n * n) / 2 : 0;
      expect(re[i]).toBeCloseTo(expected, 8);
      expect(im[i]).toBeCloseTo(0, 8);
    }
  });

  it('rejects a buffer that disagrees with the size', () => {
    expect(() => fft2(new Float64Array(15), new Float64Array(15), 4, false)).toThrow(/16 samples/);
  });
});
