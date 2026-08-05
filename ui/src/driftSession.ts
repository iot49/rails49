/**
 * Opening a drift check against an archive, in one place.
 *
 * Two surfaces need one — the live view refuses to classify on it (#94) and the
 * editor warns on it (#95) — and everything platform-specific about getting
 * there lives here rather than in either. `@occupancy/drift` takes a
 * `GrayPlane`, deliberately: `ImageData` does not exist in Node and the
 * benchmark is a first-class consumer, so somebody has to hold the canvas, and
 * this is the `detectorSession.ts` of the drift path.
 *
 * **References are decoded at their native resolution and that is load-bearing.**
 * `DriftResult.displacementPx` is reported in the frame of the first reference,
 * so handing the check pre-shrunk images would silently rescale every number —
 * and `layout.max_drift_px` is authored in `camera.resolution` pixels. The check
 * clamps to its own working resolution internally; letting it do that is what
 * keeps the constant meaning one thing.
 */

import { createDriftCheck, fromImageData } from '@occupancy/drift';
import type { DriftCheck, GrayPlane } from '@occupancy/drift';
import type { R49Archive } from '@occupancy/r49';

/**
 * A drift check, plus the names of what it is checking against.
 *
 * The names exist because `DriftResult.refIndex` indexes the references *as
 * handed to the check*, and that is not `manifest.images`: an image whose bytes
 * are missing from the zip is skipped, so every index past it would be off by
 * one. The editor names the image its warning is about, and a warning naming
 * the wrong image is worse than one naming none.
 */
export interface DriftSession {
  readonly check: DriftCheck;
  /** Manifest filenames, parallel to `DriftResult.refIndex`. */
  readonly refNames: readonly string[];
}

/**
 * One scratch canvas for every grab, resized in place.
 *
 * A canvas per frame is a canvas per frame's worth of garbage, and the live view
 * grabs one every few seconds for the length of a session. Reused rather than
 * pooled because nothing here is re-entrant: a grab is synchronous from
 * `drawImage` to `getImageData`, so no second caller can be mid-grab.
 */
let scratch: HTMLCanvasElement | null = null;

function scratchContext(width: number, height: number): CanvasRenderingContext2D {
  scratch ??= document.createElement('canvas');
  if (scratch.width !== width || scratch.height !== height) {
    scratch.width = width;
    scratch.height = height;
  }
  const ctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('drift: no 2d canvas context');
  return ctx;
}

/**
 * Read a drawable source into a grayscale plane at the given size.
 *
 * The size is the caller's because only it knows what the source's intrinsic
 * dimensions are — `videoWidth` for a stream, `naturalWidth` for an image — and
 * a zero there means a source that is not ready yet rather than an error.
 *
 * @throws if `width` or `height` is below 1, or the canvas yields no context
 */
export function grabPlane(source: CanvasImageSource, width: number, height: number): GrayPlane {
  if (width < 1 || height < 1) {
    throw new Error(`drift: cannot grab a ${width}x${height} frame`);
  }
  const ctx = scratchContext(width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return fromImageData(ctx.getImageData(0, 0, width, height));
}

/** Decode image bytes from an archive into a plane at their native size. */
export async function planeFromBytes(bytes: Uint8Array): Promise<GrayPlane> {
  // The same Blob dance `rr-editor-view._refreshImageUrls` does, for the same
  // reason: the archive holds bytes and the platform decodes blobs.
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/jpeg' }));
  try {
    return grabPlane(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}

/**
 * Build a drift check from an archive's images.
 *
 * Returns `null` when no reference survives, which is a real state and not an
 * error: a layout that has just been created has nothing to have drifted *from*,
 * and an image being compared against an archive that held nothing else is the
 * first image rather than a drifted one. Both callers say so rather than
 * treating it as a failure — "cannot tell" and "no drift" are different claims
 * and this is the first.
 *
 * @param options.exclude a filename to leave out of the reference set. The
 *        editor needs it: a freshly added image is already in the manifest by
 *        the time it can be checked, and an image compared against itself
 *        reports zero drift forever.
 * @throws whatever decoding or `createDriftCheck` throws. Callers report it;
 *         neither treats a missing drift check as fatal.
 */
export async function openDriftCheck(
  archive: R49Archive,
  options: { exclude?: string } = {},
): Promise<DriftSession | null> {
  const manifest = archive.getManifest();
  const refs: GrayPlane[] = [];
  const refNames: string[] = [];
  for (const { filename } of manifest.images) {
    if (filename === options.exclude) continue;
    const bytes = await archive.getImage(filename);
    if (!bytes) continue;
    refs.push(await planeFromBytes(bytes));
    refNames.push(filename);
  }
  if (refs.length === 0) return null;
  return { check: await createDriftCheck(refs), refNames };
}
