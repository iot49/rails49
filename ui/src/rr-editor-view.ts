import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { R49Archive, getDPT } from '@occupancy/r49';
import { BrowserClassifier as Classifier } from '@occupancy/classifier/browser';
import { make_id } from '@occupancy/uid';
import * as ort from 'onnxruntime-web';
import { captureFromCamera } from './capture.js';
import type { MarkerData } from './marker.js';

declare const __RAILS_DOMAIN__: string;

import './rr-viewer.js';
import './rr-toolbar.js';
import './rr-thumbnail-bar.js';

/**
 * Main editor view that orchestrates markers, images, and tools.
 */
@customElement('rr-editor-view')
export class RREditorView extends LitElement {
  @property({ attribute: false }) archive: R49Archive | null = null;
  @state() private _currentImageIndex = 0;
  @state() private _activeTool: string | null = null;
  @state() private _imageUrls: Map<string, string> = new Map();
  @state() private _classificationResults: Map<string, string[]> = new Map();
  @state() private _needsCalibration = false;

  private _classifier: Classifier | null = null;

  static styles = css`
    :host {
      display: flex;
      flex-grow: 1;
      height: 100%;
      overflow: hidden;
    }

    .sidebar {
      display: flex;
      flex-direction: column;
    }

    .main-content {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      background: #111;
      position: relative;
    }

    rr-viewer {
      flex-grow: 1;
    }

    rr-thumbnail-bar {
      flex-shrink: 0;
    }
  `;

  async updated(changedProperties: Map<string, any>) {
    if (changedProperties.has('archive') && this.archive) {
      await this._refreshImageUrls();
      await this._initClassifier();
      this._currentImageIndex = 0;
      await this._runClassification();
    } else if (changedProperties.has('_currentImageIndex')) {
      await this._runClassification();
    }
  }

