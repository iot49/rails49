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

/**
 * The markers the corpus's `CONTRIBUTING.md` wraps the generated block in.
 *
 * The opening marker sits inside an HTML comment that also carries the command
 * that produces the block, so it spans several lines; the block itself starts
 * after that comment closes.
 */
const GENERATED_BEGIN = 'BEGIN GENERATED';
const GENERATED_END = 'END GENERATED';

/** CRLF and trailing spaces are noise; a Windows contributor must not fail on them. */
function normalise(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

/**
 * The generated block out of a markdown document, or `null` when the markers
 * are missing or out of order.
 *
 * Blank padding either side of the block is not part of it — the markers are a
 * comment, and how much air a document leaves around a comment is prose.
 */
export function extractGeneratedBlock(markdown: string): string | null {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');

  const beginAt = lines.findIndex(line => line.includes(GENERATED_BEGIN));
  if (beginAt === -1) return null;

  // The opening comment may close on its own line or several lines later.
  let openerEndsAt = beginAt;
  while (openerEndsAt < lines.length && !lines[openerEndsAt].includes('-->')) openerEndsAt++;
  if (openerEndsAt === lines.length) return null;

  const endAt = lines.findIndex(
    (line, i) => i > openerEndsAt && line.includes(GENERATED_END)
  );
  if (endAt === -1) return null;

  return normalise(lines.slice(openerEndsAt + 1, endAt).join('\n'));
}

/**
 * Whether a document's generated block still matches what `guidanceTable`
 * produces — the check the corpus workflow runs on **every** pull request.
 *
 * It lives here, and not in the workflow's YAML, for the reason `corpus.ts`
 * gives about the path rules: `pnpm test` covers this and a workflow's YAML is
 * never covered by anything. The wording matters more here than anywhere else
 * in the tool, because the usual cause of a failure is `min_dpt` moving in
 * `rails49` — a repository the contributor reading the message has never
 * touched.
 */
export function checkGuidance(
  markdown: string,
  widthPx: number = REFERENCE_WIDTH_PX
): { ok: boolean; message: string } {
  const expected = normalise(guidanceTable(widthPx));
  const found = extractGeneratedBlock(markdown);

  if (found === null) {
    return {
      ok: false,
      message:
        `The generated capture-guidance block is missing or malformed: no "${GENERATED_BEGIN}" ` +
        `comment, no closing "${GENERATED_END}", or the two in the wrong order. The block is ` +
        `derived from rails49's layout.min_dpt and must not be deleted — restore the markers ` +
        `and put this between them:\n\n${expected}\n`,
    };
  }

  if (found === expected) {
    return { ok: true, message: 'The capture-guidance table is up to date.' };
  }

  return {
    ok: false,
    message:
      `The capture-guidance table is out of date.\n\n` +
      `**This is almost certainly not about your submission.** The table is derived from ` +
      `layout.min_dpt in rails49, and the corpus validates against rails49 at main — so a ` +
      `change there makes the next pull request here red no matter what it touched. The fix ` +
      `is one command, and a maintainer can do it if you would rather not.\n\n` +
      `In a rails49 checkout, run:\n\n` +
      `    pnpm --silent --filter @occupancy/r49-validate guidance\n\n` +
      `and paste its output between the generated-block markers in CONTRIBUTING.md.\n\n` +
      `Expected:\n\n${expected}\n\nFound:\n\n${found}\n`,
  };
}
