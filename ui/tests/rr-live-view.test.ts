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

// `driftSession` is mocked rather than exercised: it decodes blobs through
// `createImageBitmap` and reads pixels back out of a canvas, and jsdom does
// neither. What these tests can prove is the wiring — that a measurement past
// `layout.max_drift_px` withholds L1, keeps L0, and offers the override — which
// is the whole of #94. The measurement itself is `lib/drift`'s to prove, and
// `tools/drift-bench` scores it against the corpus.
const check = vi.fn(async () => ({ displacementPx: 0, refIndex: 0 }));
const openDriftCheck = vi.fn(async () => ({ check: { check }, refNames: ['test.jpg'] }));

vi.mock('../src/driftSession.js', () => ({
  openDriftCheck: (...args: unknown[]) => (openDriftCheck as any)(...args),
  grabPlane: () => ({ width: 4, height: 4, data: new Float32Array(16) }),
}));

/**
 * Give the view a frame to read.
 *
 * jsdom decodes no video, so `<video>.readyState` never leaves 0 and the rAF
 * loop returns early forever — which is why the tests above assert wiring
 * rather than frames. The drift gate cannot be asserted that way: it only ever
 * fires from inside the loop. Standing in a ready-looking source is the smallest
 * lie that lets the real loop, the real `occupancy()` call and the real notice
 * run; nothing downstream of here reads a pixel (`detect` and `grabPlane` are
 * both mocked).
 */
function standInReadySource(el: RRLiveView) {
  const viewer = el.shadowRoot!.querySelector('rr-viewer')! as any;
  viewer.getVideoElement = () => ({ readyState: 2, videoWidth: 100, videoHeight: 100 });
}

/**
 * Wait for the loop and the deferred drift sample to reach a state.
 *
 * Every condition worth waiting on here is reached by a *frame*, not by a render:
 * a drift sample lands outside the loop and only the next frame folds it into
 * sensor states, so waiting on the notice and then asserting on the states would
 * race by one rAF tick.
 */
