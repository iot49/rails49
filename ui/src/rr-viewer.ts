import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { renderMarker, markerDefs, markerStyles } from './marker.js';
import type { MarkerData } from './marker.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

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
`;

const MARKER_SIZE_PX = 36;

/**
 * Read-only display surface, shared by the editor (`src` → `<img>`) and the
 * live view (`stream` → `<video>`), with markers drawn over it in image pixel
 * coordinates.
 *
 * **It authors nothing.** The v3 pointer machinery — marker add/move/delete and
 * calibration-handle dragging — was removed with the v4 reduction (#19),
 * because v4 has neither point markers nor a draggable `{p0, p1}` pair. Car
 * authoring, sensor placement and the calibration-point tool arrive with the
 * editor spec, and will reintroduce a `screenToSvg` of their own.
 *
 * The `<img>`/`<video>` `object-fit: contain` is matched to the SVG's
 * `preserveAspectRatio="xMidYMid meet"`, so the viewBox maps 1:1 onto image
 * pixel coordinates. Changing either half misplaces every marker.
 */
@customElement('rr-viewer')
export class RrViewer extends LitElement {
  static styles = [viewerStyles, markerStyles];

  @property({ type: String }) src: string | null = null;
  @property({ attribute: false }) stream: MediaStream | null = null;
  @property({ type: Array }) markers: MarkerData[] = [];
  @property({ type: Object }) resolution = { width: 1920, height: 1080 };

  @state() private symbolSize = MARKER_SIZE_PX;

  @query('svg') private svgElement!: SVGSVGElement;

  private resizeObserver: ResizeObserver | null = null;

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
        >
          ${markerDefs()}

          ${this.markers.map(m => renderMarker(m, this.symbolSize))}
        </svg>
      </div>
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
