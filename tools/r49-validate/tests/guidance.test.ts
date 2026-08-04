import { describe, it, expect } from 'vitest';
import { MIN_DPT, SCALES, SCALE_TO_RATIO, STANDARD_GAUGE } from '@occupancy/config';
import {
  checkGuidance,
  extractGeneratedBlock,
  guidanceTable,
  maxFrameMM,
  REFERENCE_WIDTH_PX,
} from '../src/guidance.ts';

/** A CONTRIBUTING.md shaped like the corpus's, wrapped around whatever block. */
function document(block: string): string {
  return [
    '# Contributing',
    '',
    'The widest strip of track that may span one frame:',
    '',
    '<!-- BEGIN GENERATED — do not edit by hand.',
    '     Produced in the rails49 checkout by:',
    '       pnpm --silent --filter @occupancy/r49-validate guidance',
    '     CI diffs this block against that command output. -->',
    '',
    block,
    '',
    '<!-- END GENERATED -->',
    '',
    'So for HO: about 1.6 m of track in frame.',
  ].join('\n');
}

describe('capture guidance', () => {
  it('derives the frame width from the same arithmetic getDPT uses', () => {
    // DPT = px_per_mm × gauge_mm, so the widest frame that still clears
    // MIN_DPT is width_px × gauge_mm / MIN_DPT. Asserted against the identity
    // rather than against a number, so a change to MIN_DPT moves both sides.
    for (const scale of SCALES) {
      const gaugeMM = STANDARD_GAUGE / SCALE_TO_RATIO[scale];
      const frameMM = maxFrameMM(scale, 1920);
      expect((1920 / frameMM) * gaugeMM).toBeCloseTo(MIN_DPT, 10);
    }
  });

  it('scales linearly with image width', () => {
    expect(maxFrameMM('HO', 3840)).toBeCloseTo(maxFrameMM('HO', 1920) * 2, 10);
  });

  it('states the reference width, because it is an input and not a constant', () => {
    expect(guidanceTable(1920)).toContain('1920 px');
    expect(guidanceTable(4032)).toContain('4032 px');
  });

  it('names the minimum DPT the numbers were computed against', () => {
    expect(guidanceTable()).toContain(String(MIN_DPT));
  });

  it('emits one row per scale, in the order config.yaml defines them', () => {
    const rows = guidanceTable()
      .split('\n')
      .filter(line => line.startsWith('| ') && !line.startsWith('| Scale') && !line.startsWith('| :'));

    expect(rows).toHaveLength(SCALES.length);
    expect(rows.map(row => row.split('|')[1].trim())).toEqual([...SCALES]);
  });

  it('is byte-identical across calls, since CI diffs it against committed prose', () => {
    expect(guidanceTable()).toBe(guidanceTable());
    expect(guidanceTable()).toBe(guidanceTable(REFERENCE_WIDTH_PX));
  });

  it('rounds to fixed precision rather than printing raw floats', () => {
    // A diff against prose is only useful when the output is deterministic —
    // and 16.494252873563218 mm would change with any refactor of the maths.
    expect(guidanceTable()).toContain('16.49 mm');
    expect(guidanceTable()).not.toMatch(/\d\.\d{4}/);
  });
});

describe('the generated block', () => {
  it('is read out from between the markers, ignoring the padding around them', () => {
    expect(extractGeneratedBlock(document(guidanceTable()))).toBe(guidanceTable());
  });

  it('survives a CRLF checkout and trailing whitespace', () => {
    const crlf = document(guidanceTable()).replace(/\n/g, ' \r\n');
    expect(checkGuidance(crlf).ok).toBe(true);
  });

  it('is absent when a marker is missing, deleted or reversed', () => {
    const block = guidanceTable();
    expect(extractGeneratedBlock(`no markers at all\n${block}`)).toBeNull();
    expect(
      extractGeneratedBlock(document(block).replace('<!-- END GENERATED -->', ''))
    ).toBeNull();
    expect(extractGeneratedBlock('<!-- END GENERATED -->\n<!-- BEGIN GENERATED -->')).toBeNull();
  });

  it('passes the table it was generated from, at any width', () => {
    expect(checkGuidance(document(guidanceTable())).ok).toBe(true);
    expect(checkGuidance(document(guidanceTable(4032)), 4032).ok).toBe(true);
  });

  it('fails a table generated for a different width', () => {
    // The stand-in for the real failure: MIN_DPT moving in rails49 while the
    // corpus still carries the old numbers. Width is the input a test can move.
    expect(checkGuidance(document(guidanceTable(4032))).ok).toBe(false);
  });

  it('fails a hand-edited row, which is the whole point of diffing prose', () => {
    const tampered = guidanceTable().replace('16.49 mm', '16.50 mm');
    expect(checkGuidance(document(tampered)).ok).toBe(false);
  });

  it('tells a contributor the failure is probably not theirs, and how to fix it', () => {
    // The message is the deliverable here: the usual cause is a change in a
    // repository the person reading it has never touched.
    const { message } = checkGuidance(document(guidanceTable(4032)));
    expect(message).toContain('not about your submission');
    expect(message).toContain('layout.min_dpt');
    expect(message).toContain('pnpm --silent --filter @occupancy/r49-validate guidance');
    expect(message).toContain('CONTRIBUTING.md');
  });

  it('offers the block to paste when the markers are gone', () => {
    const { ok, message } = checkGuidance('# Contributing\n\nnothing generated here.\n');
    expect(ok).toBe(false);
    expect(message).toContain(guidanceTable());
  });
});
