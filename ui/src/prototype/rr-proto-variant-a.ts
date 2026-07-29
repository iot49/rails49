// PROTOTYPE — throwaway. Wayfinder ticket #5.
//
// VARIANT A — "Sticky + Loud".
//
// Keeps today's modal toolbar. The bet is that modality is fine and the bug is
// that the current UI whispers which mode you are in. So: the mode is stated
// four times over — a coloured banner, a coloured frame around the canvas, a
// chip glued to the cursor, and a mode-coloured cursor. Delete additionally
// names its victim before you commit: hovering paints the object red and the
// cursor chip reads "delete: car (stock)".
//
// Class picker: a flat dropdown of dotted strings. Deliberately the naive
// option, so the sprawl problem is visible rather than argued about.

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Point } from '@occupancy/r49';
import './rr-proto-canvas.js';
import type { Ghost, ProtoPointerDetail } from './rr-proto-canvas.js';
import {
  CAR_CLASSES,
  classLeaf,
  hitTest,
  protoId,
  widthsFor,
} from './proto-scene.js';
import type { Hit, Scene, Widths } from './proto-scene.js';
import type { ManifestData } from '@occupancy/r49';

type Mode = 'select' | 'calibrate' | 'track' | 'car' | 'sensor' | 'delete';

const MODE_COLOR: Record<Mode, string> = {
  select: '#8a8f98',
  calibrate: '#ff8a65',
  track: '#ffd166',
  car: '#3aa2ff',
  sensor: '#b388ff',
  delete: '#ff3b30',
};

const MODE_LABEL: Record<Mode, string> = {
  select: 'Select',
  calibrate: 'Calibrate',
  track: 'Draw track',
  car: 'Label cars',
  sensor: 'Place sensors',
  delete: 'DELETE',
};

@customElement('rr-proto-variant-a')
export class RrProtoVariantA extends LitElement {
  @property({ attribute: false }) scene!: Scene;
  @property({ attribute: false }) manifest!: ManifestData;
  @property({ type: Number }) imageIndex = 0;

  @state() private _mode: Mode = 'car';
  @state() private _cls: string = 'stock';
  @state() private _hover: Hit | null = null;
  @state() private _ghost: Ghost | null = null;
  @state() private _cursorScreen: Point | null = null;
  @state() private _k = 1;

