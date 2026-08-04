import { GrayImage } from './image.ts';
import { Scorer } from './harness.ts';

/**
 * Naive pixel-space baselines. These exist to prove the harness end-to-end
 * and to put a number on why raw differencing is not the answer: a sibling
 * frame with different rolling stock changes many pixels without any drift.
 * A structural candidate has to beat these to justify itself.
 */

function meanAbsDiff(a: GrayImage, b: GrayImage): number {
  let sum = 0;
  for (let i = 0; i < a.data.length; i++) sum += Math.abs(a.data[i] - b.data[i]);
  return sum / a.data.length;
}

function standardized(img: GrayImage): Float32Array {
  let mean = 0;
  for (let i = 0; i < img.data.length; i++) mean += img.data[i];
  mean /= img.data.length;
  let variance = 0;
  for (let i = 0; i < img.data.length; i++) {
    const d = img.data[i] - mean;
    variance += d * d;
  }
  const std = Math.sqrt(variance / img.data.length) || 1;
  const out = new Float32Array(img.data.length);
  for (let i = 0; i < img.data.length; i++) out[i] = (img.data[i] - mean) / std;
  return out;
}

/** Min over refs of mean |frame - ref|: raw pixel differencing. */
export const madScorer: Scorer = {
  name: 'mad',
  score(frame, refs) {
    return Math.min(...refs.map((r) => meanAbsDiff(frame, r)));
  },
};

/** The same, after standardizing each image to mean 0 / std 1 — the cheapest
 *  possible photometric normalization, still purely pixel-space. */
export const zmadScorer: Scorer = {
  name: 'zmad',
  score(frame, refs) {
    const f = standardized(frame);
    let best = Infinity;
    for (const ref of refs) {
      const r = standardized(ref);
      let sum = 0;
      for (let i = 0; i < f.length; i++) sum += Math.abs(f[i] - r[i]);
      best = Math.min(best, sum / f.length);
    }
    return best;
  },
};

export const BASELINE_SCORERS: Record<string, Scorer> = {
  [madScorer.name]: madScorer,
  [zmadScorer.name]: zmadScorer,
};
