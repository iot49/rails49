import { describe, it, expect } from 'vitest';
import { R49Archive } from '../src/archive.ts';

describe('R49Archive', () => {
  it('should create an empty archive and set manifest', async () => {
    const archive = new R49Archive();
    const manifest = {
      version: 3,
      layout: {
        name: 'Test Layout',
        scale: 'HO',
        calibration: {
          p0: { x: 0, y: 0 },
          p1: { x: 100, y: 100 },
          size_mm: 1000
        }
      },
      camera: {
        resolution: { width: 1920, height: 1080 }
      },
      images: []
    };

    archive.setManifest(manifest as any);
    const data = await archive.export();
    expect(data).toBeDefined();

    const loaded = await R49Archive.load(data);
    expect(loaded.getManifest().layout.name).toBe('Test Layout');
  });

  it('should add and remove images', async () => {
    const archive = new R49Archive();
    archive.setManifest({
      version: 3,
      layout: { name: 'Test', scale: 'N', calibration: { p0: {x:0,y:0}, p1: {x:1,y:1}, size_mm: 1 } },
      camera: { resolution: { width: 640, height: 480 } },
      images: []
    } as any);

    const imgData = new Uint8Array([1, 2, 3]);
    await archive.addImage('test.jpg', imgData);
    
    expect(archive.getManifest().images).toHaveLength(1);
    expect(archive.getManifest().images[0].filename).toBe('test.jpg');

    const retrieved = await archive.getImage('test.jpg');
    expect(retrieved).toEqual(imgData);

    archive.removeImage('test.jpg');
    expect(archive.getManifest().images).toHaveLength(0);
  });

  it('should reorder images', () => {
    const archive = new R49Archive();
    archive.setManifest({
      version: 3,
      layout: { name: 'Test', scale: 'N', calibration: { p0: {x:0,y:0}, p1: {x:1,y:1}, size_mm: 1 } },
      camera: { resolution: { width: 640, height: 480 } },
      images: [
        { filename: '1.jpg', labels: {} },
        { filename: '2.jpg', labels: {} },
        { filename: '3.jpg', labels: {} }
      ]
    } as any);

    archive.reorderImages(0, 2);
    let images = archive.getManifest().images;
    expect(images[0].filename).toBe('2.jpg');
    expect(images[1].filename).toBe('3.jpg');
    expect(images[2].filename).toBe('1.jpg');

    archive.reorderImages(2, 1);
    images = archive.getManifest().images;
    expect(images[0].filename).toBe('2.jpg');
    expect(images[1].filename).toBe('1.jpg');
    expect(images[2].filename).toBe('3.jpg');
  });
});
