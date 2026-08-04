import type { Frame } from './types.ts';

/**
 * The two coordinate changes between the picture handed to `detect` and the
 * frame it answers in, kept apart from the ORT session so both are testable
 * without a model.
 *
 * Nothing outside this package sees either of them. That is the point of
 * `detect` taking a report frame: the model grid, the padding bars and the
 * source's own pixel count all stay inside, so a re-export at a different input
 * size changes nothing a caller can observe.
 */

/** How a source frame sits inside the model's input grid. */
export interface Letterbox {
  /** Isotropic source→grid scale. */
  readonly scale: number;
  /** Half the horizontal bar, in grid px. */
  readonly padX: number;
  /** Half the vertical bar, in grid px. */
  readonly padY: number;
  /** The drawn content's size in grid px — `source × scale`. */
  readonly drawn: Frame;
}

/**
 * Fit a source frame into the model's input grid, preserving aspect.
 *
 * Letterbox rather than stretch, and **not** inherited from the export path —
 * decided against it. Training ran at `imgsz=960` *square* while the export is
 * 960×544, so the model was trained on content scaled down with gray bars: the
 * bars are in-distribution. On a 16:9 corpus the two differ by about 2 px of
 * bar per edge, but the deployment target is not 16:9 — one camera over a
 * 2000×960 mm layout at ≥20 DPT in N scale is ≈4440×2130, aspect 2.08:1, where
 * a stretch delivers every car ~15% short along its length. `ui/src/capture.ts`
 * also asks for 1920×1080 as `ideal`, not `exact`, so a non-16:9 source is not
 * hypothetical today either.
 */
export function letterbox(source: Frame, grid: Frame): Letterbox {
  const scale = Math.min(grid.width / source.width, grid.height / source.height);
  const drawn = { width: source.width * scale, height: source.height * scale };

  return {
    scale,
    padX: (grid.width - drawn.width) / 2,
    padY: (grid.height - drawn.height) / 2,
    drawn,
  };
}

/**
 * The inverse map, grid px back to the caller's report frame: subtract the bar,
 * then scale by however far the report frame is from the source's own pixel
 * count.
 *
 * Two factors rather than one because the report frame need not have the
 * source's aspect — `camera.resolution` is what sensors and calibration are
 * authored in, and the captured video may be a different pixel count and, on a
 * device that ignores the requested aspect, a different shape. When they do
 * share an aspect (the ordinary case) `kx` and `ky` are equal and the map is a
 * similarity, which is what makes an angle and a length meaningful after it.
 */
export interface GridToReport {
  readonly kx: number;
  readonly ky: number;
  readonly padX: number;
  readonly padY: number;
}

export function gridToReport(source: Frame, grid: Frame, report: Frame): GridToReport {
  const fit = letterbox(source, grid);

  return {
    kx: report.width / fit.drawn.width,
    ky: report.height / fit.drawn.height,
    padX: fit.padX,
    padY: fit.padY,
  };
}

/** A grid-space point, in the report frame. */
export function mapPoint(map: GridToReport, x: number, y: number): { x: number; y: number } {
  return { x: (x - map.padX) * map.kx, y: (y - map.padY) * map.ky };
}

/**
 * A grid-space *vector*, in the report frame — the same map without the
 * translation, since a difference of two points loses the bars.
 */
export function mapVector(map: GridToReport, x: number, y: number): { x: number; y: number } {
  return { x: x * map.kx, y: y * map.ky };
}
