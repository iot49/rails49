import { describe, it, expect } from 'vitest';
import { MIN_DPT, SCALES, SCALE_TO_RATIO, STANDARD_GAUGE } from '@occupancy/config';
import { guidanceTable, maxFrameMM, REFERENCE_WIDTH_PX } from '../src/guidance.ts';

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
