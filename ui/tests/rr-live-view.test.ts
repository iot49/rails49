import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fixture, html } from '@open-wc/testing';
import { R49Archive } from '@occupancy/r49';
import '../src/rr-live-view.js';
import { RRLiveView } from '../src/rr-live-view.js';

vi.mock('@occupancy/classifier/browser', () => ({
  BrowserClassifier: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(undefined),
    classify: vi.fn().mockResolvedValue('track'),
    release: vi.fn().mockResolvedValue(undefined),
  }))
}));

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock Canvas context
(HTMLCanvasElement.prototype as any).getContext = vi.fn().mockReturnValue({
  clearRect: vi.fn(),
  drawImage: vi.fn(),
  getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(96 * 96 * 4) })
});

describe('rr-live-view', () => {
  let archive: R49Archive;

  beforeEach(() => {
    archive = new R49Archive();
    archive.setManifest({
      version: 4,
      layout: { name: 'Live Test', scale: 'N', calibration: { points: [] }, sensors: [] },
      camera: { resolution: { width: 100, height: 100 } },
      images: [{ filename: 'test.jpg', labeled_complete: false, labels: [] }]
    });

    // Mock getUserMedia
    (navigator as any).mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: () => [{ stop: vi.fn() }]
      })
    };

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
  });

  it('is defined', () => {
    const el = document.createElement('rr-live-view');
    expect(el).to.be.instanceOf(RRLiveView);
  });

  it('renders viewer and stats bar', async () => {
    const el = await fixture<RRLiveView>(html`
      <rr-live-view .archive=${archive}></rr-live-view>
    `);
    
    expect(el.shadowRoot!.querySelector('rr-viewer')).to.exist;
    expect(el.shadowRoot!.querySelector('rr-stats-bar')).to.exist;
  });
});
