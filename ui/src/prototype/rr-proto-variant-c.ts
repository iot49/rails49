// PROTOTYPE — throwaway. Wayfinder ticket #5.
//
// VARIANT C — "Spring-loaded".
//
// The bet: mode can never be forgotten if it never persists. There is no
// toolbar and no sticky state. You *hold* a key for as long as you are using
// a tool — C for car, T for track, S for sensor, K for calibrate — and the
// instant you release it you are back in Select. A mode lasts exactly as long
// as your finger.
//
// Deletion is Delete on the current selection, as in B, because a spring-loaded
// destructive mode would be worse than a sticky one, not better.
//
// The cost this variant is here to expose: hold-to-draw fights multi-click
// geometry. A car needs two clicks and a spline needs many, so the key must
// stay down across them. Whether that is comfortable for 20-50 cars an image
// is exactly what you are meant to feel.
//
// Class picker: type-to-filter over the dotted strings — no menu to grow.

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ManifestData } from '@occupancy/r49';
import './rr-proto-canvas.js';
import type { Ghost, ProtoPointerDetail } from './rr-proto-canvas.js';
import { CAR_CLASSES, hitTest, protoId, widthsFor } from './proto-scene.js';
import type { CarSpan, Hit, Scene, Widths } from './proto-scene.js';

type Mode = 'select' | 'calibrate' | 'track' | 'car' | 'sensor';

const KEY_TO_MODE: Record<string, Mode> = {
  k: 'calibrate',
  t: 'track',
  c: 'car',
  s: 'sensor',
};

const MODE_COLOR: Record<Mode, string> = {
  select: '#8a8f98',
  calibrate: '#ff8a65',
  track: '#ffd166',
  car: '#3aa2ff',
  sensor: '#b388ff',
};

@customElement('rr-proto-variant-c')
export class RrProtoVariantC extends LitElement {
  @property({ attribute: false }) scene!: Scene;
  @property({ attribute: false }) manifest!: ManifestData;
  @property({ type: Number }) imageIndex = 0;

  /** Derived purely from which key is physically down. Never set by a click. */
  @state() private _held: Mode = 'select';
  @state() private _sel: Hit | null = null;
  @state() private _hover: Hit | null = null;
  @state() private _ghost: Ghost | null = null;
  @state() private _cls = 'stock';
  @state() private _filter = '';
  @state() private _k = 1;

