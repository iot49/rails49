import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fixture, html } from '@open-wc/testing';
import { R49Archive } from '@occupancy/r49';
import '../src/rr-editor-view.js';
import { RREditorView } from '../src/rr-editor-view.js';

vi.mock('@occupancy/classifier/browser', () => ({
  BrowserClassifier: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(undefined),
    classify: vi.fn().mockResolvedValue('track'),
    release: vi.fn().mockResolvedValue(undefined),
  }))
}));

// Mock ResizeObserver for RRViewer
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver for Shoelace
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
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

// Mock matchMedia for Shoelace
window.matchMedia = vi.fn().mockImplementation(query => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

// Mock getAnimations/animate for Shoelace
if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = vi.fn().mockReturnValue([]);
}
if (!Element.prototype.animate) {
  Element.prototype.animate = vi.fn().mockImplementation(() => ({
    finished: Promise.resolve(),
    cancel: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    reverse: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

describe('rr-editor-view', () => {
  let archive: R49Archive;

  beforeEach(async () => {
    // Create a dummy archive
    archive = new R49Archive();
    archive.setManifest({
      version: 3,
      layout: { name: 'Test Layout', scale: 'N' },
      camera: { resolution: { width: 100, height: 100 } },
      images: [
        { filename: 'img1.jpg', labels: {} }
      ]
    });

    // Mock getImage to return empty data
    vi.spyOn(archive, 'getImage').mockResolvedValue(new Uint8Array());
    
    // Mock URL.createObjectURL
    global.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();

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
    const el = document.createElement('rr-editor-view');
    expect(el).to.be.instanceOf(RREditorView);
  });

  it('renders placeholder when no archive is provided', async () => {
    const el = await fixture<RREditorView>(html`<rr-editor-view></rr-editor-view>`);
    expect(el.shadowRoot!.textContent).to.contain('No archive loaded');
  });

  it('renders components when archive is provided', async () => {
    const el = await fixture<RREditorView>(html`
      <rr-editor-view .archive=${archive}></rr-editor-view>
    `);
    
    expect(el.shadowRoot!.querySelector('rr-toolbar')).to.exist;
    expect(el.shadowRoot!.querySelector('rr-viewer')).to.exist;
    expect(el.shadowRoot!.querySelector('rr-thumbnail-bar')).to.exist;
  });

  it('updates active tool when toolbar emits rr-tool-select', async () => {
    const el = await fixture<RREditorView>(html`
      <rr-editor-view .archive=${archive}></rr-editor-view>
    `);
    const toolbar = el.shadowRoot!.querySelector('rr-toolbar')!;
    
    toolbar.dispatchEvent(new CustomEvent('rr-tool-select', {
      detail: { tool: 'train' }
    }));
    
    await el.updateComplete;
    const viewer = el.shadowRoot!.querySelector('rr-viewer')!;
    expect((viewer as any).activeTool).to.equal('train');
  });

  it('adds marker to archive when viewer emits rr-marker-add', async () => {
    const el = await fixture<RREditorView>(html`
      <rr-editor-view .archive=${archive}></rr-editor-view>
    `);
    const viewer = el.shadowRoot!.querySelector('rr-viewer')!;
    
    viewer.dispatchEvent(new CustomEvent('rr-marker-add', {
      detail: { x: 50, y: 50, type: 'track' }
    }));
    
    const manifest = archive.getManifest();
    const markers = Object.values(manifest.images[0].labels);
    expect(markers.length).to.equal(1);
    expect(markers[0]).to.deep.include({ x: 50, y: 50, type: 'track' });
  });

  it('removes marker from archive when viewer emits rr-marker-delete', async () => {
    const manifest = archive.getManifest();
    manifest.images[0].labels['m1'] = { x: 10, y: 10, type: 'train' };
    
    const el = await fixture<RREditorView>(html`
      <rr-editor-view .archive=${archive}></rr-editor-view>
    `);
    const viewer = el.shadowRoot!.querySelector('rr-viewer')!;
    
    viewer.dispatchEvent(new CustomEvent('rr-marker-delete', {
      detail: { id: 'm1' }
    }));
    
    expect(manifest.images[0].labels['m1']).to.be.undefined;
  });
});
