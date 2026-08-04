import { describe, it, expect } from 'vitest';
import { detectorClassIndex } from '@occupancy/r49';
import { carWidthPx, labelLine, outputStem, spanToPolygon, splitFor } from '../src/obb.ts';

/**
 * The YOLO export's arithmetic. Every wrong number here is invisible until a
 * model trains badly for a reason nobody can name, which is why these are
 * pinned rather than eyeballed once against a rendered box.
 */

const FRAME = { width: 1000, height: 500 };

describe('car width', () => {
  it('is 2.09 track widths, whatever the scale', () => {
    // 3000 / 1435. The scale ratio cancels out of DPT * width / gauge, so this
    // ratio is the same number in every scale — the property the format leans
    // on to avoid storing width per label.
    expect(carWidthPx(1)).toBeCloseTo(2.0906, 4);
    expect(carWidthPx(18.5) / carWidthPx(1)).toBeCloseTo(18.5, 10);
  });
});

describe('span to polygon', () => {
  it('offsets a horizontal chord by half a car in each direction', () => {
    const { corners, clamped } = spanToPolygon(
      { id: 'a', p0: { x: 100, y: 250 }, p1: { x: 300, y: 250 } },
      50,
      FRAME
    );

    expect(clamped).toBe(0);
    // Normalized: x/1000, y/500. The chord runs along +x, so the normal is
    // along y and the corners sit at 250 ± 25 px = 0.55 / 0.45. They come out
    // walking the perimeter — p0+n, p1+n, p1-n, p0-n — not as two pairs.
    expect([...corners]).toEqual([0.1, 0.55, 0.3, 0.55, 0.3, 0.45, 0.1, 0.45]);
  });

  it('rotates the offset with the chord', () => {
    // A vertical chord: the normal now runs along x.
    const { corners } = spanToPolygon(
      { id: 'a', p0: { x: 500, y: 100 }, p1: { x: 500, y: 300 } },
      100,
      FRAME
    );

    expect([...corners]).toEqual([0.45, 0.2, 0.45, 0.6, 0.55, 0.6, 0.55, 0.2]);
  });

  it('keeps the box the length of the chord, not longer', () => {
    const { corners } = spanToPolygon(
      { id: 'a', p0: { x: 200, y: 100 }, p1: { x: 600, y: 400 } },
      40,
      FRAME
    );

    // Corner 0 and corner 3 straddle p0; their midpoint must be p0 itself.
    expect((corners[0] + corners[6]) / 2).toBeCloseTo(0.2, 10);
    expect((corners[1] + corners[7]) / 2).toBeCloseTo(0.2, 10);
    // Likewise corners 1 and 2 straddle p1.
    expect((corners[2] + corners[4]) / 2).toBeCloseTo(0.6, 10);
    expect((corners[3] + corners[5]) / 2).toBeCloseTo(0.8, 10);
  });

  it('clamps a car at the frame edge and says how many corners moved', () => {
    const { corners, clamped } = spanToPolygon(
      { id: 'a', p0: { x: 10, y: 4 }, p1: { x: 300, y: 4 } },
      40,
      FRAME
    );

    // y = 4 ± 20 px, so the two corners on the -n side land at -16 px and are
    // pulled to 0. They are the last two in perimeter order.
    expect(clamped).toBe(2);
    expect(corners.every(c => c >= 0 && c <= 1)).toBe(true);
    expect(corners[5]).toBe(0);
    expect(corners[7]).toBe(0);
  });

  it('refuses a zero-length span rather than inventing an orientation', () => {
    expect(() =>
      spanToPolygon({ id: 'squashed', p0: { x: 5, y: 5 }, p1: { x: 5, y: 5 } }, 40, FRAME)
    ).toThrow(/squashed/);
  });
});

describe('label lines', () => {
  it('are the class index followed by eight fixed-width corners', () => {
    expect(labelLine(0, [0.1, 0.45, 0.3, 0.45, 0.3, 0.55, 0.1, 0.55])).toBe(
      '0 0.100000 0.450000 0.300000 0.450000 0.300000 0.550000 0.100000 0.550000'
    );
  });
});

describe('the class index', () => {
  it('maps every authored subtype onto the one trained class', () => {
    // The whole authoring taxonomy trains as `stock` today, which is what lets
    // the editor offer subtypes before any of them is a class of its own.
    for (const cls of ['stock', 'stock.freight', 'stock.loco', 'stock.loco.steam']) {
      expect(detectorClassIndex(cls)).toBe(0);
    }
  });

  it('does not treat a longer word as a subtype', () => {
    expect(detectorClassIndex('stockyard')).toBeNull();
    expect(detectorClassIndex('rolling.stock')).toBeNull();
    expect(detectorClassIndex('')).toBeNull();
  });

  it('prefers the longest matching entry, which is what makes appending safe', () => {
    // Appending `stock.loco` re-maps locomotives onto the new index with no
    // relabeling, while a plain `stock` car stays where it was.
    const classes = ['stock', 'stock.loco'];
    expect(detectorClassIndex('stock.loco.steam', classes)).toBe(1);
    expect(detectorClassIndex('stock.loco', classes)).toBe(1);
    expect(detectorClassIndex('stock.freight', classes)).toBe(0);
    expect(detectorClassIndex('stock', classes)).toBe(0);
  });
});

describe('the split', () => {
  it('is stable across runs and independent of the order archives are read', () => {
    expect(splitFor('lighting', 'image-0.jpeg', 0.2)).toBe(
      splitFor('lighting', 'image-0.jpeg', 0.2)
    );
  });

  it('keeps every car in a frame on one side, by keying on the image', () => {
    // Nothing about a label enters the key, so two cars in one frame cannot
    // land in different splits.
    expect(splitFor('a', 'image-0.jpeg', 0.2)).toBe(splitFor('a', 'image-0.jpeg', 0.2));
  });

  it('separates identically-named images from different archives', () => {
    // Every archive in the corpus calls its first frame image-0.jpeg.
    const names = ['cars-0-10', 'cars-11-17', 'lighting', 'simple'];
    const keys = names.map(n => `${n}:${splitFor(n, 'image-0.jpeg', 0.2)}`);
    expect(new Set(keys).size).toBe(names.length);
  });

  it('sends everything to val at 1 and nothing at 0', () => {
    const cases = [
      ['a', 'image-0.jpeg'],
      ['b', 'image-9.jpeg'],
      ['c', 'frame.jpg'],
    ] as const;
    expect(cases.map(([a, f]) => splitFor(a, f, 1))).toEqual(['val', 'val', 'val']);
    expect(cases.map(([a, f]) => splitFor(a, f, 0))).toEqual(['train', 'train', 'train']);
  });
});

describe('output stems', () => {
  it('qualify the image by its archive, so colliding names survive', () => {
    expect(outputStem('cars-0-10', 'image-0.jpeg')).toBe('cars-0-10__image-0');
    expect(outputStem('lighting', 'image-0.jpeg')).toBe('lighting__image-0');
  });

  it('strip only the extension, and only the last one', () => {
    expect(outputStem('a', 'frame.2.jpg')).toBe('a__frame.2');
  });

  it('collapse anything that is not a filename character', () => {
    expect(outputStem('club layout/west', 'image 0.jpeg')).toBe('club-layout-west__image-0');
  });
});
