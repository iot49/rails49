// PROTOTYPE — throwaway. Wayfinder ticket #5.
//
// A dumb renderer, deliberately policy-free: it draws the scene and reports
// pointer positions in image pixels. Every interaction decision — what a mode
// is, how it is signalled, how deletion works — belongs to the variant, which
// is the thing under evaluation.
//
// It preserves rr-viewer's two load-bearing invariants: `object-fit: contain`
// matched to `preserveAspectRatio="xMidYMid meet"` (so the viewBox maps 1:1
// onto image pixels), and screenToSvg via createSVGPoint + inverse
// getScreenCTM. See ui/CLAUDE.md.

import { LitElement, html, css, svg, nothing } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import type { SVGTemplateResult } from 'lit';
import type { Point } from '@occupancy/r49';
import type { Hit, ImageState, Scene, Widths } from './proto-scene.js';
import {
  cornersToPoints,
  spanCorners,
  splinePath,
} from './proto-scene.js';

const HANDLE_PX = 11;

/** In-progress geometry a variant is drawing but has not committed. */
export interface Ghost {
  kind: 'car' | 'track' | 'calibration';
  points: Point[];
  /** Rubber-band target, usually the live cursor. */
  cursor?: Point;
}

export interface ProtoPointerDetail {
  phase: 'down' | 'move' | 'up' | 'leave';
  p: Point;
  event: PointerEvent;
}

@customElement('rr-proto-canvas')
export class RrProtoCanvas extends LitElement {
  @property({ attribute: false }) scene!: Scene;
  @property({ attribute: false }) image: ImageState | undefined;
  @property({ attribute: false }) widths!: Widths;
  @property({ attribute: false }) hover: Hit | null = null;
  @property({ attribute: false }) selection: Hit | null = null;
  @property({ attribute: false }) ghost: Ghost | null = null;

  /** Ambient mode signalling. The variant decides whether to use any of it. */
  @property({ type: String }) tint: string | null = null;
  @property({ type: String }) cursor = 'default';
  /** Track drawn as dim reference rather than editable geometry. */
  @property({ type: Boolean }) dimTrack = false;
  /** Show calibration handles. */
  @property({ type: Boolean }) showCalibration = false;
  /** Provenance badges on cars. */
  @property({ type: Boolean }) showProvenance = false;

  /** Image pixels per screen pixel. Republished as `proto-scale` on resize. */
  @state() private _k = 1;

  @query('svg') private _svg!: SVGSVGElement;

  private _ro: ResizeObserver | null = null;

