import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import type { R49Archive } from '@occupancy/r49';
import { getDPT } from '@occupancy/r49';
import { occupancy } from '@occupancy/detector';
import type { Detection, Frame, SensorState } from '@occupancy/detector';
import { loadDetector } from '@occupancy/detector/browser';
import type { Detector } from '@occupancy/detector/browser';
import { getCameraStream } from './capture.js';
import { DETECTOR_MODEL_URL } from '../modelAssets.js';
// Must match the specifier `@occupancy/detector/browser` imports: two
// specifiers are two module instances, and the `ort.env.wasm` configured here
// would not be the one the detector's session reads.
import * as ort from 'onnxruntime-web/wasm';
import './rr-viewer.js';
import './rr-stats-bar.js';

import type { RrViewer } from './rr-viewer.js';

/** What `camera.resolution` stands in as when an archive declares none. */
const DEFAULT_RESOLUTION: Frame = { width: 1920, height: 1080 };

/**
 * The live view: camera stream, detector, and the two layers of the occupancy
 * output drawn over it.
 *
 * **This is the occupancy contract, not a demo.** What stood here before ran
 * the CNN once per sensor point and emitted marker glyphs — SPEC's "Testing and
 * Demo" item, explicitly not the contract. It is gone (#7, #85). The loop now
 * runs the detector **once per frame** and derives every sensor from its output
 * by pure geometry, which is what `SPEC.md` § Occupancy Output specifies: L1 is
 * a function of L0, never a second model, so it cannot contradict the boxes
 * drawn beside it and it costs the same for three sensors or three hundred.
 *
 * **The loop runs whether or not a model loaded.** That is not resilience for
 * its own sake: `occupancy()` is total, and with `detections: null` it answers
 * every sensor `unknown` / `no-model` — which is a state SPEC names and the
 * user needs to see. Suppressing the loop instead would leave the last frame's
 * answers on screen, which is the one thing worse than saying nothing.
 *
 * **Properties:** `archive`.
 */
@customElement('rr-live-view')
export class RRLiveView extends LitElement {
  @property({ attribute: false }) archive: R49Archive | null = null;

  @state() private _stream: MediaStream | null = null;
  /** L0 for the frame on screen. Empty, not stale, when no model is loaded. */
  @state() private _detections: readonly Detection[] = [];
  /** L1 for the same frame, keyed by sensor id — total, one entry per sensor. */
  @state() private _sensorStates: ReadonlyMap<string, SensorState> = new Map();
  @state() private _fps = 0;
  @state() private _inference = 0;
  /**
   * The layout's DPT, or `null` when calibration resolves none.
   *
   * Resolved when the archive arrives rather than once per frame, and that is
   * what makes the "no calibration" notice honest: computed in the loop it
   * would start at `null` and stay there for any session where no frame ever
   * runs — a camera that was refused, a stream that never reaches `readyState`
   * 2 — and accuse a perfectly calibrated layout. The live view never edits the
   * manifest, so nothing else can move it.
   */
  @state() private _dpt: number | null = null;
  /**
   * Why the detector is not loaded, or `null` when it is.
   *
   * Held as the message rather than a boolean: the causes are different jobs —
   * a fresh clone has never run `export_onnx.py`, a deployed bundle that 404s
   * was built without the model — and the sensors all read `unknown` either
   * way, which says nothing about which.
   */
  @state() private _modelError: string | null = null;

  @query('rr-viewer') private _viewer!: RrViewer;

