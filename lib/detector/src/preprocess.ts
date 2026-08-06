import { letterbox } from './letterbox.ts';
import type { Frame } from './types.ts';

/** Ultralytics' letterbox fill. The model was trained on bars this colour. */
export const PAD_GRAY = 'rgb(114, 114, 114)';

/**
 * The 2D context, narrowed to what painting an input grid touches.
 *
 * Structural rather than `CanvasRenderingContext2D` so this is testable: no
 * test environment in this repo can execute `drawImage` and read the pixels
 * back — `ui` runs in jsdom where canvas is a stub, `lib/*` run in bare node,
 * and `@web/test-runner` was removed deliberately (#109). What a fake can
 * still pin is that the context is *configured* the way the model was trained,
 * which is exactly the bug this module exists for (#132). It does not pin the
 * resulting pixels; nothing here can.
 */
export interface LetterboxTarget {
  fillStyle: string | CanvasGradient | CanvasPattern;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: ImageSmoothingQuality;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(
    source: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number
  ): void;
}

/**
 * Paint `source` into the model's input grid: gray bars, then the picture
 * letterboxed into the middle.
 *
 * **The resampling filter is pinned here, and that is the point of the
 * function** (#132). Left unset, `drawImage` resamples with whatever the user
 * agent picks, so the app disagrees with its own training data *and* two
 * deployed devices disagree with each other — and this app explicitly targets
 * both a phone and a laptop. #112 measured the size of that: 36% recall
 * bilinear against 31% area-averaged, identical frames, identical weights.
 *
 * `'low'` is the bilinear end of the three qualities, and bilinear is what the
 * model was trained through — every resize on the Ultralytics path is
 * `cv2.INTER_LINEAR`, both `LetterBox` and `load_image`'s long-side rescale. So
 * matching training and taking the better-scoring option are the same choice
 * here; nothing had to be traded.
 *
 * **Be clear about what this buys, because it is less than it looks.** `'low'`
 * and `true` are also the spec's *initial* values, so against a fresh context
 * these two writes change nothing — and the three qualities are hints the user
 * agent may implement however it likes, so `'low'` does not *guarantee*
 * bilinear anywhere. What is bought is that the filter is now stated rather
 * than inherited: it survives a context reset, it cannot be silently moved by
 * another caller, and changing it is a decision someone makes on purpose.
 * Genuinely pinning the *filter* across user agents would mean resampling
 * ourselves rather than asking `drawImage` to — still open on #132, and not
 * something a fake can measure either.
 *
 * Set on every call rather than once at construction because **sizing a canvas
 * resets its 2D context state**. Today's canvas is sized once, so hoisting
 * would work today — but the DPT-normalized pipeline (#130) makes the input
 * grid a thing that changes, and a filter that silently unpins itself on
 * resize is the same bug again with a longer fuse. Two property writes per
 * frame is not a cost worth that.
 *
 * @param frame The source's own pixel count — `sourceFrame`'s job, not
 *              readable reliably off the element.
 * @param grid  The model's input grid.
 * @returns Where the source landed — `letterbox`'s own result, returned rather
 *          than discarded so a caller need not recompute it to reason about the
 *          bars. `detect` does not: it maps detections back out through
 *          `gridToReport`, which takes frames rather than a fit.
 */
export function paintLetterbox(
  ctx: LetterboxTarget,
  source: CanvasImageSource,
  frame: Frame,
  grid: Frame
) {
  const fit = letterbox(frame, grid);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'low';

  ctx.fillStyle = PAD_GRAY;
  ctx.fillRect(0, 0, grid.width, grid.height);
  ctx.drawImage(
    source,
    0,
    0,
    frame.width,
    frame.height,
    fit.padX,
    fit.padY,
    fit.drawn.width,
    fit.drawn.height
  );

  return fit;
}