  static styles = css`
    :host {
      display: block;
      position: relative;
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
    img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      touch-action: none;
      user-select: none;
    }
    .tint {
      position: absolute;
      inset: 0;
      pointer-events: none;
      border: 4px solid transparent;
      transition: border-color 120ms ease;
    }
    .car {
      stroke-width: 2;
      vector-effect: non-scaling-stroke;
    }
    .car-fill {
      fill: #3aa2ff;
      fill-opacity: 0.25;
      stroke: #3aa2ff;
    }
    .car-fill[data-hover='1'] {
      fill-opacity: 0.45;
    }
    .car-fill[data-selected='1'] {
      stroke: #fff;
      stroke-width: 3;
      fill-opacity: 0.4;
    }
    .car-fill[data-doomed='1'] {
      fill: #ff3b30;
      fill-opacity: 0.55;
      stroke: #ff3b30;
      stroke-width: 3;
    }
    .car-axis {
      stroke: #cfe9ff;
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
      stroke-dasharray: 6 4;
      pointer-events: none;
    }
    .track-body {
      fill: none;
      stroke: #ffd166;
      stroke-opacity: 0.75;
      stroke-linecap: round;
    }
    .track-body[data-dim='1'] {
      stroke-opacity: 0.3;
    }
    .track-body[data-doomed='1'] {
      stroke: #ff3b30;
      stroke-opacity: 0.85;
    }
    .track-center {
      fill: none;
      stroke: #fff3d0;
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
      pointer-events: none;
    }
    .sensor-dot {
      fill: #b388ff;
      stroke: #fff;
      stroke-width: 2;
      vector-effect: non-scaling-stroke;
    }
    .sensor-dot[data-doomed='1'] {
      fill: #ff3b30;
    }
    .handle {
      fill: #fff;
      stroke: #111;
      stroke-width: 1.5;
      vector-effect: non-scaling-stroke;
    }
    .cal-line {
      stroke: coral;
      stroke-width: 4;
      stroke-dasharray: 12 8;
      vector-effect: non-scaling-stroke;
    }
    .cal-handle {
      fill: coral;
      stroke: #fff;
      stroke-width: 2;
      vector-effect: non-scaling-stroke;
    }
    .ghost-line {
      stroke: #fff;
      stroke-width: 2;
      stroke-dasharray: 8 6;
      vector-effect: non-scaling-stroke;
      fill: none;
    }
    .ghost-fill {
      fill: #ffffff;
      fill-opacity: 0.18;
      stroke: #fff;
      stroke-width: 1.5;
      vector-effect: non-scaling-stroke;
    }
    .badge {
      font: 600 11px system-ui, sans-serif;
      fill: #fff;
      paint-order: stroke;
      stroke: #000;
      stroke-width: 3;
      pointer-events: none;
    }
    .uncal {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      pointer-events: none;
    }
    .uncal span {
      background: #4a2f00;
      color: #ffcc80;
      padding: 0.6rem 1rem;
      border-radius: 6px;
      font: 500 0.9rem system-ui, sans-serif;
      max-width: 26rem;
      text-align: center;
      line-height: 1.4;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._ro = new ResizeObserver(() => {
      window.requestAnimationFrame(() => this._recomputeScale());
    });
    this._ro.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._ro?.disconnect();
  }

  private _recomputeScale() {
    if (!this._svg) return;
    const rect = this._svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const k = this.scene.resolution.width / rect.width;
    if (k !== this._k) {
      this._k = k;
      this.dispatchEvent(
        new CustomEvent('proto-scale', {
          detail: { k },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  /** Screen pixels expressed in image pixels — for constant-size handles. */
  get k(): number {
    return this._k;
  }

  private _toImage(e: PointerEvent): Point {
    const pt = this._svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = this._svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }

  private _emit(phase: ProtoPointerDetail['phase'], e: PointerEvent) {
    this.dispatchEvent(
      new CustomEvent<ProtoPointerDetail>('proto-pointer', {
        detail: { phase, p: this._toImage(e), event: e },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    const { width, height } = this.scene.resolution;
    const uncalibrated = this.widths.dpt === null;

    return html`
      <div class="viewport" style="cursor: ${this.cursor}">
        ${this.image?.url
          ? html`<img .src=${this.image.url} alt="" />`
          : nothing}

        <svg
          viewBox="0 0 ${width} ${height}"
          preserveAspectRatio="xMidYMid meet"
          @pointerdown=${(e: PointerEvent) => {
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            this._emit('down', e);
          }}
          @pointermove=${(e: PointerEvent) => this._emit('move', e)}
          @pointerup=${(e: PointerEvent) => {
            (e.currentTarget as Element).releasePointerCapture(e.pointerId);
            this._emit('up', e);
          }}
          @pointerleave=${(e: PointerEvent) => this._emit('leave', e)}
        >
          ${this._renderTrack()} ${this._renderCars()} ${this._renderSensors()}
          ${this.showCalibration ? this._renderCalibration() : nothing}
          ${this._renderGhost()}
        </svg>

        <div
          class="tint"
          style=${this.tint ? `border-color: ${this.tint}` : ''}
        ></div>

