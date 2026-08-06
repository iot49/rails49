import { describe, it, expect } from 'vitest';
import { missingLayoutMetadata } from '../src/requiredMetadata.ts';
import type { Layout } from '@occupancy/r49';

/** A layout satisfying the gate, spread-and-overridden per test. */
function layout(over: Partial<Layout> = {}): Layout {
  return {
    name: 'West Yard',
    scale: 'HO',
    calibration: { points: [], camera_height_mm: 1150 },
    sensors: [],
    ...over,
  } as Layout;
}

const point = (z: number) => ({ px: { x: 0, y: 0 }, world: { x: 0, y: 0, z } });
const fields = (l: Layout | null) => missingLayoutMetadata(l).map(m => m.field);

describe('missingLayoutMetadata', () => {
  it('is satisfied by a complete layout', () => {
    expect(missingLayoutMetadata(layout())).toEqual([]);
  });

  it('says nothing when there is no layout at all', () => {
    // Nothing is open, so nothing is owed — the gate must not fire on an empty
    // app and demand metadata for an archive that does not exist.
    expect(missingLayoutMetadata(null)).toEqual([]);
    expect(missingLayoutMetadata(undefined)).toEqual([]);
  });

  it('requires a name, treating blank as absent', () => {
    expect(fields(layout({ name: '' }))).toEqual(['name']);
    expect(fields(layout({ name: '   ' }))).toEqual(['name']);
  });

  it('requires a camera height', () => {
    expect(fields(layout({ calibration: { points: [] } }))).toEqual(['camera_height_mm']);
  });

  it('reports every missing field at once, not one at a time', () => {
    // A gate that revealed its next demand only after the last was satisfied
    // would be a worse experience than one list stated up front.
    expect(fields(layout({ name: '', calibration: { points: [] } }))).toEqual([
      'name',
      'camera_height_mm',
    ]);
  });

  it('does not require scale, which the schema already guarantees', () => {
    // A new archive is created with a placeholder 'N'. There is no
    // representable difference between a confirmed scale and an invented one,
    // and the gate fires on the camera height anyway, which is where a wrong
    // scale gets seen.
    expect(fields(layout({ scale: 'N' }))).toEqual([]);
  });

  describe('the h > max(z) bound', () => {
    it('accepts a camera above every calibration point', () => {
      expect(fields(layout({ calibration: { points: [point(0), point(85)], camera_height_mm: 1150 } })))
        .toEqual([]);
    });

    it('catches the decimal slip the fit residual cannot see', () => {
      // 115 for 1150, against points on one plane — the case from the corpus.
      // A single-plane calibration normalizes by (h−z_ref)/h = 1 for *any* h,
      // so the residual is blind and this bound is the only thing left.
      const missing = missingLayoutMetadata(
        layout({ calibration: { points: [point(230)], camera_height_mm: 115 } }),
      );
      expect(missing.map(m => m.field)).toEqual(['camera_height_mm']);
      expect(missing[0].message).toContain('115 mm');
      expect(missing[0].message).toContain('230 mm');
    });

    it('rejects a camera exactly at the tallest point', () => {
      // Not merely degenerate arithmetic: at h = z the scale is infinite.
      expect(fields(layout({ calibration: { points: [point(500)], camera_height_mm: 500 } })))
        .toEqual(['camera_height_mm']);
    });

    it('cannot judge the height with no calibration points', () => {
      // Nothing to compare against, so the height stands. The bound is a
      // cross-check on authored geometry, not an independent plausibility test.
      expect(fields(layout({ calibration: { points: [], camera_height_mm: 5 } }))).toEqual([]);
    });
  });
});
