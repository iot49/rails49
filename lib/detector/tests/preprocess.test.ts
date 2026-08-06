import { describe, expect, it } from 'vitest';
import { letterbox } from '../src/letterbox.ts';
import { PAD_GRAY, paintLetterbox, type LetterboxTarget } from '../src/preprocess.ts';

/**
 * Painting the input grid, driven by a fake context.
 *
 * What this can pin is that the context is *configured* the way the model was
 * trained — the resampling filter above all (#132) — and that the paint happens
 * in the right order at the right place. What it cannot pin is the resulting
 * pixels: no test environment here executes `drawImage` and reads them back
 * (`ui` is jsdom, `lib/*` is bare node, `@web/test-runner` went in #109). That
 * gap is the open half of #132 and no fake closes it.
 */

const GRID = { width: 960, height: 544 };

/** One recorded paint operation, with the context state it ran under. */
interface Op {
  readonly name: 'fillRect' | 'drawImage';
  readonly args: readonly unknown[];
  readonly fillStyle: string | CanvasGradient | CanvasPattern;
  readonly smoothingEnabled: boolean;
  readonly smoothingQuality: ImageSmoothingQuality;
}

/**
 * A context that records rather than paints.
 *
 * State is snapshotted *per operation* rather than read at the end, because the
 * bug being guarded is an ordering one: a filter set after the draw is a filter
 * that did nothing.
 */
class Recorder implements LetterboxTarget {
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  // Deliberately *not* the values under test. A fake that starts where the code
  // is supposed to leave it cannot tell "assigned" from "already there" — and
  // here that distinction is easy to lose, because `'low'` and `true` are also
  // the spec's initial values for a real context.
  imageSmoothingEnabled = false;
  imageSmoothingQuality: ImageSmoothingQuality = 'high';
  readonly ops: Op[] = [];

  fillRect(...args: number[]): void {
    this.#record('fillRect', args);
  }

  drawImage(...args: unknown[]): void {
    this.#record('drawImage', args);
  }

  #record(name: Op['name'], args: readonly unknown[]): void {
    this.ops.push({
      name,
      args,
      fillStyle: this.fillStyle,
      smoothingEnabled: this.imageSmoothingEnabled,
      smoothingQuality: this.imageSmoothingQuality,
    });
  }
}

/** A stand-in for the picture: `paintLetterbox` only hands it to `drawImage`. */
const SOURCE = {} as CanvasImageSource;

const paint = (frame: { width: number; height: number }, ctx = new Recorder()) => {
  paintLetterbox(ctx, SOURCE, frame, GRID);
  return ctx;
};

describe('the resampling filter', () => {
  it('is requested explicitly, whatever the context arrived holding', () => {
    // The bug (#132): the filter was never stated, so a context that had been
    // touched — or a UA whose initial value is not the spec's — resampled the
    // model's input differently from every other one. #112 measured what that
    // costs: 36% recall bilinear against 31% area-averaged, identical frames
    // and identical weights.
    const draw = paint({ width: 1920, height: 1080 }).ops.find((op) => op.name === 'drawImage');

    expect(draw?.smoothingEnabled).toBe(true);
    expect(draw?.smoothingQuality).toBe('low');
  });

  it('is re-pinned on every call, because sizing a canvas resets the context', () => {
    // Today's canvas is sized once, so hoisting to the constructor would work —
    // but the DPT-normalized pipeline (#130) makes the grid a thing that
    // changes, and a filter that silently unpins itself on resize is this same
    // bug with a longer fuse. A context reset between calls stands in for it.
    const ctx = new Recorder();
    paint({ width: 1920, height: 1080 }, ctx);

    ctx.imageSmoothingEnabled = false;
    ctx.imageSmoothingQuality = 'high';
    paint({ width: 1920, height: 1080 }, ctx);

    const draws = ctx.ops.filter((op) => op.name === 'drawImage');
    expect(draws).toHaveLength(2);
    expect(draws[1].smoothingEnabled).toBe(true);
    expect(draws[1].smoothingQuality).toBe('low');
  });
});

describe('the paint', () => {
  it('lays the trained pad colour down first, then the picture over it', () => {
    // Order, not just presence: bars painted after the draw would cover the
    // frame the model is about to read.
    const ctx = paint({ width: 1920, height: 1080 });

    expect(ctx.ops.map((op) => op.name)).toEqual(['fillRect', 'drawImage']);
    expect(ctx.ops[0].fillStyle).toBe(PAD_GRAY);
    expect(ctx.ops[0].args).toEqual([0, 0, GRID.width, GRID.height]);
  });

  it('draws the whole source into the box `letterbox` computed', () => {
    const frame = { width: 4440, height: 2130 };
    const fit = letterbox(frame, GRID);
    const draw = paint(frame).ops[1];

    expect(draw.args).toEqual([
      SOURCE,
      0,
      0,
      frame.width,
      frame.height,
      fit.padX,
      fit.padY,
      fit.drawn.width,
      fit.drawn.height,
    ]);
  });

  it('fills the grid edge to edge when the source shares its aspect', () => {
    // 960x544 is not 16:9, so the ordinary capture still gets bars — this is
    // the degenerate case that proves the bars are computed, not assumed.
    const draw = paint(GRID).ops[1];

    expect(draw.args.slice(5)).toEqual([0, 0, GRID.width, GRID.height]);
  });
});
