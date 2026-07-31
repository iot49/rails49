import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { renderMarker, markerDefs, markerStyles } from './marker.js';
import type { MarkerData } from './marker.js';
import { renderCalibrationPoint, calibrationMarkerStyles } from './calibrationMarker.js';
import { renderSensor, sensorMarkerStyles } from './sensorMarker.js';
import type { SensorSymbolSize } from './sensorMarker.js';
import { trackWidthPx } from './geometry.js';
import type { CalibrationPoint, Point, Sensor } from '@occupancy/r49';
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
    /* The overlay takes the pointer so every gesture is reported in one
       coordinate system, and so dragging over the image cannot start the
       browser's native image drag. Which element under the cursor was hit is
       not read from the DOM — geometry.ts answers that from coordinates. */
    pointer-events: auto;
    user-select: none;
    touch-action: none;
  }
`;

const MARKER_SIZE_PX = 36;

/**
 * Label font size as a fraction of the screen-constant symbol size.
 *
 * The calibration crosshair uses the same 0.42 internally, so the two labels
 * are the same size on screen — they are the same kind of annotation, and a
 * difference would read as a difference in importance.
 */
const LABEL_SIZE_RATIO = 0.42;

/**
 * A pointer gesture, in **image pixel coordinates**.
 *
 * Consumers never see screen coordinates: the viewer converts before it emits,
 * so a handler cannot forget to, and cannot get it subtly wrong when the
 * viewport is letterboxed.
 */
export interface ViewerPointerDetail {
  /**
   * Where the pointer is, in the image's own pixel frame — the SVG viewBox,
   * which `object-fit: contain` and `preserveAspectRatio="xMidYMid meet"` keep
   * mapped 1:1 onto it.
   *
   * It may fall **outside** the image bounds: the overlay covers the letterbox
   * bars, and a captured drag keeps reporting after the pointer leaves the
   * element. Clamping is the consumer's decision, not the viewer's.
   */
  readonly point: Point;
  /**
   * Image pixels per screen pixel, read off the same transform as `point`.
   *
   * This is what turns a grab radius in screen pixels into one in image
   * pixels — see `geometry.ts` § `HitTolerance`. It is taken from the CTM
   * rather than from `resolution.width / rect.width`, which is wrong by the
   * letterbox whenever the viewport's aspect ratio differs from the image's.
   */
  readonly imagePxPerScreenPx: number;
  /** The event this came from — `pointerId`, `buttons`, modifier keys. */
  readonly originalEvent: PointerEvent;
}

/** The four events a pointer gesture goes through, start to finish. */
export type ViewerPointerEventName =
  | 'rr-pointer-down'
  | 'rr-pointer-move'
  | 'rr-pointer-up'
  | 'rr-pointer-cancel';

/** A right-click, in image pixel coordinates. Same shape, coarser event. */
export interface ViewerContextMenuDetail extends Omit<ViewerPointerDetail, 'originalEvent'> {
  /**
   * The `contextmenu` event. The viewer does **not** call `preventDefault()`:
   * whether the native menu is suppressed depends on what the consumer does
   * with the right-click, which is state-dependent in the editor and undefined
   * in the live view.
   */
  readonly originalEvent: MouseEvent;
}

/**
 * Display surface, shared by the editor (`src` → `<img>`) and the live view
 * (`stream` → `<video>`), with markers drawn over it in image pixel
 * coordinates.
 *
 * **It reports pointer gestures; it still authors nothing.** The v3 machinery
 * that added, moved and deleted point markers went with the v4 reduction (#19),
 * and none of it comes back — v4 has neither point markers nor a draggable
 * `{p0, p1}` pair. What the viewer does is emit `rr-pointer-*` events whose
 * coordinates are already in **image pixels**; the tools that interpret them
 * live in the editor, and the geometry they need is in `geometry.ts`.
 *
 * The `<img>`/`<video>` `object-fit: contain` is matched to the SVG's
 * `preserveAspectRatio="xMidYMid meet"`, so the viewBox maps 1:1 onto image
 * pixel coordinates. Changing either half misplaces every marker.
 *
 * **Properties:** `src`, `stream`, `markers`, `calibrationPoints`, `sensors`,
 * `dpt`, `resolution`.
 *
 * @fires rr-pointer-down - Pointer pressed. Detail: {@link ViewerPointerDetail}
 * @fires rr-pointer-move - Pointer moved. Detail: {@link ViewerPointerDetail}
 * @fires rr-pointer-up - Gesture finished. Detail: {@link ViewerPointerDetail}
 * @fires rr-pointer-cancel - Gesture abandoned by the browser. Detail: {@link ViewerPointerDetail}
 * @fires rr-pointer-contextmenu - Right-click. Detail: {@link ViewerContextMenuDetail}
 */
@customElement('rr-viewer')
export class RrViewer extends LitElement {
  static styles = [viewerStyles, markerStyles, calibrationMarkerStyles, sensorMarkerStyles];

  @property({ type: String }) src: string | null = null;
  @property({ attribute: false }) stream: MediaStream | null = null;
  @property({ type: Array }) markers: MarkerData[] = [];
  /**
   * The layout's calibration points, drawn as labelled crosshairs.
   *
   * Display only, like `markers`: the editor authors them, and the viewer never
   * writes one. Empty in the live view, which has no reason to show them.
   */
  @property({ attribute: false }) calibrationPoints: readonly CalibrationPoint[] = [];
  /**
   * The layout's sensors, drawn as labelled diamonds.
   *
   * Display only, like `calibrationPoints`. Sensors are per **layout**, not per
   * image, so the same list is drawn over every frame — that is the point of
   * placing one. Empty in the live view today; when it renders L1 state it will
   * pass the same list.
   */
  @property({ attribute: false }) sensors: readonly Sensor[] = [];
  /**
   * The layout's DPT, or `null` when calibration does not resolve one.
   *
   * The one property here that is neither media nor a thing to draw: it is the
   * **scale** the world-sized symbols are drawn at. A sensor is one track width
   * across (`geometry.ts` § `trackWidthPx`) and a car will be 2.09, so both
   * shrink with the photograph rather than staying a constant size on screen —
   * which is what makes a sensor's footprint comparable to the cars around it.
   *
   * `null` is a real state, not an error: an archive can carry sensors and no
   * calibration, since deleting a calibration point is allowed at any time. The
   * symbols then fall back to `symbolSize`, so they stay visible and grabbable
   * instead of vanishing at a size nothing can compute.
   */
  @property({ attribute: false }) dpt: number | null = null;
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

  /**
   * Screen coordinates to image pixels, through the SVG's own transform.
   *
   * `createSVGPoint` + inverse `getScreenCTM()` and never a hand-rolled
   * subtraction of `getBoundingClientRect()`: the rect ignores the letterbox
   * that `preserveAspectRatio="xMidYMid meet"` introduces, so the hand-rolled
   * version is correct only while the viewport happens to match the image's
   * aspect ratio and drifts silently as soon as it does not.
   *
   * Returns `null` where SVG geometry is unavailable — an unattached element,
   * or jsdom, which implements none of it.
   */
  private toImagePoint(
    clientX: number,
    clientY: number
  ): { point: Point; imagePxPerScreenPx: number } | null {
    const svg = this.svgElement;
    if (!svg?.createSVGPoint) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;

    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const { x, y } = pt.matrixTransform(ctm.inverse());
    // ctm.a is screen pixels per image pixel; the overlay never rotates or
    // skews, so the horizontal scale is the whole story.
    return { point: { x, y }, imagePxPerScreenPx: 1 / ctm.a };
  }

  /**
   * Converts, then dispatches. All five events go through here, so there is one
   * place the detail is assembled and one place the conversion can be missed.
   *
   * @returns `false` when there was no transform to convert with, and so
   *          nothing was emitted.
   */
  private reportGesture(name: ViewerPointerEventName, originalEvent: PointerEvent): boolean;
  private reportGesture(name: 'rr-pointer-contextmenu', originalEvent: MouseEvent): boolean;
  private reportGesture(name: string, originalEvent: PointerEvent | MouseEvent): boolean {
    const converted = this.toImagePoint(originalEvent.clientX, originalEvent.clientY);
    if (!converted) return false;
    this.dispatchEvent(
      new CustomEvent<ViewerPointerDetail | ViewerContextMenuDetail>(name, {
        detail: { ...converted, originalEvent } as ViewerPointerDetail | ViewerContextMenuDetail,
        bubbles: true,
        composed: true,
      })
    );
    return true;
  }

  private onPointerDown(e: PointerEvent) {
    // Capture on the overlay, so a drag that wanders off the element — or off
    // the window — still delivers its move and up events here. Without it a
    // gesture can end somewhere the consumer never hears about, leaving a drag
    // live and the next press starting a second one on top of it.
    //
    // Only for a gesture that was actually reported: a capture held for a
    // gesture nobody heard about would divert the events that follow it to an
    // element with no listener.
    if (this.reportGesture('rr-pointer-down', e)) {
      this.svgElement?.setPointerCapture?.(e.pointerId);
    }
  }

  private onPointerMove(e: PointerEvent) {
    this.reportGesture('rr-pointer-move', e);
  }

  private onPointerUp(e: PointerEvent) {
    this.reportGesture('rr-pointer-up', e);
    this.releaseCapture(e.pointerId);
  }

  /**
   * The browser took the gesture away — a touch interrupted, a system gesture.
   * Reported separately rather than folded into `up`, because a consumer that
   * commits on `up` must not commit on a gesture that never finished.
   */
  private onPointerCancel(e: PointerEvent) {
    this.reportGesture('rr-pointer-cancel', e);
    this.releaseCapture(e.pointerId);
  }

  private onContextMenu(e: MouseEvent) {
    this.reportGesture('rr-pointer-contextmenu', e);
  }

  /**
   * Guarded, and after the gesture's end event rather than before it:
   * releasing a capture the element does not hold throws, and a throw ahead of
   * the dispatch would leave the consumer's drag live with nothing to end it.
   */
  private releaseCapture(pointerId: number) {
    const svg = this.svgElement;
    if (svg?.hasPointerCapture?.(pointerId)) svg.releasePointerCapture(pointerId);
  }

  /**
   * The two sizes a sensor is drawn at: a world diameter and a screen label.
   *
   * Assembled here because this is the only place both numbers exist — `dpt`
   * comes down as a property and `symbolSize` is measured off the viewport.
   * With no DPT the diamond falls back to the screen size, which is what keeps
   * the sensors of an uncalibrated archive on screen and grabbable.
   */
  private sensorSize(): SensorSymbolSize {
    return {
      diameterPx: this.dpt === null ? this.symbolSize : trackWidthPx(this.dpt),
      labelPx: this.symbolSize * LABEL_SIZE_RATIO,
    };
  }

  render() {
    return html`
      <div class="viewport">
        ${this.src ? html`<img .src=${this.src} />` : ''}
        ${this.stream ? html`<video .srcObject=${this.stream} autoplay playsinline></video>` : ''}

        <svg
          viewBox="0 0 ${this.resolution.width} ${this.resolution.height}"
          preserveAspectRatio="xMidYMid meet"
          @pointerdown=${this.onPointerDown}
          @pointermove=${this.onPointerMove}
          @pointerup=${this.onPointerUp}
          @pointercancel=${this.onPointerCancel}
          @contextmenu=${this.onContextMenu}
        >
          ${markerDefs()}

          ${this.markers.map(m => renderMarker(m, this.symbolSize))}

          ${this.calibrationPoints.map((p, i) =>
            // `resolution` is the viewBox, so it is also the frame the label
            // must stay inside — a point near an edge draws its label inwards.
            renderCalibrationPoint(p, i, this.symbolSize, this.resolution)
          )}

          ${this.sensors.map(s => renderSensor(s, this.sensorSize(), this.resolution))}
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

  // The events are typed at the listener, not just at the dispatch: they cross
  // the shadow boundary and are handled two components up, where an untyped
  // `CustomEvent` would have to be cast back into shape by hand.
  interface HTMLElementEventMap {
    'rr-pointer-down': CustomEvent<ViewerPointerDetail>;
    'rr-pointer-move': CustomEvent<ViewerPointerDetail>;
    'rr-pointer-up': CustomEvent<ViewerPointerDetail>;
    'rr-pointer-cancel': CustomEvent<ViewerPointerDetail>;
    'rr-pointer-contextmenu': CustomEvent<ViewerContextMenuDetail>;
  }
}
