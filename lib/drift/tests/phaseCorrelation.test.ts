import { describe, it, expect } from 'vitest';
import {
  BLOCK_SIZE,
  MIN_BLOCK_SIZE,
  blockGrid,
  chooseBlockSize,
} from '../src/phaseCorrelation.ts';

/**
 * The grid, on its own. What the correlation *measures* is tested through the
 * published interface in driftCheck.test.ts — this is only the tiling, which
 * has no observable behaviour of its own and one property worth pinning: frame
 * and reference must land on the same pixels.
 */

describe('chooseBlockSize', () => {
  it('uses the validated block size when it fits', () => {
    expect(chooseBlockSize(960, 540)).toBe(BLOCK_SIZE);
    expect(chooseBlockSize(128, 128)).toBe(BLOCK_SIZE);
  });

  it('steps down by powers of two for a plane too small for it', () => {
    expect(chooseBlockSize(200, 100)).toBe(64);
    expect(chooseBlockSize(200, 60)).toBe(32);
  });

  it('refuses a plane smaller than the floor', () => {
    expect(() => chooseBlockSize(200, 20)).toThrow(/at least 32px/);
  });

  it('never returns a size below the floor', () => {
    for (let side = MIN_BLOCK_SIZE; side <= 300; side++) {
      expect(chooseBlockSize(side, side)).toBeGreaterThanOrEqual(MIN_BLOCK_SIZE);
    }
  });
});

describe('blockGrid', () => {
  it('tiles with whole blocks and centres the leftover', () => {
    // 960x540 at 128: 7 columns (896 px) leaves 64, so 32 a side; 4 rows
    // (512 px) leaves 28, so 14 a side.
    const grid = blockGrid(960, 540);
    expect(grid).toEqual({ size: 128, cols: 7, rows: 4, offsetX: 32, offsetY: 14 });
  });

  it('keeps every block inside the plane', () => {
    for (const [w, h] of [
      [960, 540],
      [256, 256],
      [300, 200],
      [129, 128],
    ]) {
      const g = blockGrid(w, h);
      expect(g.offsetX + g.cols * g.size).toBeLessThanOrEqual(w);
      expect(g.offsetY + g.rows * g.size).toBeLessThanOrEqual(h);
      expect(g.cols * g.rows).toBeGreaterThanOrEqual(1);
    }
  });
});
