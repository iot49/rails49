import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { R49Archive, getDPT } from '../src/index.ts';

// The regression guard for the one-time v3 -> v4 conversion (#22).
//
// The conversion script was throwaway and is gone; the committed archives are
// the output, and this is what makes the conversion checkable a year from now.
// It asserts exactly what the conversion promised: valid v4, calibration and
// images kept, DPT unchanged, every marker dropped rather than guessed at.
//
// These six are **UI fixtures, not training data**. They sit at DPT 18-19,
// below layout.min_dpt of 20, so no number derived from them predicts model
// accuracy. Training will use fresh, higher-DPT images captured later.

const DATASET_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../dataset/r49'
);

/**
 * DPT each archive reported under v3, computed from its `{p0, p1, size_mm}`
 * before the conversion ran. The v3 pair became two world points at (0,0,0)
 * and (0, size_mm, 0), and at two points the least-squares fit reduces to
 * `d_px / d_mm` — so these values must survive exactly.
 */
const EXPECTED_DPT: Record<string, number> = {
  'cars 0-10.r49': 19.080893016456482,
  'cars 11-17.r49': 19.080893016456482,
  'cars 17-30.r49': 19.080893016456482,
  'catalog-bg.r49': 18.52545600524001,
  'lighting.r49': 17.96331564683915,
  'simple.r49': 17.96331564683915,
};

/** Image count per archive, so a silently dropped image fails rather than passes. */
const EXPECTED_IMAGES: Record<string, number> = {
  'cars 0-10.r49': 11,
  'cars 11-17.r49': 6,
  'cars 17-30.r49': 13,
  'catalog-bg.r49': 6,
  'lighting.r49': 6,
  'simple.r49': 4,
};

const ARCHIVE_NAMES = Object.keys(EXPECTED_DPT);

async function load(name: string): Promise<R49Archive> {
  return await R49Archive.load(await fs.readFile(path.join(DATASET_DIR, name)));
}

describe('dataset/r49 fixtures', () => {
  it('is exactly the six archives the conversion covered', async () => {
    const found = (await fs.readdir(DATASET_DIR)).filter(f => f.endsWith('.r49')).sort();
    expect(found).toEqual([...ARCHIVE_NAMES].sort());
  });

  describe.each(ARCHIVE_NAMES)('%s', (name) => {
    it('loads as valid v4', async () => {
      const manifest = (await load(name)).getManifest();
      expect(manifest.version).toBe(4);
    });

    it('reports the DPT it reported under v3', async () => {
      const dpt = getDPT((await load(name)).getManifest());
      expect(dpt).not.toBeNull();
      // Exact: the conversion is lossless, not approximate.
      expect(dpt).toBeCloseTo(EXPECTED_DPT[name], 10);
    });

    it('keeps calibration as two points', async () => {
      const points = (await load(name)).getManifest().layout.calibration.points;
      expect(points).toHaveLength(2);
      // World origin and the recorded separation along one axis.
      expect(points[0].world).toEqual({ x: 0, y: 0, z: 0 });
      expect(points[1].world.x).toBe(0);
      expect(points[1].world.z).toBe(0);
      expect(points[1].world.y).toBeGreaterThan(0);
    });

    it('keeps camera resolution, scale, and every image', async () => {
      const manifest = (await load(name)).getManifest();
      expect(manifest.camera.resolution).toEqual({ width: 1920, height: 1080 });
      expect(manifest.layout.scale).toBe('HO');
      expect(manifest.layout.name).toBeTruthy();
      expect(manifest.images).toHaveLength(EXPECTED_IMAGES[name]);
    });

    it('carries no labels, no sensors, and asserts no completeness', async () => {
      const archive = await load(name);
      const manifest = archive.getManifest();

      // No marker was promoted to a car or a sensor: a point carries neither
      // extent nor orientation, so any promotion would be fabricated geometry.
      expect(manifest.layout.sensors).toEqual([]);
      for (const image of manifest.images) {
        expect(image.labels, `${name}/${image.filename} labels`).toEqual([]);
        // No tool may assert completeness on a human's behalf.
        expect(image.labeled_complete, `${name}/${image.filename} complete`).toBe(false);
      }
    });

    it('still has retrievable bytes for every image', async () => {
      const archive = await load(name);
      for (const image of archive.getManifest().images) {
        const bytes = await archive.getImage(image.filename);
        expect(bytes, `${name}/${image.filename} bytes`).not.toBeNull();
        expect(bytes!.byteLength).toBeGreaterThan(0);
      }
    });
  });

  it('holds 46 images and not one car label across all six', async () => {
    let images = 0;
    let labels = 0;
    for (const name of ARCHIVE_NAMES) {
      const manifest = (await load(name)).getManifest();
      images += manifest.images.length;
      labels += manifest.images.reduce((n, i) => n + i.labels.length, 0);
    }
    expect(images).toBe(46);
    // All 1195 v3 point markers were dropped, none guessed at.
    expect(labels).toBe(0);
  });
});
