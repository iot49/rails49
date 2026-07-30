import { describe, it, expect } from 'vitest';
import { R49Archive, getDPT } from '../src/index.ts';
import type { ManifestData } from '../src/index.ts';

// One seam: the archive. Every test here drives the package's public interface
// — build or load an archive, mutate the manifest, export, reload the bytes,
// assert on what comes back. Nothing reaches for a zod schema object, asserts
// on a parse error's internal shape, or imports a sibling module to check an
// intermediate: the schemas are deliberately withheld from index.ts so that
// validation stays replaceable, and a test that pinned them down would undo
// that.

/** A minimal valid v4 manifest, spread-and-overridden per test. */
function manifest(overrides: Record<string, unknown> = {}): ManifestData {
  return {
    version: 4,
    layout: { name: 'Test Layout', scale: 'HO', calibration: { points: [] }, sensors: [] },
    camera: { resolution: { width: 1920, height: 1080 } },
    images: [],
    ...overrides,
  } as ManifestData;
}

/** Round-trip through the real serializer: set, export bytes, load them back. */
async function roundTrip(data: ManifestData): Promise<R49Archive> {
  const archive = new R49Archive();
  archive.setManifest(data);
  return await R49Archive.load(await archive.export());
}

/** Assert that setting this manifest is rejected, and return the message. */
function rejection(data: unknown): string {
  const archive = new R49Archive();
  try {
    archive.setManifest(data as ManifestData);
  } catch (err) {
    return String(err);
  }
  throw new Error('expected the manifest to be rejected, but it was accepted');
}

const car = (over: Record<string, unknown> = {}) => ({
  id: 'car-1',
  class: 'stock',
  p0: { x: 10, y: 20 },
  p1: { x: 110, y: 25 },
  provenance: 'human',
  ...over,
});

/** Calibration point at pixel (px) and world (world), z defaulting to 0. */
const cal = (px: [number, number], world: [number, number, number?]) => ({
  px: { x: px[0], y: px[1] },
  world: { x: world[0], y: world[1], z: world[2] ?? 0 },
});

