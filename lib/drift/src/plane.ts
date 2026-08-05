import type { GrayPlane } from './types.ts';

/**
 * An RGBA byte raster — structurally the browser's `ImageData`.
 *
 * Written out rather than imported so this package needs no DOM lib: a real
 * `ImageData` satisfies it, and so does anything Node produced.
 */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** Length `width * height * 4`, row-major, RGBA bytes. */
  readonly data: Uint8ClampedArray;
}

/** Rec. 601 luma weights — the same greyscale `sharp` and canvases produce. */
const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;

/**
 * Convert an RGBA raster to a {@link GrayPlane}.
 *
 * What a browser caller has is an `ImageData` — from a canvas it drew a video
 * frame or an archive image into — and this is the one conversion it needs. The
 * alpha channel is ignored: a canvas holding a decoded photo is opaque, and
 * premultiplying against an unknown background would invent structure.
 *
 * @param source RGBA bytes; `data.length` must be `4 * width * height`
 * @throws if the buffer length disagrees with the dimensions
 */
export function fromImageData(source: RgbaImage): GrayPlane {
  const { width, height, data } = source;
  if (data.length !== width * height * 4) {
    throw new Error(
      `fromImageData: ${width}x${height} needs ${width * height * 4} bytes, got ${data.length}`,
    );
  }
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (LUMA_R * data[p] + LUMA_G * data[p + 1] + LUMA_B * data[p + 2]) / 255;
  }
  return { width, height, data: out };
}

/** Bilinear sample, clamped at the edges. */
function sample(plane: GrayPlane, x: number, y: number): number {
  const cx = Math.min(Math.max(x, 0), plane.width - 1);
  const cy = Math.min(Math.max(y, 0), plane.height - 1);
  const x0 = Math.floor(cx);
  const y0 = Math.floor(cy);
  const x1 = Math.min(x0 + 1, plane.width - 1);
  const y1 = Math.min(y0 + 1, plane.height - 1);
  const fx = cx - x0;
  const fy = cy - y0;
  const d = plane.data;
  const w = plane.width;
  const top = d[y0 * w + x0] * (1 - fx) + d[y0 * w + x1] * fx;
  const bot = d[y1 * w + x0] * (1 - fx) + d[y1 * w + x1] * fx;
  return top * (1 - fy) + bot * fy;
}

/**
 * Resample a plane onto an exact `width × height` grid.
 *
 * A **stretch**, not a letterbox: the two axes scale independently. That is
 * what `rr-viewer` does when it draws a live stream over an archive's authored
 * frame, so a check that letterboxed would be measuring a different geometry
 * from the one on screen. An aspect-ratio disagreement between a frame and the
 * archive is already its own warning in the editor and is not this module's to
 * restate.
 *
 * Returns the input unchanged when it is already the requested size — the
 * common case once every reference in an archive shares a resolution.
 */
export function resamplePlane(plane: GrayPlane, width: number, height: number): GrayPlane {
  if (plane.width === width && plane.height === height) return plane;
  if (width < 1 || height < 1) {
    throw new Error(`resamplePlane: target ${width}x${height} is empty`);
  }
  const out = new Float32Array(width * height);
  // Sample at pixel centres, so a 2:1 reduction averages the pair it covers
  // rather than picking one of them.
  const sx = plane.width / width;
  const sy = plane.height / height;
  for (let y = 0; y < height; y++) {
    const py = (y + 0.5) * sy - 0.5;
    for (let x = 0; x < width; x++) {
      out[y * width + x] = sample(plane, (x + 0.5) * sx - 0.5, py);
    }
  }
  return { width, height, data: out };
}

/** Reject a plane whose buffer disagrees with its dimensions, or is empty. */
export function assertPlane(plane: GrayPlane, what: string): void {
  if (plane.width < 1 || plane.height < 1) {
    throw new Error(`${what}: ${plane.width}x${plane.height} is empty`);
  }
  if (plane.data.length !== plane.width * plane.height) {
    throw new Error(
      `${what}: ${plane.width}x${plane.height} needs ${plane.width * plane.height} samples, ` +
        `got ${plane.data.length}`,
    );
  }
}
