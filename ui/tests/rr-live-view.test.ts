import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fixture, html } from '@open-wc/testing';
import { R49Archive } from '@occupancy/r49';
import type { Detection } from '@occupancy/detector';
import '../src/rr-live-view.js';
import { RRLiveView } from '../src/rr-live-view.js';

// What the detector would find, when it loads. The loop is driven by
// requestAnimationFrame off a <video> jsdom never gives a readyState to, so
// these tests assert what the view is *wired* to do — which model URL it asks
// for, what it hands the viewer, what it says when the model is missing — and
// not that a frame ran. jsdom lays nothing out and decodes no video; claiming
// otherwise here would be claiming the suite proves something it cannot.
const detections: Detection[] = [
  { centre: { x: 480, y: 270 }, length: 200, width: 42, angle: 0, class: 'stock', confidence: 0.9 },
];

const loadDetector = vi.fn(async (_source: string) => ({
  detect: vi.fn(async () => detections),
  dispose: vi.fn(async () => {}),
}));

vi.mock('@occupancy/detector/browser', () => ({
  loadDetector: (source: string) => loadDetector(source),
}));

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

describe('rr-live-view', () => {
  let archive: R49Archive;

  beforeEach(() => {
    loadDetector.mockClear();
    loadDetector.mockImplementation(async () => ({
      detect: vi.fn(async () => detections),
      dispose: vi.fn(async () => {}),
    }));

    archive = new R49Archive();
    archive.setManifest({
      version: 4,
      layout: {
        name: 'Live Test',
        scale: 'N',
        calibration: { points: [] },
        sensors: [{ id: 'S1abcdefghi', x: 50, y: 50 }],
      },
      camera: { resolution: { width: 100, height: 100 } },
      images: [{ filename: 'test.jpg', labeled_complete: false, labels: [] }],
    });

    (navigator as any).mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] }),
    };
  });

  it('is defined', () => {
    const el = document.createElement('rr-live-view');
    expect(el).to.be.instanceOf(RRLiveView);
  });

  it('renders viewer and stats bar', async () => {
    const el = await fixture<RRLiveView>(html`<rr-live-view .archive=${archive}></rr-live-view>`);

    expect(el.shadowRoot!.querySelector('rr-viewer')).to.exist;
    expect(el.shadowRoot!.querySelector('rr-stats-bar')).to.exist;
  });

  it('loads the detector the bundle ships, and no classifier', async () => {
    await fixture<RRLiveView>(html`<rr-live-view .archive=${archive}></rr-live-view>`);

    expect(loadDetector).toHaveBeenCalledWith('/ui/models/detector_int8.ort');
  });

  it('passes the layout sensors and their states down, never markers', async () => {
    const el = await fixture<RRLiveView>(html`<rr-live-view .archive=${archive}></rr-live-view>`);
    const viewer = el.shadowRoot!.querySelector('rr-viewer')!;

    expect(viewer.sensors.map(s => s.id)).to.deep.equal(['S1abcdefghi']);
    // Not null: the live view is reading these sensors, which is the
    // distinction the viewer draws state on (#85).
    expect(viewer.sensorStates).to.not.be.null;
  });

  it('warns that every sensor reads unknown when the model will not load', async () => {
    loadDetector.mockRejectedValue(new Error('404 on detector_int8.ort'));

    const el = await fixture<RRLiveView>(html`<rr-live-view .archive=${archive}></rr-live-view>`);
    // The load goes through `openDetector` since #87, so the rejection reaches
    // the catch one microtask later than it used to and `updateComplete` alone
    // can resolve before `_modelError` is set. Flush, then let Lit render.
    await new Promise(resolve => setTimeout(resolve, 0));
    await el.updateComplete;

    const notice = el.shadowRoot!.textContent ?? '';
    expect(notice).to.contain('unknown');
    expect(notice).to.contain('export_onnx.py');
  });

  it('warns about calibration before a frame has ever run', async () => {
    // The fixture archive has no calibration points, so getDPT resolves
    // nothing. The notice must not wait on the loop: a session where the camera
    // is refused runs no frame at all, and a warning that never appears is
    // worse than none.
    const el = await fixture<RRLiveView>(html`<rr-live-view .archive=${archive}></rr-live-view>`);

    expect(el.shadowRoot!.textContent).to.contain('no calibration');
  });

  it("sets no zoom: the capability is there, the control is the editor's (#44)", async () => {
    // The live view listens to no pointer events, and its job is watching
    // occupancy across the whole layout — where a zoomed-in partial view hides
    // the thing being monitored. A deferral, not a principle.
    const el = await fixture<RRLiveView>(html`<rr-live-view .archive=${archive}></rr-live-view>`);

    const viewer = el.shadowRoot!.querySelector('rr-viewer')!;
    expect(viewer.zoom).to.be.null;
    expect(viewer.zoomPreview).to.be.null;
  });
});
