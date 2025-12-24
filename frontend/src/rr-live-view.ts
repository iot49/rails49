import { LitElement, html, css, svg } from 'lit';
import { customElement, state, query } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { Manifest } from './app/manifest.ts';
import { R49File, r49FileContext } from './app/r49file.ts';
import { Classifier, classifierContext } from './app/classifier.ts';
import { statusBarStyles } from './styles/status-bar.ts';
import { getMarkerDefs } from './marker-defs.ts';
import { CAMERA_PARAMS, LIVE_MARKER_SIZE } from './config.ts';

interface LiveMarker {
  id: string;
  u: number;
  v: number;
  label: string;
  actual: string;
  match: boolean;
}

@customElement('rr-live-view')
export class RrLiveView extends LitElement {
  @consume({ context: r49FileContext, subscribe: true })
  r49File!: R49File;

  @consume({ context: classifierContext, subscribe: true })
  @state()
  classifier: Classifier | undefined;

  get manifest(): Manifest {
    return this.r49File?.manifest;
  }

  @state()
  private _stream: MediaStream | null = null;

  @state()
  private _detectedMarkers: LiveMarker[] = [];

  @state()
  private _stats = { fps: 0, count: 0, timeMs: 0 };

  @query('video')
  private _video!: HTMLVideoElement;

  private _loopId: number | null = null;
  private _isProcessing = false;
  private _frameCount = 0;
  private _lastFpsTime = 0;

  static styles = [
    statusBarStyles,
    css`
    :host {
      display: flex;
      flex-direction: column;
      flex-grow: 1;
      position: relative;
      background-color: #000;
      overflow: hidden;
    }
    
    video {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    
    .overlay-svg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 10;
    }

    symbol {
      overflow: visible;
    }
    
    .validation-rect {
        fill: none;
        stroke-width: 3;
    }
  `];

  async connectedCallback() {
    super.connectedCallback();
    await this._startCamera();
    this._startLoop();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._stopCamera();
    this._stopLoop();
  }

  private async _startCamera() {
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        video: CAMERA_PARAMS,
      });

      await this.updateComplete;

      if (this._video) {
        this._video.srcObject = this._stream;
        this._video.setAttribute('playsinline', '');
        this._video.muted = true;
        await this._video.play();
      }
    } catch (e) {
      console.error("Failed to start camera", e);
      // alert("Failed to start camera: " + (e as Error).message);
    }
  }

  private _stopCamera() {
    if (this._stream) {
      this._stream.getTracks().forEach(track => track.stop());
      this._stream = null;
    }
  }

  private _startLoop() {
    if (this._loopId) return;

    this._lastFpsTime = performance.now();

    const loop = async (timestamp: number) => {
      if (!this.isConnected) return;

      if (!this._isProcessing && this._video && this._video.readyState >= 2) {
        await this._processFrame(timestamp);
      }

      this._loopId = requestAnimationFrame(loop);
    };
    this._loopId = requestAnimationFrame(loop);
  }

  private _stopLoop() {
    if (this._loopId) {
      cancelAnimationFrame(this._loopId);
      this._loopId = null;
    }
  }

  private async _processFrame(timestamp: number) {
    if (!this.manifest || !this.manifest.images || this.manifest.images.length === 0) return;
    if (!this.classifier) return;

    // Use Image 0 as reference for labels for now
    const labels = this.manifest.images[0].labels;
    if (!labels) return;

    this._isProcessing = true;
    const startTime = performance.now();

    try {
        // Create ImageBitmap from video frame efficiently
        // Note: createImageBitmap(video) is fast
        const bitmap = await createImageBitmap(this._video);
        
        const dpt = this.manifest.dots_per_track;
        const results: LiveMarker[] = [];
        
        // Skip inference if DPT invalid
        if (dpt > 0) {
             const promises = Object.entries(labels).map(async ([id, marker]) => {
                  try {
                      // We limit inference to labels roughly within view? 
                      // For now, check all.
                      const center = { x: marker.x, y: marker.y };
                      const prediction = await this.classifier!.classify(bitmap, center, dpt);
                      
                      results.push({
                          id,
                          u: marker.x,
                          v: marker.y,
                          label: marker.type,
                          actual: prediction,
                          match: marker.type === prediction
                      });
                  } catch (e) {
                      // ignore out of bound patches etc
                  }
             });
             
             await Promise.all(promises);
        }
        
        bitmap.close();
        this._detectedMarkers = results;

    } catch (e) {
        console.error("Inference Error", e);
    }

    const duration = performance.now() - startTime;
    this._frameCount++;
    
    // Update Stats every second
    if (timestamp - this._lastFpsTime >= 1000) {
        this._stats = {
            fps: Math.round(this._frameCount * 1000 / (timestamp - this._lastFpsTime)),
            count: this._frameCount,
            timeMs: Math.round(duration)
        };
        this._frameCount = 0;
        this._lastFpsTime = timestamp;
    }

    this._isProcessing = false;
  }

  render() {
    const w = this._video?.videoWidth || 100;
    const h = this._video?.videoHeight || 100;

    // Live Stats Template
    const { fps, timeMs } = this._stats;
    const statusTemplate = html`
        <div slot="status" class="status-bar">
            <span>Live View</span>
            <span>FPS: ${fps}</span>
            <span>Inf Time: ${timeMs}ms</span>
            <span>Model: ${this.classifier ? this.classifier.spec.model : 'None'}</span>
        </div>
    `;

    return html`
      <rr-page>
        ${statusTemplate}
        <div style="position: relative; width: 100%; height: 100%;">
            <video></video>
            <svg class="overlay-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
                ${getMarkerDefs(LIVE_MARKER_SIZE)}
                ${this._detectedMarkers.map(m => {
                  const color = m.match ? 'green' : 'red';
                  return svg`
                      <g>
                          <use href="#${m.label}" x="${m.u}" y="${m.v}"></use>
                          <rect 
                            x=${m.u - LIVE_MARKER_SIZE / 2} 
                            y=${m.v - LIVE_MARKER_SIZE / 2} 
                            width=${LIVE_MARKER_SIZE} 
                            height=${LIVE_MARKER_SIZE} 
                            class="validation-rect"
                            stroke=${color}
                        />
                      </g>
                  `;
                })}
            </svg>
        </div>
      </rr-page>
    `;
  }

}
