import { assertPlane, resamplePlane } from './plane.ts';
import { blockGrid, blockSpectra, makeScratch, medianShift } from './phaseCorrelation.ts';
import type { BlockSpectra } from './phaseCorrelation.ts';
import type { DriftCheck, DriftResult, GrayPlane } from './types.ts';

/**
 * The width every plane is correlated at, before anything else happens.
 *
 * Not a quality knob — it is the resolution the benchmark's grades are
 * calibrated in (`tools/drift-bench` § WORKING_WIDTH), so changing it changes
 * what every number #92 measured means. A camera that moved five pixels at 1920
 * moved two and a half here, and the check reports the 1920 figure.
 *
 * Clamped rather than fixed: a reference narrower than this is used at its own
 * width, because upsampling invents no structure and would make the reported
 * displacement finer than the pixels it came from.
 */
export const WORKING_WIDTH = 960;

/**
 * Prepare a drift check against an archive's images.
 *
 * The archive **is** the pose record — every image in one was shot from the
 * canonical camera position by construction, which is why nothing about pose is
 * stored in the manifest and this is computed at load time instead (map #89).
 * Pass the archive's decoded images and keep the returned check for the session.
 *
 * The reference frame every result is reported in is `refs[0]`'s native pixel
 * grid. Later references are resampled onto it, the same stretch `rr-viewer`
 * applies when it draws one frame's markers over another's pixels; an archive
 * whose images disagree about their size is a condition the editor already
 * warns about separately, and not this module's to restate.
 *
 * Measured on the 2017 i7, six 1920x1080 references, in Chrome: **~3.4 s to
 * build, ~0.58 s per check**. The build is dominated by resampling six 2-megapixel
 * planes down to the working grid, not by the FFTs (~0.4 s of the total) — it is
 * a once-per-session cost and has not been optimised for that reason. The check
 * is ~0.53 s of arithmetic plus the yields below, which is why the live view
 * samples on an interval rather than per frame.
 *
 * @param refs the archive's images, in manifest order — `refIndex` indexes this
 * @throws if `refs` is empty, if any plane's buffer disagrees with its
 *         dimensions, or if `refs[0]` is too small to hold one correlation
 *         block (see `chooseBlockSize`)
 */
export async function createDriftCheck(refs: readonly GrayPlane[]): Promise<DriftCheck> {
  if (refs.length === 0) {
    // An empty reference set would make every frame's `refIndex` a lie and
    // every displacement a `min` over nothing. The caller knows whether an
    // archive has images; this cannot answer for it.
    throw new Error('createDriftCheck: no reference images');
  }
  refs.forEach((ref, i) => assertPlane(ref, `createDriftCheck: refs[${i}]`));

  const first = refs[0];
  const width = Math.min(WORKING_WIDTH, first.width);
  const height = Math.max(1, Math.round((first.height * width) / first.width));
  const grid = blockGrid(width, height);

  /** Working pixels → reference-frame pixels. 1 when the reference is small. */
  const pxScale = first.width / width;

  const spectra: BlockSpectra[] = [];
  for (const ref of refs) {
    spectra.push(blockSpectra(resamplePlane(ref, width, height), grid));
    // The construction cost is `refs.length` times a frame's, and it runs while
    // a view is mounting. Yielding keeps a six-image archive from holding the
    // main thread for the whole of it.
    await yieldToHost();
  }

  const scratch = makeScratch(grid);
  const shifts = new Float64Array(grid.cols * grid.rows);

  return {
    refCount: refs.length,

    async check(frame: GrayPlane): Promise<DriftResult> {
      assertPlane(frame, 'check: frame');
      const frameSpectra = blockSpectra(resamplePlane(frame, width, height), grid);

      let best = Infinity;
      let refIndex = 0;
      for (let i = 0; i < spectra.length; i++) {
        const shift = medianShift(frameSpectra, spectra[i], scratch, shifts);
        if (shift < best) {
          best = shift;
          refIndex = i;
        }
        // Agreeing with *any* archive image is agreement, so this is a `min`
        // and not an average — but it cannot stop early on a zero, because a
        // later reference is what `refIndex` would then misreport. Yield
        // instead: the loop is the expensive half of a check, and on
        // phone-class hardware it is the difference between a stutter and a
        // freeze. This is what the async signature was reserved for.
        await yieldToHost();
      }

      return { displacementPx: best * pxScale, refIndex };
    },
  };
}

/**
 * Hand the host back its thread for one turn.
 *
 * A **`MessageChannel`**, not `setTimeout(0)`, and not a resolved promise.
 *
 * A microtask is out because it runs before the browser gets to paint, so
 * awaiting one yields nothing that matters. `setTimeout(0)` was the first
 * implementation and it was **measured to be wrong**: browsers clamp a timer
 * nested more than five deep in a non-foreground page to roughly one second, and
 * these yields are nested by construction — each is scheduled from inside the
 * previous timer's callback. A six-reference check whose arithmetic takes 530 ms
 * took **6 s** wall-clock in a background tab, all of it waiting on clamped
 * timers. A phone with the browser backgrounded is exactly the case the live
 * view has to survive.
 *
 * `MessageChannel` posts a macrotask that timer throttling does not apply to,
 * which is why schedulers that must stay responsive use it. It is global in
 * browsers and in Node ≥ 15; `setTimeout` remains the fallback, where the clamp
 * is a slow check rather than a broken one.
 */
const yieldToHost: () => Promise<void> =
  typeof MessageChannel === 'function'
    ? () =>
        new Promise(resolve => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => {
            channel.port1.close();
            resolve();
          };
          channel.port2.postMessage(null);
        })
    : () => new Promise(resolve => setTimeout(resolve, 0));
