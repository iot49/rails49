import { GrayImage, sampleBilinear } from './image.ts';

/** Row-major 3x3 homography. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function matMul(a: Mat3, b: Mat3): Mat3 {
  const out = new Array(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

export function matInv(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = c * h - b * i;
  const C = b * f - c * e;
  const det = a * A + d * B + g * C;
  if (Math.abs(det) < 1e-12) throw new Error('matInv: singular matrix');
  const s = 1 / det;
  return [
    A * s, B * s, C * s,
    (f * g - d * i) * s, (a * i - c * g) * s, (c * d - a * f) * s,
    (d * h - e * g) * s, (b * g - a * h) * s, (a * e - b * d) * s,
  ];
}

export function applyMat(m: Mat3, x: number, y: number): { x: number; y: number } {
  const w = m[6] * x + m[7] * y + m[8];
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
}

/**
 * The synthetic camera-drift model: what a bumped tripod does to the frame.
 *
 * All parameters are in the *benchmark's* working resolution (see cases.ts),
 * applied about the image center. `perspective` is the frequency-space tilt
 * term of the homography; its practical meaning is captured by
 * cornerDisplacement, which is what the grades are calibrated in.
 */
export interface DriftParams {
  /** translation in pixels */
  tx?: number;
  ty?: number;
  /** rotation in degrees, about the image center */
  rotateDeg?: number;
  /** scale factor, 1 = unchanged, about the image center */
  scale?: number;
  /** homography tilt terms (dimensionless, order 1e-5 is visible) */
  px?: number;
  py?: number;
}

/** Forward homography: source pixel -> drifted pixel. */
export function driftHomography(params: DriftParams, width: number, height: number): Mat3 {
  const cx = width / 2;
  const cy = height / 2;
  const toCenter: Mat3 = [1, 0, -cx, 0, 1, -cy, 0, 0, 1];
  const fromCenter: Mat3 = [1, 0, cx, 0, 1, cy, 0, 0, 1];
  const theta = ((params.rotateDeg ?? 0) * Math.PI) / 180;
  const s = params.scale ?? 1;
  const cos = Math.cos(theta) * s;
  const sin = Math.sin(theta) * s;
  const rs: Mat3 = [cos, -sin, 0, sin, cos, 0, 0, 0, 1];
  const persp: Mat3 = [1, 0, 0, 0, 1, 0, params.px ?? 0, params.py ?? 0, 1];
  const translate: Mat3 = [1, 0, params.tx ?? 0, 0, 1, params.ty ?? 0, 0, 0, 1];
  return matMul(translate, matMul(fromCenter, matMul(persp, matMul(rs, toCenter))));
}

/**
 * Largest displacement any pixel of the frame suffers under the drift —
 * evaluated at the four corners and the edge midpoints, which is where a
 * center-anchored rotation/scale/tilt moves pixels furthest. The harness
 * chooses its border crop from the maximum of this over all grades.
 */
export function cornerDisplacement(params: DriftParams, width: number, height: number): number {
  const h = driftHomography(params, width, height);
  const pts = [
    [0, 0], [width, 0], [0, height], [width, height],
    [width / 2, 0], [width / 2, height], [0, height / 2], [width, height / 2],
  ];
  let max = 0;
  for (const [x, y] of pts) {
    const p = applyMat(h, x, y);
    max = Math.max(max, Math.hypot(p.x - x, p.y - y));
  }
  return max;
}

/**
 * Render the drifted frame: for each output pixel, sample the source through
 * the inverse homography (bilinear). Edge-clamped samples appear only within
 * cornerDisplacement() of the border, which the harness crops away.
 */
export function warpImage(src: GrayImage, params: DriftParams): GrayImage {
  const inv = matInv(driftHomography(params, src.width, src.height));
  const out = new Float32Array(src.width * src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const p = applyMat(inv, x, y);
      out[y * src.width + x] = sampleBilinear(src, p.x, p.y);
    }
  }
  return { width: src.width, height: src.height, data: out };
}
