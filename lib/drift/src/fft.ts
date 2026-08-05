/**
 * A power-of-two complex FFT, in-place, and the 2D transform built from it.
 *
 * Hand-rolled rather than taken from a dependency, and the reason is the
 * deploy budget: this package runs in the browser under COEP `require-corp`,
 * so every byte ships from origin inside a bundle Cloudflare caps at 25 MiB
 * (`CLAUDE.md` § Model files). The alternative the research ticket (#90)
 * surfaced was opencv.js at ~10.5 MiB for the same arithmetic. Sixty lines of
 * Cooley-Tukey is the cheaper trade by four orders of magnitude.
 *
 * Only sizes that are powers of two are supported — the block size is ours to
 * pick, so a mixed-radix implementation would be generality nothing asks for.
 */

/**
 * Bit-reversal permutation and twiddle tables for one transform size.
 *
 * Cached per size because a drift check runs the same size thousands of times
 * — once per block per reference — and the tables cost more to build than a
 * transform costs to run.
 */
interface Plan {
  readonly n: number;
  readonly rev: Uint32Array;
  /** cos/sin of -2πk/n for k < n/2: the forward twiddles. */
  readonly cos: Float64Array;
  readonly sin: Float64Array;
}

const plans = new Map<number, Plan>();

function planFor(n: number): Plan {
  const cached = plans.get(n);
  if (cached) return cached;

  if (n < 2 || (n & (n - 1)) !== 0) {
    throw new Error(`fft: size ${n} is not a power of two ≥ 2`);
  }

  let bits = 0;
  while (1 << bits < n) bits++;

  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }

  const half = n >> 1;
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    const angle = (-2 * Math.PI * k) / n;
    cos[k] = Math.cos(angle);
    sin[k] = Math.sin(angle);
  }

  const plan: Plan = { n, rev, cos, sin };
  plans.set(n, plan);
  return plan;
}

/**
 * One in-place complex FFT over `n` interleaved-by-stride samples.
 *
 * `offset` and `stride` are what let the 2D transform run over a row and then
 * over a column of the same buffer without copying either out: a column is
 * just a stride-`n` walk. Scaling is the caller's — see {@link fft2}.
 *
 * @param re      real parts, length ≥ offset + (n - 1) * stride + 1
 * @param im      imaginary parts, same layout
 * @param n       transform size, a power of two
 * @param inverse conjugate the twiddles (an unscaled inverse transform)
 */
export function fft1(
  re: Float64Array,
  im: Float64Array,
  n: number,
  inverse: boolean,
  offset = 0,
  stride = 1,
): void {
  const { rev, cos, sin } = planFor(n);

  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j <= i) continue;
    const a = offset + i * stride;
    const b = offset + j * stride;
    const tr = re[a];
    re[a] = re[b];
    re[b] = tr;
    const ti = im[a];
    im[a] = im[b];
    im[b] = ti;
  }

  const sign = inverse ? -1 : 1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    // Stepping the shared table rather than one per stage: the twiddles for a
    // stage of length `len` are every (n / len)-th entry of the size-n table.
    const step = n / len;
    for (let start = 0; start < n; start += len) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step];
        const wi = sign * sin[k * step];
        const a = offset + (start + k) * stride;
        const b = offset + (start + k + half) * stride;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

/**
 * In-place 2D FFT of an `n × n` row-major complex block.
 *
 * Rows first, then columns — separability, which is why only the 1D transform
 * above had to be written. The inverse divides by `n²` once at the end, so a
 * forward followed by an inverse is the identity.
 *
 * @param re      real parts, length `n * n`, row-major
 * @param im      imaginary parts, same layout
 * @param n       side length, a power of two
 * @param inverse run the scaled inverse transform
 */
export function fft2(re: Float64Array, im: Float64Array, n: number, inverse: boolean): void {
  if (re.length !== n * n || im.length !== n * n) {
    throw new Error(`fft2: expected ${n * n} samples, got ${re.length}/${im.length}`);
  }

  for (let y = 0; y < n; y++) fft1(re, im, n, inverse, y * n, 1);
  for (let x = 0; x < n; x++) fft1(re, im, n, inverse, x, n);

  if (inverse) {
    const scale = 1 / (n * n);
    for (let i = 0; i < re.length; i++) {
      re[i] *= scale;
      im[i] *= scale;
    }
  }
}