  private _dragCal: 'p0' | 'p1' | null = null;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
      min-height: 0;
      position: relative;
    }
    .banner {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.4rem 0.75rem;
      font: 600 0.85rem system-ui, sans-serif;
      color: #111;
      flex-shrink: 0;
    }
    .banner .hint {
      font-weight: 400;
      opacity: 0.8;
    }
    .body {
      flex: 1;
      display: flex;
      min-height: 0;
    }
    .rail {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 6px;
      background: #16181d;
      flex-shrink: 0;
    }
    .rail button {
      width: 64px;
      padding: 8px 4px;
      border: 2px solid transparent;
      border-radius: 6px;
      background: #23262d;
      color: #cfd3da;
      font: 600 0.68rem system-ui, sans-serif;
      cursor: pointer;
    }
    .rail button[data-active='1'] {
      color: #111;
    }
    .rail button.danger {
      margin-top: auto;
    }
    .canvas-wrap {
      flex: 1;
      min-width: 0;
      position: relative;
    }
    .chip {
      position: fixed;
      z-index: 30;
      transform: translate(14px, 14px);
      padding: 3px 8px;
      border-radius: 4px;
      font: 600 0.72rem system-ui, sans-serif;
      color: #111;
      pointer-events: none;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgb(0 0 0 / 0.5);
    }
    .footer {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.4rem 0.75rem;
      background: #16181d;
      color: #cfd3da;
      font: 500 0.78rem system-ui, sans-serif;
      flex-shrink: 0;
    }
    .footer label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      cursor: pointer;
    }
    select {
      background: #23262d;
      color: #cfd3da;
      border: 1px solid #3a3f48;
      border-radius: 4px;
      padding: 3px 6px;
      font: 500 0.78rem system-ui, sans-serif;
    }
    .incomplete {
      color: #ffcc80;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._onKey);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._onKey);
  }

  private _onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      this._ghost = null;
      this._mode = 'select';
      e.preventDefault();
    }
  };

  private get _image() {
    return this.scene.images[this.imageIndex];
  }

  private get _widths(): Widths {
    return widthsFor(this.manifest);
  }

  private _changed() {
    this.dispatchEvent(
      new CustomEvent('proto-change', { bubbles: true, composed: true }),
    );
    this.requestUpdate();
  }

  private _setMode(m: Mode) {
    this._mode = m;
    this._ghost = null;
    this._hover = null;
  }

  // -- pointer -------------------------------------------------------------

  private _onPointer(e: CustomEvent<ProtoPointerDetail>) {
    const { phase, p, event } = e.detail;
    const w = this._widths;
    const tol = 12 * this._k;

    if (phase === 'leave') {
      this._cursorScreen = null;
      this._hover = null;
      return;
    }
    this._cursorScreen = { x: event.clientX, y: event.clientY };

    if (this._mode === 'calibrate') return this._calibrate(phase, p, tol);

    if (phase === 'move') {
      this._hover = hitTest(this.scene, this._image, p, tol, w);
      if (this._ghost) this._ghost = { ...this._ghost, cursor: p };
      return;
    }

    if (phase !== 'down') return;

    switch (this._mode) {
      case 'delete': {
        const hit = hitTest(this.scene, this._image, p, tol, w);
        if (hit) this._delete(hit);
        return;
      }
      case 'car': {
        if (!this._ghost) {
          this._ghost = { kind: 'car', points: [p], cursor: p };
        } else {
          const p0 = this._ghost.points[0]!;
          this._image?.cars.push({
            id: protoId('car'),
            cls: this._cls,
            p0,
            p1: p,
            provenance: 'human',
          });
          this._ghost = null;
          this._changed();
        }
        return;
      }
      case 'sensor': {
        this.scene.sensors.push({
          id: protoId('s'),
          x: p.x,
          y: p.y,
          name: `B${this.scene.sensors.length + 1}`,
        });
        this._changed();
        return;
      }
      case 'track': {
        if (event.detail >= 2 && this._ghost) {
          if (this._ghost.points.length >= 2) {
            this.scene.track.push({
              id: protoId('t'),
              points: this._ghost.points,
              provenance: 'human',
            });
            this._changed();
          }
          this._ghost = null;
          return;
        }
        this._ghost = {
          kind: 'track',
          points: [...(this._ghost?.points ?? []), p],
          cursor: p,
        };
        return;
      }
      default:
        return;
    }
  }

  private _calibrate(phase: ProtoPointerDetail['phase'], p: Point, tol: number) {
    const cal = this.scene.calibration;
    if (!cal) {
      const r = this.scene.resolution;
      this.scene.calibration = {
        p0: { x: r.width * 0.3, y: r.height * 0.5 },
        p1: { x: r.width * 0.7, y: r.height * 0.5 },
        size_mm: 100,
      };
      this._changed();
      return;
    }
    if (phase === 'down') {
      this._dragCal =
        Math.hypot(p.x - cal.p0.x, p.y - cal.p0.y) < tol * 2
          ? 'p0'
          : Math.hypot(p.x - cal.p1.x, p.y - cal.p1.y) < tol * 2
            ? 'p1'
            : null;
    } else if (phase === 'move' && this._dragCal) {
      cal[this._dragCal] = p;
      this._changed();
    } else if (phase === 'up') {
      this._dragCal = null;
    }
  }

  private _delete(hit: Hit) {
    if (hit.kind === 'car' && this._image) {
      this._image.cars = this._image.cars.filter((c) => c.id !== hit.id);
    } else if (hit.kind === 'track') {
      this.scene.track = this.scene.track.filter((t) => t.id !== hit.id);
    } else if (hit.kind === 'sensor') {
      this.scene.sensors = this.scene.sensors.filter((s) => s.id !== hit.id);
    }
    this._hover = null;
    this._changed();
  }

  // -- render --------------------------------------------------------------

  render() {
    const color = MODE_COLOR[this._mode];
    const img = this._image;
    const modes: Mode[] = ['select', 'calibrate', 'track', 'car', 'sensor'];

    return html`
      <div class="banner" style="background:${color}">
        <strong>${MODE_LABEL[this._mode]}</strong>
        <span class="hint">${this._hint()}</span>
      </div>

      <div class="body">
        <div class="rail">
          ${modes.map(
            (m) => html`
              <button
                data-active=${this._mode === m ? '1' : '0'}
                style=${this._mode === m ? `background:${MODE_COLOR[m]}` : ''}
                @click=${() => this._setMode(m)}
              >
                ${MODE_LABEL[m]}
              </button>
            `,
          )}
          <button
            class="danger"
            data-active=${this._mode === 'delete' ? '1' : '0'}
            style=${this._mode === 'delete'
              ? `background:${MODE_COLOR.delete}`
              : 'border-color:#5a2320'}
            @click=${() => this._setMode('delete')}
          >
            DELETE
          </button>
        </div>

        <div class="canvas-wrap">
          <rr-proto-canvas
            .scene=${this.scene}
            .image=${img}
            .widths=${this._widths}
            .hover=${this._hover}
            .ghost=${this._ghost}
            .tint=${this._mode === 'select' ? null : color}
            .cursor=${this._mode === 'select' ? 'default' : 'crosshair'}
            .showCalibration=${this._mode === 'calibrate'}
            .showProvenance=${true}
            @proto-pointer=${this._onPointer}
            @proto-scale=${(e: CustomEvent) => (this._k = e.detail.k)}
          ></rr-proto-canvas>
        </div>
      </div>

      <div class="footer">
        <label>
          <input
            type="checkbox"
            .checked=${img?.complete ?? false}
            @change=${(e: Event) => {
              if (img) img.complete = (e.target as HTMLInputElement).checked;
              this._changed();
            }}
          />
          All cars in this image are labeled
        </label>
        <span class=${img?.complete ? '' : 'incomplete'}>
          ${img?.complete
            ? `✓ exported for training — ${img.cars.length} cars`
            : `⚠ excluded from training — ${img?.cars.length ?? 0} cars so far`}
        </span>
        <span style="margin-left:auto">
          Class
          <select
            .value=${this._cls}
            @change=${(e: Event) =>
              (this._cls = (e.target as HTMLSelectElement).value)}
          >
            ${CAR_CLASSES.map((c) => html`<option value=${c}>${c}</option>`)}
          </select>
        </span>
      </div>

      ${this._cursorScreen && this._mode !== 'select'
        ? html`<div
            class="chip"
            style="left:${this._cursorScreen.x}px; top:${this._cursorScreen
              .y}px; background:${color}"
          >
            ${this._chipText()}
          </div>`
        : nothing}
    `;
  }

  private _chipText(): string {
    if (this._mode === 'delete') {
      return this._hover
        ? `delete: ${this._hover.label}`
        : 'DELETE — nothing under cursor';
    }
    if (this._mode === 'car') {
      return this._ghost ? 'click far end' : `new ${classLeaf(this._cls)}`;
    }
    if (this._mode === 'track') {
      return this._ghost
        ? `${this._ghost.points.length} pts — double-click to finish`
        : 'click to start spline';
    }
    return MODE_LABEL[this._mode];
  }

  private _hint(): string {
    switch (this._mode) {
      case 'delete':
        return 'Hover names what will be destroyed. Esc leaves this mode.';
      case 'car':
        return 'Click one end of the car, then the other.';
      case 'track':
        return 'Click to add control points, double-click to finish. Layout-wide — drawn once.';
      case 'sensor':
        return 'Click where occupancy must be reported. Layout-wide.';
      case 'calibrate':
        return 'Drag the two handles onto a known distance.';
      default:
        return 'Pick a tool.';
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-proto-variant-a': RrProtoVariantA;
  }
}
