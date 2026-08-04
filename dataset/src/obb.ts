import crypto from 'node:crypto';
import { STANDARD_GAUGE, STANDARD_WIDTH } from '@occupancy/config';
import type { CarLabel } from '@occupancy/r49';

/**
 * The arithmetic of the YOLO OBB export, with no filesystem in it.
 *
 * Kept apart from `yolo_export.ts` because these are the parts worth pinning:
 * a corner formula, a class lookup and a split rule are each one assertion
 * away from a test, while reading a directory of archives is not. The script
 * holds the I/O and the reporting; everything a wrong number could hide in
 * lives here.
 */

/** Pixel width of a car, from the resolution it was photographed at.
 *
 * `DPT × STANDARD_WIDTH / STANDARD_GAUGE`. The scale ratio cancels — a car is
 * the same 2.09 track-widths wide in every scale — which is why this needs the
 * DPT and nothing else. Width is derived rather than stored per label, and
 * derived from the *widest* real prototype: an over-wide box biases toward
 * `occupied`, the direction the occupancy output deliberately errs in.
 */
export function carWidthPx(dpt: number): number {
  return (dpt * STANDARD_WIDTH) / STANDARD_GAUGE;
}

/** The frame a label's pixel coordinates are expressed in. */
export interface Frame {
  readonly width: number;
  readonly height: number;
}

/**
 * A car span as the four **normalized** polygon corners Ultralytics reads,
 * flattened in `x1 y1 x2 y2 x3 y3 x4 y4` order and wound around the perimeter:
 * `p0 + n`, `p1 + n`, `p1 - n`, `p0 - n`, where `n` is half a car width along
 * the chord's normal. Walking the perimeter rather than pairing the ends is
 * what makes it a simple quadrilateral — pairing them draws a bowtie.
 *
 * The chord gives centre, orientation and length directly, so the box is just
 * the chord offset by half a car width along its normal. No trigonometry is
 * involved and none should be reintroduced — an angle would have to be
 * unwrapped somewhere, and the corner form has no branch to get wrong.
 *
 * Corners are **clamped** into `[0, 1]`. A car at the frame edge genuinely has
 * corners outside it, and Ultralytics rejects a label file containing one
 * outright, so the choice is between a clamped box and no box at all — and no
 * box is the unlabeled-car-as-background failure. Clamping bends the rectangle
 * into a quad, which training re-fits to the tightest enclosing rotated rect;
 * the caller is told how many corners moved so it is never silent.
 *
 * @throws If the chord has zero length. Two coincident points name no
 *         orientation, so there is no box to derive — a malformed label, not a
 *         degenerate case to paper over with a default.
 */
export function spanToPolygon(
  label: Pick<CarLabel, 'id' | 'p0' | 'p1'>,
  widthPx: number,
  frame: Frame
): { readonly corners: readonly number[]; readonly clamped: number } {
  const dx = label.p1.x - label.p0.x;
  const dy = label.p1.y - label.p0.y;
  const length = Math.hypot(dx, dy);

  if (length === 0) {
    throw new Error(
      `label ${label.id}: p0 and p1 coincide at (${label.p0.x}, ${label.p0.y}), ` +
        `so the span has no orientation and no box can be derived from it`
    );
  }

  // Unit normal to the chord, scaled to half a car.
  const half = widthPx / 2;
  const nx = (-dy / length) * half;
  const ny = (dx / length) * half;

  const corners = [
    label.p0.x + nx,
    label.p0.y + ny,
    label.p1.x + nx,
    label.p1.y + ny,
    label.p1.x - nx,
    label.p1.y - ny,
    label.p0.x - nx,
    label.p0.y - ny,
  ];

  let clamped = 0;
  const normalized = corners.map((value, i) => {
    const scaled = value / (i % 2 === 0 ? frame.width : frame.height);
    if (scaled < 0 || scaled > 1) clamped++;
    return Math.min(1, Math.max(0, scaled));
  });

  return { corners: normalized, clamped };
}

/** One label file line: the class index, then the eight normalized corners. */
export function labelLine(classIndex: number, corners: readonly number[]): string {
  // Six decimals is ~0.01 px at 1920 wide — below what anyone can click, and
  // short enough that the label files stay readable.
  return [classIndex, ...corners.map(c => c.toFixed(6))].join(' ');
}

/** Which side of the split an image falls on. */
export type Split = 'train' | 'val';

/**
 * The split an image belongs to, decided by a hash of its identity rather than
 * by counting.
 *
 * Deterministic in the archive and filename alone, so re-exporting never
 * reshuffles, adding an archive never moves an existing image, and two machines
 * exporting the same corpus agree. This is the discipline the retired crop
 * pipeline used, moved up one level: it keyed on the individual marker, and the
 * unit here is the **image**, because two cars in one frame must not land on
 * opposite sides.
 */
export function splitFor(archive: string, filename: string, valSplit: number): Split {
  const digest = crypto.createHash('md5').update(`${archive}:${filename}`).digest('hex');
  const bucket = parseInt(digest.slice(0, 8), 16) % 100;
  return bucket < valSplit * 100 ? 'val' : 'train';
}

/**
 * The output stem for an image, qualified by its archive.
 *
 * Every archive in the corpus names its images `image-0.jpeg`, so the archive
 * has to be in the name or the sixth `image-0` silently overwrites the first
 * five. Ultralytics pairs a label to its image by stem, so both files take this
 * one.
 */
export function outputStem(archive: string, filename: string): string {
  const imageStem = filename.replace(/\.[^./\\]+$/, '');
  return `${sanitize(archive)}__${sanitize(imageStem)}`;
}

/** Anything that is not a filename character, collapsed to `-`. */
function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '-');
}
