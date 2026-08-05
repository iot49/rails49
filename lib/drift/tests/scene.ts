import type { GrayPlane } from '../src/types.ts';

/**
 * A synthetic scene, sampled on the integer grid.
 *
 * The point of generating a *function* rather than shifting a buffer is that a
 * translated view is then **exact** — evaluate at `x + dx` and there is no
 * interpolation, no resampling blur, and no border invention to explain away.
 * The synthetic drift benchmark cannot do that (it warps real photographs and
 * crops the border it drags in, `tools/drift-bench`); these tests can, so the
 * displacement they assert is the displacement they applied.
 *
 * The mix is deliberate: hashed noise gives broadband content so a correlation
 * peak exists at all, and the sinusoids give the low-frequency structure a
 * photograph has, so a block is not the trivially easy white-noise case.
 */
function hash(x: number, y: number): number {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 1000) / 1000 - 0.5;
}

function scene(x: number, y: number): number {
  const value =
    0.5 +
    0.18 * Math.sin(x * 0.11) +
    0.14 * Math.cos(y * 0.073 + x * 0.031) +
    0.1 * Math.sin((x + y) * 0.017) +
    0.22 * hash(x, y);
  return Math.min(1, Math.max(0, value));
}

/** Render the scene, optionally viewed from `(dx, dy)` pixels away. */
export function renderScene(width: number, height: number, dx = 0, dy = 0): GrayPlane {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data[y * width + x] = scene(x + dx, y + dy);
  }
  return { width, height, data };
}

/** A copy with a per-pixel transform applied — the photometric cases. */
export function mapPlane(plane: GrayPlane, f: (v: number) => number): GrayPlane {
  const data = new Float32Array(plane.data.length);
  for (let i = 0; i < data.length; i++) data[i] = Math.min(1, Math.max(0, f(plane.data[i])));
  return { width: plane.width, height: plane.height, data };
}

/**
 * A copy with one rectangle painted over — a car that moved between frames.
 *
 * Local by construction: the caller keeps it inside one correlation block, which
 * is the condition the median is supposed to survive.
 */
export function paintRect(
  plane: GrayPlane,
  x0: number,
  y0: number,
  w: number,
  h: number,
  value: number,
): GrayPlane {
  const data = plane.data.slice();
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) data[y * plane.width + x] = value;
  }
  return { width: plane.width, height: plane.height, data };
}