  private _detector: Detector | null = null;
  private _running = false;
  private _lastFrameTime = 0;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex-grow: 1;
      height: 100%;
      position: relative;
      background: #000;
    }

    rr-viewer {
      flex-grow: 1;
    }

    .notice {
      padding: 0.5rem 1rem;
      background: #4a2f00;
      color: #ffcc80;
      font-size: 0.9rem;
    }
  `;

  protected willUpdate(changed: Map<string, unknown>) {
    if (changed.has('archive')) {
      const manifest = this.archive?.getManifest();
      this._dpt = manifest ? getDPT(manifest) : null;
    }
  }

  async connectedCallback() {
    super.connectedCallback();
    await this._startCamera();
    this._startDetection();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopCamera();
    this._running = false;
    void this._detector?.dispose();
    this._detector = null;
  }

  private async _startCamera() {
    try {
      this._stream = await getCameraStream();
    } catch (err) {
      console.error('Failed to access camera', err);
    }
  }

  private _stopCamera() {
    if (this._stream) {
      this._stream.getTracks().forEach(track => track.stop());
      this._stream = null;
    }
  }

  private async _startDetection() {
    if (!this.archive) return;
    this._running = true;

    // Same path everywhere: the runtime ships with the bundle. A cross-origin
    // CDN would fail COEP, which production now sets to get threading (#15).
    ort.env.wasm.wasmPaths = '/ui/ort/';

    // Losing isolation costs ~1.5x and breaks nothing visibly — ORT just drops
    // to one thread. Say it, since nothing else can.
    if (!self.crossOriginIsolated) {
      console.warn(
        'Not crossOriginIsolated: ONNX Runtime is limited to a single WASM ' +
        'thread. Check the COOP/COEP headers this page was served with.'
      );
    }

    try {
      this._detector = await loadDetector(DETECTOR_MODEL_URL);
      this._modelError = null;
    } catch (err) {
      // Not fatal, and deliberately so — see the class comment. The loop starts
      // anyway and every sensor reports `unknown` / `no-model`.
      this._modelError = err instanceof Error ? err.message : String(err);
      console.error(`Failed to load the detector from ${DETECTOR_MODEL_URL}`, err);
    }

    this._loop();
  }

  /**
   * The media element the frame is read from, once it has one to read.
   *
   * The readiness check is here rather than inside `detect`, which throws on a
   * source with no dimensions: a video before its metadata arrives is the
   * normal first few frames of a session, not an error to report.
   */
  private _readySource(): CanvasImageSource | null {
    const video = this._viewer?.getVideoElement();
    if (video) return video.readyState >= 2 && video.videoWidth > 0 ? video : null;

    const img = this._viewer?.getImageElement();
    if (img) return img.complete && img.naturalWidth > 0 ? img : null;

    return null;
  }

  private async _loop() {
    if (!this._running || !this.archive) return;

    const source = this._readySource();
    if (!source) {
      requestAnimationFrame(() => this._loop());
      return;
    }

    const startTime = performance.now();
    if (this._lastFrameTime) this._fps = 1000 / (startTime - this._lastFrameTime);
    this._lastFrameTime = startTime;

    const manifest = this.archive.getManifest();
    // The frame every coordinate is authored in (`SPEC.md` § Output encoding).
    // `detect` is asked to answer in it, so the capture's own pixel count — a
    // phone that ignored the requested 1920x1080 — never reaches this file.
    const frame = manifest.camera.resolution ?? DEFAULT_RESOLUTION;

    // `null` is the distinction `occupancy` reads: no model at all, rather than
    // a model that found nothing. An empty array would report every sensor
    // `clear`, which is the confident-looking miss SPEC forbids.
    let detections: readonly Detection[] | null = null;
    if (this._detector) {
      const before = performance.now();
      try {
        detections = await this._detector.detect(source, frame);
        // The detect call alone — preprocessing, the session, the decode. Not
        // the whole frame: L1 and the render are the part that scales with the
        // layout, and folding them in would hide which one is slow.
        this._inference = performance.now() - before;
      } catch (err) {
        // A frame that fails is one frame. Keep the loop alive and report
        // `unknown` for it rather than freezing the last answer on screen.
        console.error('Detection failed for this frame', err);
      }
    }

    this._detections = detections ?? [];
    this._sensorStates = occupancy({
      detections,
      sensors: manifest.layout.sensors,
      dpt: this._dpt,
      frame,
    });

    requestAnimationFrame(() => this._loop());
  }

  /** How many sensors read `occupied` — the number a controller would act on. */
  private get _occupiedCount(): number {
    let count = 0;
    for (const state of this._sensorStates.values()) {
      if (state.state === 'occupied') count++;
    }
    return count;
  }

  render() {
    const manifest = this.archive?.getManifest();
    const resolution = manifest?.camera.resolution ?? DEFAULT_RESOLUTION;

    return html`
      <rr-stats-bar
        .fps=${this._fps}
        .cars=${this._detections.length}
        .occupied=${this._occupiedCount}
        .inference=${this._inference}
      ></rr-stats-bar>

      ${this._modelError
        ? html`<div class="notice">
            No detector loaded, so every sensor reads <strong>unknown</strong>. Build one with
            <code>uv run python export_onnx.py</code> in <code>detector/</code>, then rebuild the
            UI. (${this._modelError})
          </div>`
        : ''}

      ${this._dpt === null
        ? html`<div class="notice">
            This layout has no calibration, so no DPT resolves and every sensor reads
            <strong>unknown</strong>. Cars are still detected — the boxes below are real; only the
            per-sensor answer needs the car width DPT derives. Place calibration points in the
            editor.
          </div>`
        : ''}

      <rr-viewer
        .stream=${this._stream}
        .detections=${this._detections}
        .sensors=${manifest?.layout.sensors ?? []}
        .sensorStates=${this._sensorStates}
        .dpt=${this._dpt}
        .resolution=${resolution}
      ></rr-viewer>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-live-view': RRLiveView;
  }
}
