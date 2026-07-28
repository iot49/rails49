import { LitElement, html, css, svg } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { renderMarker, markerDefs, markerStyles } from './marker.js';
import type { MarkerData } from './marker.js';
import type { Point } from '@occupancy/r49';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

export interface CalibrationData {
  p0: Point;
  p1: Point;
  size_mm: number;
}

export const viewerStyles = css`
  :host {
    display: block;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .viewport {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #000;
  }

  img, video {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  svg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    user-select: none;
    touch-action: none;
  }

  :host([interactive]) svg {
    pointer-events: auto;
  }

  svg > * {
    pointer-events: auto;
  }

  [data-type] {
    cursor: move;
  }

  :host([activeTool='delete']) [data-type='marker'] {
    cursor: crosshair;
  }


  .calibration-line {
    stroke: coral;
    stroke-width: 8;
    stroke-dasharray: 12;
  }
`;

const MARKER_SIZE_PX = 36;

@customElement('rr-viewer')
export class RrViewer extends LitElement {
  static styles = [viewerStyles, markerStyles];

  @property({ type: String }) src: string | null = null;
  @property({ attribute: false }) stream: MediaStream | null = null;
  @property({ type: Array }) markers: MarkerData[] = [];
  @property({ type: Object }) calibration: CalibrationData | null = null;
  @property({ type: Boolean }) interactive = false;
  @property({ type: String }) activeTool: string | null = null;
  @property({ type: Object }) resolution = { width: 1920, height: 1080 };

  @state() private symbolSize = MARKER_SIZE_PX;

  @query('svg') private svgElement!: SVGSVGElement;

  private dragItem: { id: string, type: 'marker' | 'p0' | 'p1' } | null = null;
  private resizeObserver: ResizeObserver | null = null;

  private screenToSvg(clientX: number, clientY: number): Point {
    const pt = this.svgElement.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const svgPt = pt.matrixTransform(this.svgElement.getScreenCTM()?.inverse());
    return { x: svgPt.x, y: svgPt.y };
  }

  private onSvgClick(e: MouseEvent) {
    if (!this.interactive || this.dragItem) return;

    const target = e.target as SVGElement;
    const type = target.getAttribute('data-type');
    const id = target.getAttribute('data-id');

    if (this.activeTool === 'delete' && type === 'marker' && id) {
      this.dispatchEvent(new CustomEvent('rr-marker-delete', {
        detail: { id },
        bubbles: true,
        composed: true
      }));
      return;
    }

    // Only add if clicking background (the svg itself or something without data-type)
    if (!type && this.activeTool && this.activeTool !== 'delete' && this.activeTool !== 'calibrate') {
      const { x, y } = this.screenToSvg(e.clientX, e.clientY);
      this.dispatchEvent(new CustomEvent('rr-marker-add', {
        detail: { x, y, type: this.activeTool },
        bubbles: true,
        composed: true
      }));
    }
  }

  private onPointerDown(e: PointerEvent) {
    if (!this.interactive) return;

    const target = e.target as SVGElement;
    const type = target.getAttribute('data-type') as 'marker' | 'p0' | 'p1';
    const id = target.getAttribute('data-id') || type; // for p0/p1, id is the type

    if (type && (this.activeTool !== 'delete' || type !== 'marker')) {
      this.dragItem = { id, type };
      (e.target as Element).setPointerCapture(e.pointerId);
    }
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.dragItem) return;

    const { x, y } = this.screenToSvg(e.clientX, e.clientY);

    if (this.dragItem.type === 'marker') {
      this.dispatchEvent(new CustomEvent('rr-marker-move', {
        detail: { id: this.dragItem.id, x, y },
        bubbles: true,
        composed: true
      }));
    } else {
      this.dispatchEvent(new CustomEvent('rr-calibration-move', {
        detail: { id: this.dragItem.id, x, y },
        bubbles: true,
        composed: true
      }));
    }
  }

  private onPointerUp(e: PointerEvent) {
    if (!this.dragItem) return;
    (e.target as Element).releasePointerCapture(e.pointerId);
    this.dragItem = null;
  }


  connectedCallback() {
    super.connectedCallback();
    this.resizeObserver = new ResizeObserver(() => {
      // Use requestAnimationFrame to avoid "update during update" warnings
      // especially when this is triggered during the first mount
      window.requestAnimationFrame(() => this.updateSymbolSize());
    });
    this.resizeObserver.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
  }

  private updateSymbolSize() {
    if (!this.svgElement) return;
    const rect = this.svgElement.getBoundingClientRect();
    if (rect.width === 0) return;

    // symbolSize in SVG units = constant_px * (viewBoxWidth / screenWidth)
    const newSize = MARKER_SIZE_PX * (this.resolution.width / rect.width);
    if (this.symbolSize !== newSize) {
      this.symbolSize = newSize;
    }
  }

  render() {
    return html`
      <div class="viewport">
        ${this.src ? html`<img .src=${this.src} />` : ''}
        ${this.stream ? html`<video .srcObject=${this.stream} autoplay playsinline></video>` : ''}

        <svg
          viewBox="0 0 ${this.resolution.width} ${this.resolution.height}"
          preserveAspectRatio="xMidYMid meet"
          @click=${this.onSvgClick}
          @pointerdown=${this.onPointerDown}
          @pointermove=${this.onPointerMove}
          @pointerup=${this.onPointerUp}
        >
          ${markerDefs()}

          ${this.markers.map(m => renderMarker(m, this.symbolSize))}

          ${this.calibration ? this.renderCalibration() : ''}
        </svg>
      </div>
    `;
  }

  private renderCalibration() {
    if (!this.calibration) return '';
    const { p0, p1 } = this.calibration;
    return svg`
      <line
        class="calibration-line"
        x1="${p0.x}" y1="${p0.y}"
        x2="${p1.x}" y2="${p1.y}"
      />
      <use
        href="#drag-handle"
        data-type="p0"
        x="${p0.x - this.symbolSize / 2}"
        y="${p0.y - this.symbolSize / 2}"
        width="${this.symbolSize}"
        height="${this.symbolSize}"
      />
      <use
        href="#drag-handle"
        data-type="p1"
        x="${p1.x - this.symbolSize / 2}"
        y="${p1.y - this.symbolSize / 2}"
        width="${this.symbolSize}"
        height="${this.symbolSize}"
      />
    `;
  }

  getVideoElement(): HTMLVideoElement | null {
    return this.shadowRoot?.querySelector('video') || null;
  }

  getImageElement(): HTMLImageElement | null {
    return this.shadowRoot?.querySelector('img') || null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-viewer': RrViewer;
  }
}
