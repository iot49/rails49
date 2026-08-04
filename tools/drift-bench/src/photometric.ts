import { GrayImage } from './image.ts';

/**
 * Photometric perturbations — the changes the drift check must NOT flag.
 * A model railroad room's lighting varies between sessions; the camera did
 * not move. These build the must-pass set alongside the sibling frames.
 */

function mapPixels(img: GrayImage, f: (v: number) => number): GrayImage {
  const data = new Float32Array(img.data.length);
  for (let i = 0; i < data.length; i++) {
    const v = f(img.data[i]);
    data[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return { width: img.width, height: img.height, data };
}

/** Add a constant offset (positive = brighter), clamped to [0, 1]. */
export function brightness(img: GrayImage, offset: number): GrayImage {
  return mapPixels(img, (v) => v + offset);
}

/** Scale contrast about the image's own mean, clamped to [0, 1]. */
export function contrast(img: GrayImage, gain: number): GrayImage {
  let mean = 0;
  for (let i = 0; i < img.data.length; i++) mean += img.data[i];
  mean /= img.data.length;
  return mapPixels(img, (v) => (v - mean) * gain + mean);
}

/** Gamma curve; gamma > 1 darkens midtones, < 1 lifts them. */
export function gamma(img: GrayImage, g: number): GrayImage {
  return mapPixels(img, (v) => Math.pow(v, g));
}
