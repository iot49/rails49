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
      version: 4,
      layout: { name: 'Test', scale: 'N', calibration: { points: [] }, sensors: [] },
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

  // Save no longer validates calibration. The v3 check read {p0, p1, size_mm}
  // structurally, which v4 does not have: calibration is a list of points that
  // legitimately starts empty, so "uncalibrated" is a state to report, not an
  // error to refuse a save over (#19, SPEC.md § Reference points).
  it('saves an uncalibrated archive without complaint', async () => {
    const el = await fixture<RRApp>(html`<rr-app></rr-app>`);
    (el as any)._archive = archive;

    const exportSpy = vi.spyOn(archive, 'export').mockResolvedValue(new Uint8Array());
    const notifySpy = vi.spyOn(el as any, '_notify');

    await (el as any)._onFileSave();

    expect(exportSpy).toHaveBeenCalled();
    expect(notifySpy).toHaveBeenCalledWith('Saved to disk', 'success', 'download');
  });

  describe('undo, offered to the editor first', () => {
    /** An app showing the editor, with the editor's interception stubbed. */
    async function mount(intercepts: boolean) {
      const el = await fixture<RRApp>(html`<rr-app></rr-app>`);
      (el as any)._archive = archive;
      await el.updateComplete;
      const view = el.renderRoot.querySelector('rr-editor-view')!;
      const intercept = vi.spyOn(view, 'interceptUndo').mockResolvedValue(intercepts);
      const undo = vi.spyOn((el as any)._history, 'undo');
      return { el, intercept, undo };
    }

    it('leaves the stack alone when a live chain consumes it', async () => {
      // A live chain is a wall undo cannot cross (SPEC.md § Undo and redo).
      const { el, intercept, undo } = await mount(true);

      await (el as any)._undo();

      expect(intercept).toHaveBeenCalled();
      expect(undo).not.toHaveBeenCalled();
    });

    it('goes to the stack when the editor does not consume it', async () => {
      const { el, intercept, undo } = await mount(false);

      await (el as any)._undo();

      expect(intercept).toHaveBeenCalled();
      expect(undo).toHaveBeenCalled();
    });

    it('offers redo to nobody — only undo is state-dependent', async () => {
      const { el, intercept } = await mount(true);

      await (el as any)._redo();

      expect(intercept).not.toHaveBeenCalled();
    });
  });

  it('reports a save failure', async () => {
    const el = await fixture<RRApp>(html`<rr-app></rr-app>`);
    (el as any)._archive = archive;

    vi.spyOn(archive, 'export').mockRejectedValue(new Error('disk full'));
    const notifySpy = vi.spyOn(el as any, '_notify');

    await (el as any)._onFileSave();

    expect(notifySpy).toHaveBeenCalledWith(
      expect.stringContaining('Save failed'), 'danger', 'exclamation-diamond'
    );
  });
});