async function waitFor(el: RRLiveView, done: () => boolean, budgetMs = 1000) {
  for (let waited = 0; waited < budgetMs && !done(); waited += 10) {
    await new Promise(resolve => setTimeout(resolve, 10));
    await el.updateComplete;
  }
  await el.updateComplete;
}

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

  describe('the camera-drift refusal gate (#94)', () => {
    beforeEach(() => {
      check.mockClear();
      openDriftCheck.mockClear();
      check.mockImplementation(async () => ({ displacementPx: 0, refIndex: 0 }));
      openDriftCheck.mockImplementation(async () => ({ check: { check }, refNames: ['test.jpg'] }));
    });

    it('says nothing while the camera is where the archive left it', async () => {
      // No green bar for a steady camera. The view says that by working, and a
      // row that reports success every session is a row nobody reads when it
      // starts reporting a refusal.
      const el = await fixture<RRLiveView>(html`<rr-live-view .archive=${archive}></rr-live-view>`);
      standInReadySource(el);
      await waitFor(el, () => check.mock.calls.length > 0);

      expect(el.shadowRoot!.textContent).to.not.contain('drift');
      expect(el.shadowRoot!.querySelector('.notice.refusing')).to.be.null;
    });

    it('refuses to classify once the camera has moved past the tolerance', async () => {
      check.mockImplementation(async () => ({ displacementPx: 3.2, refIndex: 0 }));

      const el = await fixture<RRLiveView>(html`<rr-live-view .archive=${archive}></rr-live-view>`);
      standInReadySource(el);
      await waitFor(el, () => el.shadowRoot!.querySelector('.notice.refusing') !== null);

      const viewer = el.shadowRoot!.querySelector('rr-viewer')!;
      expect(viewer.sensorStates!.get('S1abcdefghi')).to.deep.equal({
        state: 'unknown',
        reason: 'drift',
      });

      const notice = el.shadowRoot!.querySelector('.notice.refusing')!.textContent ?? '';
      expect(notice).to.contain('refusing to classify');
      // The number, not just the verdict: it is what tells a nudged tripod from
      // a camera re-aimed at a different layout.
      expect(notice).to.contain('3.2 px');
      // And which image it agreed with best, which is what refNames exist for.
      expect(notice).to.contain('test.jpg');
    });

    it('keeps drawing L0 while refusing L1', async () => {
      // The boxes were computed in the live frame and are true of it; what a
      // moved camera invalidates is their mapping onto sensors authored in the
      // archive's frame. Sensor diamonds off the track beside correct boxes is
      // the clearest statement of why the view is refusing.
      check.mockImplementation(async () => ({ displacementPx: 9, refIndex: 0 }));

      const el = await fixture<RRLiveView>(html`<rr-live-view .archive=${archive}></rr-live-view>`);
      standInReadySource(el);
      await waitFor(el, () => el.shadowRoot!.querySelector('.notice.refusing') !== null);

      const viewer = el.shadowRoot!.querySelector('rr-viewer')!;
      expect(viewer.detections).to.deep.equal(detections);
    });

    it('classifies again when the user overrides, and says that it is doing so', async () => {
      check.mockImplementation(async () => ({ displacementPx: 4, refIndex: 0 }));

      const el = await fixture<RRLiveView>(html`<rr-live-view .archive=${archive}></rr-live-view>`);
      standInReadySource(el);
      await waitFor(el, () => el.shadowRoot!.querySelector('.notice.refusing') !== null);

      el.shadowRoot!.querySelector<HTMLButtonElement>('.notice.refusing button')!.click();
      // The override reaches the sensors on the next frame, not on the render
      // that hides the banner — L1 is recomputed once per frame by design.
      const viewer = el.shadowRoot!.querySelector('rr-viewer')!;
      const stillRefusing = () =>
        viewer.sensorStates!.get('S1abcdefghi')?.state === 'unknown' &&
        (viewer.sensorStates!.get('S1abcdefghi') as { reason?: string }).reason === 'drift';
      await waitFor(el, () => !stillRefusing());

      expect(stillRefusing()).to.be.false;
      expect(el.shadowRoot!.querySelector('.notice.refusing')).to.be.null;
      // Overridden is not the same as steady, and the view keeps saying so.
      expect(el.shadowRoot!.textContent).to.contain('Classifying despite');
    });

    it('goes on measuring while refusing, so putting the camera back clears it', async () => {
      // A gate that stopped measuring the moment it fired could not see the fix.
      check.mockImplementation(async () => ({ displacementPx: 6, refIndex: 0 }));

      const el = await fixture<RRLiveView>(html`<rr-live-view .archive=${archive}></rr-live-view>`);
      standInReadySource(el);
      await waitFor(el, () => el.shadowRoot!.querySelector('.notice.refusing') !== null);

      const sampled = check.mock.calls.length;
      expect(sampled).to.be.greaterThan(0);
      // Real wall-clock, because the interval is real: the gate re-measures on
      // DRIFT_SAMPLE_INTERVAL_MS, so this waits past one of them. Slow, and the
      // only test here that is — the alternative is to export the interval so a
      // test can shrink it, which would make a timing constant part of the
      // component's surface to prove a property the constant is not about.
      await waitFor(el, () => check.mock.calls.length > sampled, 6000);
      expect(check.mock.calls.length).to.be.greaterThan(sampled);
    }, 10_000);

    it('says drift is unchecked, not absent, for a layout with no images', async () => {
      openDriftCheck.mockImplementation(async () => null as any);

      const el = await fixture<RRLiveView>(html`<rr-live-view .archive=${archive}></rr-live-view>`);
      await waitFor(el, () => (el.shadowRoot!.textContent ?? '').includes('not being checked'));

      const text = el.shadowRoot!.textContent ?? '';
      expect(text).to.contain('not being checked');
      expect(text).to.contain('no images');
      // "Cannot tell" must not be reported as "no drift", and it must not
      // refuse either — there is nothing to have drifted from.
      expect(el.shadowRoot!.querySelector('.notice.refusing')).to.be.null;
    });

    it('reports a check that could not be built, and classifies anyway', async () => {
      openDriftCheck.mockImplementation(async () => {
        throw new Error('decode failed');
      });

      const el = await fixture<RRLiveView>(html`<rr-live-view .archive=${archive}></rr-live-view>`);
      standInReadySource(el);
      await waitFor(el, () => (el.shadowRoot!.textContent ?? '').includes('decode failed'));

      expect(el.shadowRoot!.textContent).to.contain('not being checked');
      expect(el.shadowRoot!.querySelector('.notice.refusing')).to.be.null;
    });
  });
});
