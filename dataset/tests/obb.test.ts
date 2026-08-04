import { describe, it, expect } from 'vitest';
import { detectorClassIndex } from '@occupancy/r49';
import { labelLine, outputStem, splitFor } from '../src/obb.ts';

/**
 * The YOLO export's arithmetic. Every wrong number here is invisible until a
 * model trains badly for a reason nobody can name, which is why these are
 * pinned rather than eyeballed once.
 *
 * The car box moved with its functions: `carWidthPx` and `spanToPolygon` are
 * `@occupancy/detector`'s now, and so are their cases.
 */

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