describe('R49Archive', () => {
  describe('round trip', () => {
    it('preserves cars in all three provenance variants', async () => {
      const loaded = await roundTrip(manifest({
        images: [{
          filename: 'a.jpg',
          labeled_complete: true,
          labels: [
            car({ id: 'a', provenance: 'human' }),
            car({ id: 'b', provenance: 'proposed', proposed_by: 'v1.0.0' }),
            car({ id: 'c', class: 'stock.loco.steam', provenance: 'corrected', proposed_by: 'v2' }),
          ],
        }],
      }));

      const labels = loaded.getManifest().images[0].labels;
      expect(labels).toHaveLength(3);
      expect(labels[0]).toEqual(car({ id: 'a', provenance: 'human' }));
      expect(labels[1]).toEqual(car({ id: 'b', provenance: 'proposed', proposed_by: 'v1.0.0' }));
      expect(labels[2]).toEqual(
        car({ id: 'c', class: 'stock.loco.steam', provenance: 'corrected', proposed_by: 'v2' })
      );
    });

    it('preserves sensors with and without names', async () => {
      const loaded = await roundTrip(manifest({
        layout: {
          scale: 'N',
          calibration: { points: [] },
          sensors: [
            { id: 's1', x: 5, y: 6, name: 'yard ladder east' },
            { id: 's2', x: 7, y: 8 },
          ],
        },
      }));

      const sensors = loaded.getManifest().layout.sensors;
      expect(sensors[0]).toEqual({ id: 's1', x: 5, y: 6, name: 'yard ladder east' });
      // A nameless sensor stays nameless — nothing invents a "Sensor 2".
      expect(sensors[1]).toEqual({ id: 's2', x: 7, y: 8 });
      expect('name' in sensors[1]).toBe(false);
    });

    it('preserves multi-point calibration and mixed labeled_complete', async () => {
      const loaded = await roundTrip(manifest({
        layout: {
          scale: 'HO',
          sensors: [],
          calibration: { points: [cal([0, 0], [0, 0]), cal([100, 0], [10, 0]), cal([50, 50], [5, 5, 12])] },
        },
        images: [
          { filename: 'a.jpg', labeled_complete: true, labels: [] },
          { filename: 'b.jpg', labeled_complete: false, labels: [] },
        ],
      }));

      const m = loaded.getManifest();
      expect(m.layout.calibration.points).toHaveLength(3);
      expect(m.layout.calibration.points[2]).toEqual(cal([50, 50], [5, 5, 12]));
      expect(m.images.map(i => i.labeled_complete)).toEqual([true, false]);
    });

    it('preserves layout metadata and camera resolution', async () => {
      const loaded = await roundTrip(manifest({
        layout: {
          name: 'Basement', description: 'HO switching layout', contact: 'a@b.c',
          scale: 'HO', calibration: { points: [] }, sensors: [],
        },
        camera: { resolution: { width: 4032, height: 3024 }, model: 'iPhone 13' },
      }));

      const m = loaded.getManifest();
      expect(m.layout).toMatchObject({
        name: 'Basement', description: 'HO switching layout', contact: 'a@b.c', scale: 'HO',
      });
      expect(m.camera).toEqual({ resolution: { width: 4032, height: 3024 }, model: 'iPhone 13' });
    });
  });

  describe('version', () => {
    it('rejects a v3 manifest, naming the version', () => {
      const message = rejection({
        version: 3,
        layout: { name: 'Old', scale: 'N', calibration: { p0: { x: 0, y: 0 }, p1: { x: 1, y: 1 }, size_mm: 1 } },
        camera: { resolution: { width: 640, height: 480 } },
        images: [{ filename: '1.jpg', labels: {} }],
      });
      expect(message).toContain('version');
      expect(message).toContain('3');
    });

    it('rejects a v3 archive on load, naming the version', async () => {
      // Build v3 bytes the way v3 wrote them, bypassing the v4 validator.
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      zip.file('manifest.json', JSON.stringify({
        version: 3,
        layout: { scale: 'N' },
        camera: { resolution: { width: 640, height: 480 } },
        images: [{ filename: '1.jpg', labels: { m1: { x: 1, y: 2, type: 'track' } } }],
      }));
      const bytes = await zip.generateAsync({ type: 'uint8array' });

      await expect(R49Archive.load(bytes)).rejects.toThrow(/version/i);
    });
  });

  describe('schema invariants, at the boundary', () => {
    it('rejects proposed_by on a human label', () => {
      const m = manifest({
        images: [{ filename: 'a.jpg', labels: [car({ provenance: 'human', proposed_by: 'v1' })] }],
      });
      expect(rejection(m)).toBeTruthy();
    });

    it('rejects a missing proposed_by on proposed and on corrected', () => {
      for (const provenance of ['proposed', 'corrected']) {
        const m = manifest({
          images: [{ filename: 'a.jpg', labels: [car({ provenance })] }],
        });
        expect(rejection(m), `${provenance} without proposed_by`).toBeTruthy();
      }
    });

    it('rejects a missing provenance', () => {
      const { provenance: _omitted, ...withoutProvenance } = car();
      const m = manifest({
        images: [{ filename: 'a.jpg', labels: [withoutProvenance] }],
      });
      expect(rejection(m)).toBeTruthy();
    });

    it('rejects duplicate ids within one collection', () => {
      const dupLabels = manifest({
        images: [{ filename: 'a.jpg', labels: [car({ id: 'x' }), car({ id: 'x' })] }],
      });
      expect(rejection(dupLabels)).toMatch(/duplicate/i);

      const dupSensors = manifest({
        layout: {
          scale: 'N', calibration: { points: [] },
          sensors: [{ id: 'x', x: 1, y: 1 }, { id: 'x', x: 2, y: 2 }],
        },
      });
      expect(rejection(dupSensors)).toMatch(/duplicate/i);
    });

    it('accepts an id shared between a sensor and a label', async () => {
      // Separate namespaces, never compared.
      const loaded = await roundTrip(manifest({
        layout: { scale: 'N', calibration: { points: [] }, sensors: [{ id: 'shared', x: 1, y: 1 }] },
        images: [{ filename: 'a.jpg', labels: [car({ id: 'shared' })] }],
      }));

      expect(loaded.getManifest().layout.sensors[0].id).toBe('shared');
      expect(loaded.getManifest().images[0].labels[0].id).toBe('shared');
    });

    it('accepts an out-of-vocabulary class string', async () => {
      // Pruning config.yaml must not lock anyone out of their own files.
      const loaded = await roundTrip(manifest({
        images: [{ filename: 'a.jpg', labels: [car({ class: 'not.in.any.vocabulary' })] }],
      }));
      expect(loaded.getManifest().images[0].labels[0].class).toBe('not.in.any.vocabulary');
    });

    it('defaults an absent calibration to empty points', async () => {
      const loaded = await roundTrip(manifest({ layout: { scale: 'N' } }));
      expect(loaded.getManifest().layout.calibration).toEqual({ points: [] });
      expect(loaded.getManifest().layout.sensors).toEqual([]);
    });

    it('defaults an absent labeled_complete to false', async () => {
      const loaded = await roundTrip(manifest({ images: [{ filename: 'a.jpg' }] }));
      const image = loaded.getManifest().images[0];
      expect(image.labeled_complete).toBe(false);
      expect(image.labels).toEqual([]);
    });

    it('accepts an image marked complete with zero cars', async () => {
      // A legitimate all-background sample, not a gap.
      const loaded = await roundTrip(manifest({
        images: [{ filename: 'a.jpg', labeled_complete: true, labels: [] }],
      }));
      expect(loaded.getManifest().images[0].labeled_complete).toBe(true);
    });
  });

  describe('getDPT', () => {
    /** HO gauge in mm: 1435 / 87. */
    const HO_GAUGE = 1435 / 87;

    function dptOf(points: ReturnType<typeof cal>[], scale = 'HO') {
      return getDPT(manifest({ layout: { scale, calibration: { points }, sensors: [] } }));
    }

    it('gives the v3 answer for two coplanar points', () => {
      // 100 px over 10 mm => 10 px/mm, the d_px / d_mm the v3 code computed.
      expect(dptOf([cal([0, 0], [0, 0]), cal([100, 0], [10, 0])])).toBeCloseTo(10 * HO_GAUGE, 10);
    });

    it('is unmoved by a third point at a different z', () => {
      const base = [cal([0, 0], [0, 0]), cal([100, 0], [10, 0])];
      const withOffPlane = [...base, cal([500, 500], [1, 1, 25])];
      // Off-plane points are stored but inert.
      expect(dptOf(withOffPlane)).toBeCloseTo(dptOf(base)!, 10);
    });

    it('returns null for empty, single-point, and all-different-height cases', () => {
      expect(dptOf([])).toBeNull();
      expect(dptOf([cal([0, 0], [0, 0])])).toBeNull();
      expect(dptOf([cal([0, 0], [0, 0, 1]), cal([100, 0], [10, 0, 2])])).toBeNull();
    });

    it('returns null for coincident points rather than dividing by zero', () => {
      const result = dptOf([cal([0, 0], [5, 5]), cal([100, 100], [5, 5])]);
      expect(result).toBeNull();
    });

    it('weights a long baseline over a short one', () => {
      // Three coplanar points, so all three pairs enter the fit:
      //   origin–far   1000 px / 100 mm  => 10.0 px/mm   (long)
      //   origin–near    20 px /   1 mm  => 20.0 px/mm   (short, disagrees)
      //   near–far      980 px /  99 mm  =>  9.9 px/mm   (long)
      const origin = cal([0, 0], [0, 0]);
      const near = cal([20, 0], [1, 0]);
      const far = cal([1000, 0], [100, 0]);

      const fitted = dptOf([origin, near, far])! / HO_GAUGE;

      // An unweighted mean of the three pair ratios would be ~13.3. The d_mm²
      // weighting instead lands within 1% of the two long baselines and all
      // but ignores the short one, which is the bias the fit exists to have:
      // click error is a fixed number of pixels, so short baselines are
      // proportionally noisier.
      const unweightedMean = (10 + 20 + 980 / 99) / 3;
      expect(unweightedMean).toBeGreaterThan(13);

      expect(fitted).toBeGreaterThan(9.9);
      expect(fitted).toBeLessThan(10.0);
      expect(Math.abs(fitted - 20)).toBeGreaterThan(Math.abs(fitted - 10) * 50);
    });

    it('scales by the gauge ratio when the scale changes', () => {
      const points = [cal([0, 0], [0, 0]), cal([100, 0], [10, 0])];
      const ho = dptOf(points, 'HO')!;
      const n = dptOf(points, 'N')!;
      // gauge_HO / gauge_N == ratio_N / ratio_HO == 160 / 87
      expect(ho / n).toBeCloseTo(160 / 87, 10);
    });
  });

  describe('image management', () => {
    it('appends an image with no labels and labeled_complete false', async () => {
      const archive = new R49Archive();
      archive.setManifest(manifest());

      const imgData = new Uint8Array([1, 2, 3]);
      await archive.addImage('test.jpg', imgData);

      const images = archive.getManifest().images;
      expect(images).toHaveLength(1);
      expect(images[0]).toEqual({ filename: 'test.jpg', labeled_complete: false, labels: [] });
      expect(await archive.getImage('test.jpg')).toEqual(imgData);

      archive.removeImage('test.jpg');
      expect(archive.getManifest().images).toHaveLength(0);
    });

    it('reorders images', () => {
      const archive = new R49Archive();
      archive.setManifest(manifest({
        images: [
          { filename: '1.jpg', labeled_complete: false, labels: [] },
          { filename: '2.jpg', labeled_complete: false, labels: [] },
          { filename: '3.jpg', labeled_complete: false, labels: [] },
        ],
      }));

      archive.reorderImages(0, 2);
      expect(archive.getManifest().images.map(i => i.filename)).toEqual(['2.jpg', '3.jpg', '1.jpg']);

      archive.reorderImages(2, 1);
      expect(archive.getManifest().images.map(i => i.filename)).toEqual(['2.jpg', '1.jpg', '3.jpg']);
    });

    it('removes an image together with its labels', async () => {
      const archive = new R49Archive();
      archive.setManifest(manifest({
        images: [{ filename: 'a.jpg', labeled_complete: true, labels: [car()] }],
      }));

      archive.removeImage('a.jpg');
      expect(archive.getManifest().images).toHaveLength(0);
      expect(await archive.getImage('a.jpg')).toBeNull();
    });
  });
});