        ${uncalibrated
          ? html`<div class="uncal">
              <span
                >Uncalibrated — car and track width are derived from the scale,
                so nothing can be drawn to size yet. Set the two calibration
                points first.</span
              >
            </div>`
          : nothing}
      </div>
    `;
  }

  private _isDoomed(kind: Hit['kind'], id: string): boolean {
    // The variant marks a target doomed by setting `hover` while in a
    // destructive mode; the canvas only draws what it is told.
    return this.hover?.kind === kind && this.hover.id === id && this.tint === '#ff3b30';
  }

  private _renderTrack(): SVGTemplateResult {
    const w = this.widths.trackPx ?? 0;
    return svg`${this.scene.track.map((t) => {
      const d = splinePath(t.points);
      const doomed = this._isDoomed('track', t.id);
      return svg`
        <g>
          <path
            class="track-body"
            data-dim=${this.dimTrack ? '1' : '0'}
            data-doomed=${doomed ? '1' : '0'}
            d=${d}
            stroke-width=${w}
          />
          <path class="track-center" d=${d} />
          ${
            this.dimTrack
              ? nothing
              : t.points.map(
                  (p) => svg`<circle class="handle" cx=${p.x} cy=${p.y}
                    r=${(HANDLE_PX / 2) * this._k} />`,
                )
          }
        </g>`;
    })}`;
  }

  private _renderCars(): SVGTemplateResult {
    const w = this.widths.carPx ?? 0;
    return svg`${(this.image?.cars ?? []).map((c) => {
      const corners = spanCorners(c.p0, c.p1, w);
      const hovered = this.hover?.kind === 'car' && this.hover.id === c.id;
      const selected = this.selection?.kind === 'car' && this.selection.id === c.id;
      const doomed = this._isDoomed('car', c.id);
      const mid = { x: (c.p0.x + c.p1.x) / 2, y: (c.p0.y + c.p1.y) / 2 };
      return svg`
        <g>
          <polygon
            class="car car-fill"
            data-hover=${hovered ? '1' : '0'}
            data-selected=${selected ? '1' : '0'}
            data-doomed=${doomed ? '1' : '0'}
            points=${cornersToPoints(corners)}
          />
          <line class="car-axis" x1=${c.p0.x} y1=${c.p0.y} x2=${c.p1.x} y2=${c.p1.y} />
          ${
            selected
              ? svg`
                <circle class="handle" cx=${c.p0.x} cy=${c.p0.y} r=${(HANDLE_PX / 2) * this._k} />
                <circle class="handle" cx=${c.p1.x} cy=${c.p1.y} r=${(HANDLE_PX / 2) * this._k} />`
              : nothing
          }
          ${
            this.showProvenance && c.provenance !== 'human'
              ? svg`<text class="badge" x=${mid.x} y=${mid.y - w / 2 - 4 * this._k}
                  text-anchor="middle" font-size=${12 * this._k}
                  >${c.provenance === 'proposed' ? '◇ proposed' : '◆ corrected'}</text>`
              : nothing
          }
        </g>`;
    })}`;
  }

  private _renderSensors(): SVGTemplateResult {
    const r = 9 * this._k;
    return svg`${this.scene.sensors.map((s) => {
      const doomed = this._isDoomed('sensor', s.id);
      return svg`
        <g>
          <circle class="sensor-dot" data-doomed=${doomed ? '1' : '0'}
            cx=${s.x} cy=${s.y} r=${r} />
          <text class="badge" x=${s.x} y=${s.y - r - 4 * this._k}
            text-anchor="middle" font-size=${12 * this._k}>${s.name ?? s.id}</text>
        </g>`;
    })}`;
  }

  private _renderCalibration(): SVGTemplateResult | typeof nothing {
    const cal = this.scene.calibration;
    if (!cal) return nothing;
    const r = 9 * this._k;
    return svg`
      <line class="cal-line" x1=${cal.p0.x} y1=${cal.p0.y} x2=${cal.p1.x} y2=${cal.p1.y} />
      <circle class="cal-handle" data-cal="p0" cx=${cal.p0.x} cy=${cal.p0.y} r=${r} />
      <circle class="cal-handle" data-cal="p1" cx=${cal.p1.x} cy=${cal.p1.y} r=${r} />
      <text class="badge" text-anchor="middle" font-size=${13 * this._k}
        x=${(cal.p0.x + cal.p1.x) / 2} y=${(cal.p0.y + cal.p1.y) / 2 - 10 * this._k}
        >${cal.size_mm} mm</text>`;
  }

  private _renderGhost(): SVGTemplateResult | typeof nothing {
    const g = this.ghost;
    if (!g || g.points.length === 0) return nothing;
    const pts = g.cursor ? [...g.points, g.cursor] : g.points;

    if (g.kind === 'car' && pts.length >= 2) {
      const w = this.widths.carPx ?? 0;
      return svg`
        <polygon class="ghost-fill"
          points=${cornersToPoints(spanCorners(pts[0]!, pts[1]!, w))} />
        <line class="ghost-line" x1=${pts[0]!.x} y1=${pts[0]!.y}
          x2=${pts[1]!.x} y2=${pts[1]!.y} />`;
    }
    if (g.kind === 'track') {
      return svg`
        <path class="ghost-line" d=${splinePath(pts)}
          stroke-width=${Math.max(2 * this._k, 2)} />
        ${g.points.map(
          (p) => svg`<circle class="handle" cx=${p.x} cy=${p.y}
            r=${(HANDLE_PX / 2) * this._k} />`,
        )}`;
    }
    return svg`${pts.map(
      (p) => svg`<circle class="handle" cx=${p.x} cy=${p.y} r=${(HANDLE_PX / 2) * this._k} />`,
    )}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-proto-canvas': RrProtoCanvas;
  }
}
