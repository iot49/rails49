import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fixture, html } from '@open-wc/testing';
import '../src/rr-app.js';
import { RRApp } from '../src/rr-app.js';
import { R49Archive } from '@occupancy/r49';

vi.mock('@occupancy/classifier/browser', () => {
  return {
    BrowserClassifier: vi.fn().mockImplementation(() => {
      return {
        load: vi.fn().mockResolvedValue(undefined),
        classify: vi.fn().mockResolvedValue('track'),
        release: vi.fn().mockResolvedValue(undefined)
      };
    })
  };
});

// Mock global fetch for config.json
global.fetch = vi.fn().mockImplementation((url: string) => {
  if (url.endsWith('config.json')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        dpt: 30,
        crop_size: 96,
        labels: ['track', 'train'],
        mean: [0.485, 0.456, 0.406],
        std: [0.229, 0.224, 0.225]
      })
    });
  }
  return Promise.resolve({ ok: false });
});

describe('rr-app', () => {
  let archive: R49Archive;

  beforeEach(() => {
    archive = new R49Archive();
    archive.setManifest({
      version: 3,
      layout: { name: 'Test', scale: 'N' },
      camera: { resolution: { width: 1920, height: 1080 } },
      images: []
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  it('is defined', () => {
    const el = document.createElement('rr-app');
    expect(el).to.be.instanceOf(RRApp);
  });

  it('shows error when saving without calibration', async () => {
    const el = await fixture<RRApp>(html`<rr-app></rr-app>`);
    (el as any)._archive = archive;
    
    const notifySpy = vi.spyOn(el as any, '_notify');
    
    await (el as any)._onFileSave();
    
    expect(notifySpy).toHaveBeenCalledWith(expect.stringContaining('Calibration is missing'), 'warning', 'rulers');
  });

  it('shows error when saving with identical calibration points', async () => {
    const el = await fixture<RRApp>(html`<rr-app></rr-app>`);
    archive.getManifest().layout.calibration = {
      p0: { x: 100, y: 100 },
      p1: { x: 100, y: 100 },
      size_mm: 100
    };
    (el as any)._archive = archive;
    
    const notifySpy = vi.spyOn(el as any, '_notify');
    
    await (el as any)._onFileSave();
    
    expect(notifySpy).toHaveBeenCalledWith(expect.stringContaining('points cannot be identical'), 'warning', 'exclamation-triangle');
  });

  it('shows error when saving with invalid size_mm', async () => {
    const el = await fixture<RRApp>(html`<rr-app></rr-app>`);
    archive.getManifest().layout.calibration = {
      p0: { x: 100, y: 100 },
      p1: { x: 200, y: 200 },
      size_mm: 0
    };
    (el as any)._archive = archive;
    
    const notifySpy = vi.spyOn(el as any, '_notify');
    
    await (el as any)._onFileSave();
    
    expect(notifySpy).toHaveBeenCalledWith(expect.stringContaining('must be a positive number'), 'warning', 'exclamation-triangle');
  });

  it('proceeds with save when calibration is valid', async () => {
    const el = await fixture<RRApp>(html`<rr-app></rr-app>`);
    archive.getManifest().layout.calibration = {
      p0: { x: 100, y: 100 },
      p1: { x: 200, y: 200 },
      size_mm: 100
    };
    (el as any)._archive = archive;
    
    const exportSpy = vi.spyOn(archive, 'export').mockResolvedValue(new Uint8Array());
    
    await (el as any)._onFileSave();
    
    const notifySpy = vi.spyOn(el as any, '_notify');
    
    await (el as any)._onFileSave();
    
    expect(notifySpy).toHaveBeenCalledWith('Saved to disk', 'success', 'download');
    expect(exportSpy).toHaveBeenCalled();
  });
});
