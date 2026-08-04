/**
 * Grayscale float image, values in [0, 1], row-major.
 *
 * The whole benchmark works in this one representation: candidates under test
 * compare structure, not color, and a single channel keeps the warp and the
 * photometric math free of per-format branching.
 */
export interface GrayImage {
  width: number;
  height: number;
  /** length === width * height, row-major, values in [0, 1] */
  data: Float32Array;
}

export function makeImage(width: number, height: number, fill = 0): GrayImage {
  const data = new Float32Array(width * height);
  if (fill !== 0) data.fill(fill);
  return { width, height, data };
}

export function cloneImage(img: GrayImage): GrayImage {
  return { width: img.width, height: img.height, data: img.data.slice() };
}

/**
 * Bilinear sample at a fractional position, clamping to the edge.
 * Callers that must not see clamped pixels crop instead (see cropBorder).
 */
export function sampleBilinear(img: GrayImage, x: number, y: number): number {
  const cx = Math.min(Math.max(x, 0), img.width - 1);
  const cy = Math.min(Math.max(y, 0), img.height - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, img.width - 1);
  const y1 = Math.min(y0 + 1, img.height - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const d = img.data;
  const w = img.width;
  const top = d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx;
  const bot = d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx;
  return top * (1 - fy) + bot * fy;
}

/**
 * Cut `margin` pixels off every side.
 *
 * The harness applies the same crop to every image in every case — drifted and
 * legitimate alike — so the invalid border a synthetic warp drags in (pixels
 * sampled from outside the source frame) never reaches a scorer, and no group
 * is treated differently from another.
 */
export function cropBorder(img: GrayImage, margin: number): GrayImage {
  const width = img.width - 2 * margin;
  const height = img.height - 2 * margin;
  if (width <= 0 || height <= 0) {
    throw new Error(`cropBorder: margin ${margin} consumes the whole ${img.width}x${img.height} image`);
  }
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    data.set(img.data.subarray((y + margin) * img.width + margin, (y + margin) * img.width + margin + width), y * width);
  }
  return { width, height, data };
}
