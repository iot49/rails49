import { MIN_DPT, SCALES, SCALE_TO_RATIO, STANDARD_GAUGE } from '@occupancy/config';

/**
 * The capture-guidance table `CONTRIBUTING.md` carries in the corpus repo:
 * the widest strip of track that may span a reference frame and still clear
 * `min_dpt`.
 *
 * **Printed, never typed.** `layout.min_dpt` is provisional — set without
 * rigorous analysis, likely to move, possibly to differ per model — so a table
 * hand-written into a document in another repository would be `min_dpt` living
 * in two places with nothing checking that they agree. The corpus workflow
 * diffs the committed prose against this output, which is why it is emitted in
 * a fixed column order with fixed rounding: a diff against prose is only useful
 * when the output is deterministic.
 *
 * ```
 * DPT          = px_per_mm × gauge_mm
 * gauge_mm     = STANDARD_GAUGE / SCALE_TO_RATIO[scale]
 * max_frame_mm = width_px × gauge_mm / MIN_DPT
 * ```
 */

/**
 * The reference frame the committed table is computed for.
 *
 * 1920 is what every image in the corpus is today and what a plain 1080p frame
 * gives. The numbers scale linearly with width, so a contributor shooting wider
 * may print their own table — but the committed guidance stays the conservative
 * one, because a bar set from the best-case camera is a bar that anyone
 * shooting at 1080p reads and then misses by half.
 */
export const REFERENCE_WIDTH_PX = 1920;

/** The widest strip of track, in mm, that may span a frame of `widthPx`. */
export function maxFrameMM(scale: keyof typeof SCALE_TO_RATIO, widthPx: number): number {
  const gaugeMM = STANDARD_GAUGE / SCALE_TO_RATIO[scale];
  return (widthPx * gaugeMM) / MIN_DPT;
}

/**
 * The table, as markdown, ready to paste between the generated-block markers in
 * `CONTRIBUTING.md`.
 *
 * The reference width is stated **in the output** because it is an input to
 * every number below it, not a constant — a reader who does not know which
 * frame the table describes cannot use it.
 */
export function guidanceTable(widthPx: number = REFERENCE_WIDTH_PX): string {
  const lines = [
    `Reference frame: **${widthPx} px** wide. Minimum DPT: **${MIN_DPT}**.`,
    '',
    '| Scale | Ratio | Track gauge | Widest track that may span the frame |',
    '| :--- | ---: | ---: | ---: |',
  ];

  for (const scale of SCALES) {
    const gaugeMM = STANDARD_GAUGE / SCALE_TO_RATIO[scale];
    const frameMM = maxFrameMM(scale, widthPx);
    lines.push(
      `| ${scale} | 1:${SCALE_TO_RATIO[scale]} | ${gaugeMM.toFixed(2)} mm | ` +
        `${frameMM.toFixed(0)} mm (${(frameMM / 1000).toFixed(2)} m) |`
    );
  }

  lines.push(
    '',
    'Shoot a **narrower** strip than the figure for your scale and you are above the minimum;',
    'shoot a wider one and cars are too few pixels across to localise reliably. The numbers',
    `scale linearly with image width — at ${widthPx * 2} px they double.`
  );

  return lines.join('\n');
}
