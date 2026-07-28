import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import type { R49Archive } from '@occupancy/r49';
import { BrowserClassifier as Classifier } from '@occupancy/classifier/browser';
import { getCameraStream } from './capture.js';
import type { MarkerData } from './marker.js';
import * as ort from 'onnxruntime-web';
import './rr-viewer.js';
import './rr-stats-bar.js';

declare const __RAILS_DOMAIN__: string;
import type { RrViewer } from './rr-viewer.js';

/**
 * Live view component that handles camera stream and classification loop.
 */
@customElement('rr-live-view')
export class RRLiveView extends LitElement {
  @property({ attribute: false }) archive: R49Archive | null = null;

  @state() private _stream: MediaStream | null = null;
  @state() private _markers: MarkerData[] = [];
  @state() private _fps = 0;
  @state() private _latency = 0;
  @state() private _sampleTime = 0;

  @query('rr-viewer') private _viewer!: RrViewer;

  private _classifier: Classifier | null = null;
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
  `;

  async connectedCallback() {
    super.connectedCallback();
    await this._startCamera();
    this._startClassification();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopCamera();
    this._running = false;
    this._classifier?.release();
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

  private async _startClassification() {
    if (!this.archive) return;
    this._running = true;

    let config: any;
    try {
      const response = await fetch('/ui/models/config.json');
      if (!response.ok) {
        throw new Error(`Failed to load config.json (status: ${response.status})`);
      }
      config = await response.json();
    } catch (err) {
      console.error('Fatal Error: Failed to load classifier config', err);
      this._running = false;
      return;
    }

    if (!config.labels || !config.dpt || !config.crop_size || !config.mean || !config.std) {
      console.error('Fatal Error: Classifier config is invalid or missing required parameters', config);
      this._running = false;
      return;
    }
    
    // Set dynamic WASM path for subpath deployment
    if (window.location.hostname.endsWith('pages.dev') || window.location.hostname === __RAILS_DOMAIN__) {
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.25.1/dist/';
    } else {
      ort.env.wasm.wasmPaths = '/ui/ort/';
    }
    
    this._classifier = new Classifier({
      labels: config.labels,
      dpt: config.dpt,
      crop_size: config.crop_size,
      mean: config.mean,
      std: config.std
    });

    // Load default model
    try {
      await this._classifier.load('/ui/models/model_int8.ort');
    } catch (err) {
      console.warn('Failed to load default model', err);
    }

    this._loop();
  }

  private async _loop() {
    if (!this._running || !this._classifier || !this.archive) return;

    const video = this._viewer.getVideoElement();
    const img = this._viewer.getImageElement();
    const source = video || img;

    if (!source || 
        (video && (video.readyState < 2 || video.videoWidth === 0)) || 
        (img && (!img.complete || img.naturalWidth === 0))) {
      requestAnimationFrame(() => this._loop());
      return;
    }

    const startTime = performance.now();
    
    // Update FPS
    if (this._lastFrameTime) {
      const delta = startTime - this._lastFrameTime;
      this._fps = 1000 / delta;
    }
    this._lastFrameTime = startTime;

    const manifest = this.archive.getManifest();
    // In live view, we usually classify based on the first image's labels
    // or a specialized "live" marker set. For now, use markers from image[0].
    const sourceWidth = (source as HTMLVideoElement).videoWidth || (source as HTMLImageElement).naturalWidth;
    const sourceHeight = (source as HTMLVideoElement).videoHeight || (source as HTMLImageElement).naturalHeight;
    const resolution = manifest.camera.resolution || { width: 1920, height: 1080 };
    const resWidth = resolution.width;
    const resHeight = resolution.height;

    const templateImage = manifest.images[0];
    if (templateImage) {
      const newMarkers: MarkerData[] = [];
      const markersToClassify = Object.entries(templateImage.labels);
      
      const loopStart = performance.now();
      for (const [id, m] of markersToClassify) {
        // Scale coordinates from resolution to video natural size
        const scaledMarker = {
          ...m,
          x: m.x * (sourceWidth / resWidth),
          y: m.y * (sourceHeight / resHeight)
        };

        const imgDpt = Classifier.calculateDpt(manifest);
        const results = await this._classifier.classify(source, scaledMarker, imgDpt);
        
        // Pick the "best" label for the icon (prioritize train > coupling > track)
        const priority = ['train', 'coupling', 'track'];
        const type = priority.find(p => results.includes(p)) || results[0] || 'other';

        newMarkers.push({
          id,
          x: m.x,
          y: m.y,
          type: type as any,
          status: null
        });
      }
      const loopEnd = performance.now();
      if (markersToClassify.length > 0) {
        this._sampleTime = (loopEnd - loopStart) / markersToClassify.length;
      }

      this._markers = newMarkers;
    }

    this._latency = performance.now() - startTime;

    requestAnimationFrame(() => this._loop());
  }

  render() {
    const manifest = this.archive?.getManifest();
    const resolution = manifest?.camera.resolution || { width: 1920, height: 1080 };

    return html`
      <rr-stats-bar
        .fps=${this._fps}
        .count=${this._markers.length}
        .latency=${this._latency}
        .sampleTime=${this._sampleTime}
      ></rr-stats-bar>

      <rr-viewer
        .stream=${this._stream}
        .markers=${this._markers}
        .resolution=${resolution}
        ?interactive=${false}
      ></rr-viewer>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-live-view': RRLiveView;
  }
}