  private _dragging: 'p0' | 'p1' | null = null;
  private _dragId = '';

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
      min-height: 0;
    }
    .canvas-wrap {
      flex: 1;
      min-height: 0;
      position: relative;
    }
    .hud {
      position: absolute;
      left: 50%;
      bottom: 14px;
      transform: translateX(-50%);
      display: flex;
      gap: 6px;
      align-items: center;
      background: rgb(12 14 18 / 0.9);
      border: 1px solid #2f343c;
      border-radius: 999px;
      padding: 6px 10px;
      z-index: 20;
      backdrop-filter: blur(6px);
    }
    .key {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      background: #23262d;
      color: #9aa1ab;
      font: 600 0.74rem system-ui, sans-serif;
      transition: all 90ms ease;
    }
    .key kbd {
      background: #0d0f13;
      border: 1px solid #3a3f48;
      border-bottom-width: 2px;
      border-radius: 4px;
      padding: 0 5px;
      font: 700 0.7rem ui-monospace, monospace;
      color: #cfd3da;
    }
    .key[data-on='1'] {
      color: #06121f;
      transform: translateY(-3px);
      box-shadow: 0 4px 14px rgb(0 0 0 / 0.6);
    }
    .key[data-on='1'] kbd {
      background: rgb(0 0 0 / 0.25);
      color: #fff;
      border-color: rgb(0 0 0 / 0.4);
      border-bottom-width: 1px;
    }
    .state {
      position: absolute;
      top: 12px;
      left: 12px;
      z-index: 20;
      padding: 5px 12px;
      border-radius: 6px;
      font: 700 0.8rem system-ui, sans-serif;
      color: #06121f;
      box-shadow: 0 2px 10px rgb(0 0 0 / 0.5);
    }
    .stateline {
      position: absolute;
      top: 12px;
      right: 12px;
      z-index: 20;
      background: rgb(12 14 18 / 0.9);
      border: 1px solid #2f343c;
      border-radius: 6px;
      padding: 8px 10px;
      color: #cfd3da;
      font: 400 0.75rem system-ui, sans-serif;
      min-width: 190px;
    }
    .stateline strong {
      color: #fff;
    }
    .stateline input {
      width: 100%;
      margin-top: 4px;
      background: #0d0f13;
      border: 1px solid #3a3f48;
      border-radius: 4px;
      color: #cfd3da;
      padding: 3px 6px;
      font: 400 0.75rem ui-monospace, monospace;
    }
    .opts {
      margin-top: 4px;
      max-height: 110px;
      overflow-y: auto;
    }
    .opts div {
      padding: 2px 4px;
      border-radius: 3px;
      cursor: pointer;
      font: 400 0.73rem ui-monospace, monospace;
    }
    .opts div[data-on='1'] {
      background: #3aa2ff;
      color: #06121f;
    }
    .bar {
      display: flex;
      gap: 1rem;
      align-items: center;
      padding: 0.4rem 0.75rem;
      background: #16181d;
      color: #cfd3da;
      font: 500 0.78rem system-ui, sans-serif;
      flex-shrink: 0;
    }
    .ring {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 10px;
      border-radius: 999px;
      border: 2px solid #5a4200;
      color: #ffcc80;
    }
    .ring.ok {
      border-color: #1f4a2a;
      color: #8fe0a6;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._down);
    window.addEventListener('keyup', this._up);
    window.addEventListener('blur', this._release);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._down);
    window.removeEventListener('keyup', this._up);
    window.removeEventListener('blur', this._release);
  }

  private _typing(e: KeyboardEvent): boolean {
    const t = e.composedPath()[0] as HTMLElement | undefined;
    return !!t && /^(INPUT|TEXTAREA)$/.test(t.tagName ?? '');
  }

  private _down = (e: KeyboardEvent) => {
    if (this._typing(e)) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this._sel) {
      this._deleteSelected();
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      const img = this._image;
      if (img) img.complete = !img.complete;
      this._changed();
      return;
    }
    const m = KEY_TO_MODE[e.key.toLowerCase()];
    if (m && !e.repeat) {
      this._held = m;
      e.preventDefault();
    }
  };

  private _up = (e: KeyboardEvent) => {
    const m = KEY_TO_MODE[e.key.toLowerCase()];
    if (m && this._held === m) this._release();
  };

  /** Releasing the key abandons anything half-drawn — nothing is left dangling. */
  private _release = () => {
    this._held = 'select';
    this._ghost = null;
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

  private _onPointer(e: CustomEvent<ProtoPointerDetail>) {
    const { phase, p, event } = e.detail;
    const tol = 12 * this._k;
    const w = this._widths;

    if (phase === 'move') {
      if (this._dragging) {
        const car = this._image?.cars.find((c) => c.id === this._dragId);
        if (car) {
          car[this._dragging] = p;
          if (car.provenance === 'proposed') car.provenance = 'corrected';
          this._changed();
        }
        return;
      }
      this._hover = hitTest(this.scene, this._image, p, tol, w);
      if (this._ghost) this._ghost = { ...this._ghost, cursor: p };
      return;
    }
    if (phase === 'up') {
      this._dragging = null;
      return;
    }
    if (phase !== 'down') return;

    if (this._held === 'select') {
      const car =
        this._sel?.kind === 'car'
          ? this._image?.cars.find((c) => c.id === this._sel!.id)
          : undefined;
      if (car) {
        if (Math.hypot(p.x - car.p0.x, p.y - car.p0.y) < tol * 1.6) {
          this._dragging = 'p0';
          this._dragId = car.id;
          return;
        }
        if (Math.hypot(p.x - car.p1.x, p.y - car.p1.y) < tol * 1.6) {
          this._dragging = 'p1';
          this._dragId = car.id;
          return;
        }
      }
      this._sel = hitTest(this.scene, this._image, p, tol, w);
      return;
    }

    if (this._held === 'car') {
      if (!this._ghost) {
        this._ghost = { kind: 'car', points: [p], cursor: p };
      } else {
        const car: CarSpan = {
          id: protoId('car'),
          cls: this._cls,
          p0: this._ghost.points[0]!,
          p1: p,
          provenance: 'human',
        };
        this._image?.cars.push(car);
        // Stay armed: the key is still down, so the next click starts a new car.
        this._ghost = null;
        this._changed();
      }
      return;
    }

    if (this._held === 'sensor') {
      this.scene.sensors.push({
        id: protoId('s'),
        x: p.x,
        y: p.y,
        name: `B${this.scene.sensors.length + 1}`,
      });
      this._changed();
      return;
    }

    if (this._held === 'track') {
      if (event.detail >= 2 && this._ghost && this._ghost.points.length >= 2) {
        this.scene.track.push({
          id: protoId('t'),
          points: this._ghost.points,
          provenance: 'human',
        });
        this._ghost = null;
        this._changed();
        return;
      }
      this._ghost = {
        kind: 'track',
        points: [...(this._ghost?.points ?? []), p],
        cursor: p,
      };
      return;
    }

    if (this._held === 'calibrate' && !this.scene.calibration) {
      const r = this.scene.resolution;
      this.scene.calibration = {
        p0: { x: r.width * 0.3, y: r.height * 0.5 },
        p1: { x: r.width * 0.7, y: r.height * 0.5 },
        size_mm: 100,
      };
      this._changed();
    }
  }

  private _deleteSelected() {
    const hit = this._sel;
    if (!hit) return;
    if (hit.kind === 'car' && this._image) {
      this._image.cars = this._image.cars.filter((c) => c.id !== hit.id);
    } else if (hit.kind === 'track') {
      this.scene.track = this.scene.track.filter((t) => t.id !== hit.id);
    } else {
      this.scene.sensors = this.scene.sensors.filter((s) => s.id !== hit.id);
    }
    this._sel = null;
    this._changed();
  }

  render() {
    const img = this._image;
    const color = MODE_COLOR[this._held];
    const matches = CAR_CLASSES.filter((c) => c.includes(this._filter));

    return html`
      <div class="canvas-wrap">
        <rr-proto-canvas
          .scene=${this.scene}
          .image=${img}
          .widths=${this._widths}
          .hover=${this._hover}
          .selection=${this._sel}
          .ghost=${this._ghost}
          .tint=${this._held === 'select' ? null : color}
          .cursor=${this._held === 'select' ? 'default' : 'crosshair'}
          .showCalibration=${this._held === 'calibrate'}
          .showProvenance=${true}
          @proto-pointer=${this._onPointer}
          @proto-scale=${(e: CustomEvent) => (this._k = e.detail.k)}
        ></rr-proto-canvas>

        <div class="state" style="background:${color}">
          ${this._held === 'select'
            ? 'SELECT — no tool held'
            : `holding ${this._held.toUpperCase()}`}
        </div>

        <div class="stateline">
          <div>Cars this image: <strong>${img?.cars.length ?? 0}</strong></div>
          <div>Track splines: <strong>${this.scene.track.length}</strong></div>
          <div>Sensors: <strong>${this.scene.sensors.length}</strong></div>
          <div style="margin-top:6px">New car class</div>
          <input
            placeholder="filter…"
            .value=${this._filter}
            @input=${(e: Event) =>
              (this._filter = (e.target as HTMLInputElement).value)}
          />
          <div class="opts">
            ${matches.map(
              (c) => html`<div
                data-on=${this._cls === c ? '1' : '0'}
                @click=${() => (this._cls = c)}
              >
                ${c}
              </div>`,
            )}
          </div>
        </div>

        <div class="hud">
          ${(['calibrate', 'track', 'car', 'sensor'] as Mode[]).map((m) => {
            const key = Object.keys(KEY_TO_MODE).find(
              (k) => KEY_TO_MODE[k] === m,
            )!;
            return html`<div
              class="key"
              data-on=${this._held === m ? '1' : '0'}
              style=${this._held === m ? `background:${MODE_COLOR[m]}` : ''}
            >
              <kbd>${key.toUpperCase()}</kbd>${m}
            </div>`;
          })}
          <div class="key">
            <kbd>DEL</kbd>${this._sel ? this._sel.label : 'selection'}
          </div>
          <div class="key"><kbd>⏎</kbd>complete</div>
        </div>
      </div>

      <div class="bar">
        <span class="ring ${img?.complete ? 'ok' : ''}">
          ${img?.complete ? '✓' : '⚠'} image ${this.imageIndex + 1}/${this.scene
            .images.length}
          ${img?.complete ? 'complete' : 'incomplete'}
        </span>
        <span style="color:#6f7681">
          Press ⏎ to toggle. Incomplete images are excluded from detector
          training.
        </span>
        ${this._widths.dpt === null
          ? html`<span style="margin-left:auto; color:#ffcc80"
              >Hold K to calibrate — widths cannot be derived yet</span
            >`
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-proto-variant-c': RrProtoVariantC;
  }
}