  private async _initClassifier() {
    if (!this.archive) return;
    
    let config: any;
    try {
      const response = await fetch('/ui/models/config.json');
      if (!response.ok) {
        throw new Error(`Failed to load config.json (status: ${response.status})`);
      }
      config = await response.json();
    } catch (err) {
      console.error('Fatal Error: Failed to load classifier config', err);
      return;
    }

    if (!config.labels || !config.dpt || !config.crop_size || !config.mean || !config.std) {
      console.error('Fatal Error: Classifier config is invalid or missing required parameters', config);
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

    try {
      await this._classifier.load('/ui/models/model_int8.ort');
    } catch (err) {
      console.error('Failed to load classifier', err);
    }
  }

  private async _runClassification() {
    if (!this.archive || !this._classifier) return;
    const manifest = this.archive.getManifest();

    const dpt = getDPT(manifest);
    if (dpt === null) {
      this._needsCalibration = true;
      this._classificationResults = new Map();
      return;
    }
    this._needsCalibration = false;

    const currentImage = manifest.images[this._currentImageIndex];
    if (!currentImage) return;

    const imgUrl = this._imageUrls.get(currentImage.filename);
    if (!imgUrl) return;

    // Load image element to classify from
    const img = new Image();
    img.src = imgUrl;
    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Failed to load image for classification'));
      });
      if (img.naturalWidth === 0) return;
    } catch (err) {
      console.warn(err);
      return;
    }

    const results = new Map<string, string[]>();
    for (const [id, m] of Object.entries(currentImage.labels)) {
      const res = await this._classifier.classify(img, m as any, dpt);
      results.set(id, res);
    }
    this._classificationResults = results;
  }

  private async _refreshImageUrls() {
    if (!this.archive) return;
    const manifest = this.archive.getManifest();
    
    // Revoke old URLs
    this._imageUrls.forEach(url => URL.revokeObjectURL(url));
    this._imageUrls.clear();

    for (const img of manifest.images) {
      const data = await this.archive.getImage(img.filename);
      if (data) {
        const blob = new Blob([data as any], { type: 'image/jpeg' });
        this._imageUrls.set(img.filename, URL.createObjectURL(blob));
      }
    }
    this.requestUpdate();
  }

  private _onToolSelect(e: CustomEvent) {
    this._activeTool = e.detail.tool;
    if (this._activeTool === 'calibrate') {
      this._initCalibration();
    }
  }

  private _initCalibration() {
    if (!this.archive) return;
    const manifest = this.archive.getManifest();
    if (!manifest.layout.calibration) {
      const res = manifest.camera.resolution || { width: 1920, height: 1080 };
      manifest.layout.calibration = {
        p0: { x: res.width * 0.25, y: res.height * 0.5 },
        p1: { x: res.width * 0.75, y: res.height * 0.5 },
        size_mm: 100
      };
      this.requestUpdate();
      this._runClassification();
    }
  }

  private _onImageSelect(e: CustomEvent) {
    this._currentImageIndex = e.detail.index;
  }

  private async _onImageAdd(e: CustomEvent) {
    if (!this.archive) return;
    const { source } = e.detail;

    if (source === 'file') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png';
      input.onchange = async (event: any) => {
        const file = event.target.files[0];
        if (file) {
          const buffer = await file.arrayBuffer();
          const filename = `img_${make_id(2)}.jpg`;
          await this.archive!.addImage(filename, new Uint8Array(buffer));
          await this._refreshImageUrls();
          this._currentImageIndex = this.archive!.getManifest().images.length - 1;
        }
      };
      input.click();
    } else if (source === 'camera') {
      try {
        const data = await captureFromCamera();
        const filename = `capture_${make_id(3)}.jpg`;
        await this.archive.addImage(filename, data);
        await this._refreshImageUrls();
        this._currentImageIndex = this.archive.getManifest().images.length - 1;
      } catch (err) {
        console.error('Failed to capture from camera', err);
      }
    }
  }

  private async _onImageDelete(e: CustomEvent) {
    if (!this.archive) return;
    const { index } = e.detail;
    const manifest = this.archive.getManifest();
    const image = manifest.images[index];
    if (image) {
      this.archive.removeImage(image.filename);
      await this._refreshImageUrls();
      this._currentImageIndex = Math.max(0, Math.min(this._currentImageIndex, manifest.images.length - 1));
    }
  }

  private _onImageReorder(e: CustomEvent) {
    if (!this.archive) return;
    const { from, to } = e.detail;
    
    // Update current index if the selected image moved or if its position shifted
    if (this._currentImageIndex === from) {
      this._currentImageIndex = to;
    } else if (from < this._currentImageIndex && to >= this._currentImageIndex) {
      this._currentImageIndex--;
    } else if (from > this._currentImageIndex && to <= this._currentImageIndex) {
      this._currentImageIndex++;
    }

    this.archive.reorderImages(from, to);
    this.requestUpdate();
  }

  private _onMarkerAdd(e: CustomEvent) {
    if (!this.archive) return;
    const manifest = this.archive.getManifest();
    const currentImage = manifest.images[this._currentImageIndex];
    if (!currentImage) return;

    const id = make_id(1);
    currentImage.labels[id] = {
      x: e.detail.x,
      y: e.detail.y,
      type: e.detail.type
    };

    this.requestUpdate();
    this._runClassification();
  }

  private _onMarkerMove(e: CustomEvent) {
    if (!this.archive) return;
    const manifest = this.archive.getManifest();
    const currentImage = manifest.images[this._currentImageIndex];
    if (!currentImage) return;

    const marker = currentImage.labels[e.detail.id];
    if (marker) {
      marker.x = e.detail.x;
      marker.y = e.detail.y;
      this.requestUpdate();
      this._runClassification();
    }
  }

  private _onMarkerDelete(e: CustomEvent) {
    if (!this.archive) return;
    const manifest = this.archive.getManifest();
    const currentImage = manifest.images[this._currentImageIndex];
    if (!currentImage) return;

    delete currentImage.labels[e.detail.id];
    this.requestUpdate();
    this._runClassification();
  }

  private _onCalibrationMove(e: CustomEvent) {
    if (!this.archive) return;
    const manifest = this.archive.getManifest();
    const cal = manifest.layout.calibration;
    if (cal) {
      const { id, x, y } = e.detail;
      if (id === 'p0') {
        cal.p0 = { x, y };
      } else if (id === 'p1') {
        cal.p1 = { x, y };
      }
      this.requestUpdate();
    }
  }

  render() {
    const manifest = this.archive?.getManifest();
    const currentImage = manifest?.images[this._currentImageIndex];
    const src = currentImage ? this._imageUrls.get(currentImage.filename) : null;
    const markers: MarkerData[] = currentImage ? Object.entries(currentImage.labels).map(([id, data]) => {
      const d = data as any;
      const detected = this._classificationResults.get(id) || [];
      return {
        id,
        ...d,
        type: d.type as any,
        status: (this._needsCalibration ? 'pending' : (detected.includes(d.type) ? 'match' : 'mismatch')) as any,
        detectedLabels: detected
      };
    }) : [];

    const showCalibration = this._activeTool === 'calibrate';
    const calibration = showCalibration ? manifest?.layout.calibration : undefined;

    return html`
      <div class="sidebar">
        <rr-toolbar 
          .activeTool=${this._activeTool}
          @rr-tool-select=${this._onToolSelect}
        ></rr-toolbar>
      </div>

      <div class="main-content">
        ${!this.archive
          ? html`<div style="padding: 2rem; color: #888;">No archive loaded. Use the toolbar to open an .r49 file.</div>`
          : html`
            ${this._needsCalibration ? html`
              <div style="padding: 0.5rem 1rem; background: #4a2f00; color: #ffcc80;">
                This layout has no calibration data. Calibrate it (toolbar → Calibrate) before classification results can be shown.
              </div>
            ` : ''}
            <rr-viewer
              .src=${src}
              .markers=${markers}
              .activeTool=${this._activeTool}
              .resolution=${manifest!.camera.resolution}
              .calibration=${calibration}
              ?interactive=${true}
              @rr-marker-add=${this._onMarkerAdd}
              @rr-marker-move=${this._onMarkerMove}
              @rr-marker-delete=${this._onMarkerDelete}
              @rr-calibration-move=${this._onCalibrationMove}
            ></rr-viewer>

            <rr-thumbnail-bar
              .images=${manifest!.images.map(img => this._imageUrls.get(img.filename) || '')}
              .selectedIndex=${this._currentImageIndex}
              @rr-image-select=${this._onImageSelect}
              @rr-image-add=${this._onImageAdd}
              @rr-image-delete=${this._onImageDelete}
              @rr-image-reorder=${this._onImageReorder}
            ></rr-thumbnail-bar>
          `
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-editor-view': RREditorView;
  }
}
