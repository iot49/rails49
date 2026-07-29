// PROTOTYPE — throwaway. Wayfinder ticket #5.
//
// VARIANT B — "No delete mode".
//
// The bet: you cannot forget you are in delete mode if there is no delete
// mode. Modes exist only for *creating* things, and every mode is additive —
// the worst a forgotten mode can do is add an object you did not want, which
// is visible and trivially undone.
//
// Deletion is selection-based instead: click an object to select it, and it
// gets an inspector on the right showing what it is, plus a × handle and the
// Delete key. Destruction always requires the object to be selected first, so
// it is always preceded by seeing exactly what you picked.
//
// Class picker: a cascading breadcrumb (stock › loco › steam). Each level is a
// chip row, so adding subtypes later widens one row rather than growing one
// long menu — the scaling answer to decision 7.

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Point, ManifestData } from '@occupancy/r49';
import './rr-proto-canvas.js';
import type { Ghost, ProtoPointerDetail } from './rr-proto-canvas.js';
import {
  CAR_CLASSES,
  hitTest,
  protoId,
  widthsFor,
} from './proto-scene.js';
import type { CarSpan, Hit, Scene, Widths } from './proto-scene.js';

type Tool = 'select' | 'calibrate' | 'track' | 'car' | 'sensor';

const TOOL_LABEL: Record<Tool, string> = {
  select: 'Select & edit',
  calibrate: 'Calibrate',
  track: 'Track',
  car: 'Car',
  sensor: 'Sensor',
};

@customElement('rr-proto-variant-b')
export class RrProtoVariantB extends LitElement {
  @property({ attribute: false }) scene!: Scene;
  @property({ attribute: false }) manifest!: ManifestData;
  @property({ type: Number }) imageIndex = 0;

  @state() private _tool: Tool = 'car';
  @state() private _sel: Hit | null = null;
  @state() private _hover: Hit | null = null;
  @state() private _ghost: Ghost | null = null;
  @state() private _k = 1;

  private _dragging: { kind: 'p0' | 'p1' | 'cal0' | 'cal1' | 'sensor'; id: string } | null =
    null;

  static styles = css`
    :host {
      display: flex;
      flex: 1;
      min-width: 0;
      min-height: 0;
    }
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .tools {
      display: flex;
      gap: 6px;
      padding: 6px 8px;
      background: #16181d;
      align-items: center;
      flex-shrink: 0;
    }
    .tools button {
      padding: 6px 12px;
      border: 1px solid #3a3f48;
      border-radius: 999px;
      background: #23262d;
      color: #cfd3da;
      font: 600 0.78rem system-ui, sans-serif;
      cursor: pointer;
    }
    .tools button[data-active='1'] {
      background: #3aa2ff;
      border-color: #3aa2ff;
      color: #06121f;
    }
    .tools .note {
      margin-left: auto;
      color: #6f7681;
      font: 400 0.72rem system-ui, sans-serif;
    }
    .canvas-wrap {
      flex: 1;
      min-height: 0;
      position: relative;
    }
    .inspector {
      width: 264px;
      flex-shrink: 0;
      background: #16181d;
      border-left: 1px solid #2a2e35;
      padding: 10px;
      overflow-y: auto;
      color: #cfd3da;
      font: 400 0.8rem system-ui, sans-serif;
    }
    .inspector h4 {
      margin: 0 0 6px;
      font-size: 0.72rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #7c838e;
    }
    .card {
      background: #1e2128;
      border: 1px solid #2f343c;
      border-radius: 8px;
      padding: 10px;
      margin-bottom: 10px;
    }
    .empty {
      color: #6f7681;
      font-style: italic;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin: 4px 0 8px;
    }
    .chips button {
      padding: 3px 9px;
      border-radius: 999px;
      border: 1px solid #3a3f48;
      background: #23262d;
      color: #cfd3da;
      font: 500 0.74rem system-ui, sans-serif;
      cursor: pointer;
    }
    .chips button[data-on='1'] {
      background: #3aa2ff;
      border-color: #3aa2ff;
      color: #06121f;
    }
    .crumb {
      font: 600 0.8rem ui-monospace, monospace;
      color: #9fd0ff;
      margin-bottom: 6px;
      word-break: break-all;
    }
    .del {
      width: 100%;
      padding: 7px;
      border-radius: 6px;
      border: 1px solid #7a2b26;
      background: #2a1614;
      color: #ff6b60;
      font: 600 0.8rem system-ui, sans-serif;
      cursor: pointer;
    }
    .del:hover {
      background: #3a1c19;
    }
    .gate {
      border-color: #5a4200;
      background: #241b06;
      color: #ffcc80;
    }
    .gate.ok {
      border-color: #1f4a2a;
      background: #0f2416;
      color: #8fe0a6;
    }
    ul {
      margin: 6px 0 0;
      padding-left: 1.1rem;
    }
    li {
      margin: 2px 0;
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
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this._sel) {
      this._deleteSelected();
      e.preventDefault();
    }
    if (e.key === 'Escape') {
      this._ghost = null;
      this._sel = null;
      this._tool = 'select';
    }
  };

  private get _image() {
    return this.scene.images[this.imageIndex];
  }
  private get _widths(): Widths {
    return widthsFor(this.manifest);
  }
  private get _selectedCar(): CarSpan | undefined {
    if (this._sel?.kind !== 'car') return undefined;
    return this._image?.cars.find((c) => c.id === this._sel!.id);
  }

  private _changed() {
    this.dispatchEvent(
      new CustomEvent('proto-change', { bubbles: true, composed: true }),
    );
    this.requestUpdate();
  }

  // -- pointer -------------------------------------------------------------

  private _onPointer(e: CustomEvent<ProtoPointerDetail>) {
    const { phase, p, event } = e.detail;
    const tol = 12 * this._k;
    const w = this._widths;

    if (phase === 'move') {
      if (this._dragging) return this._drag(p);
      this._hover = hitTest(this.scene, this._image, p, tol, w);
      if (this._ghost) this._ghost = { ...this._ghost, cursor: p };
      return;
    }
    if (phase === 'up') {
      this._dragging = null;
      return;
    }
    if (phase !== 'down') return;

    // Grabbing an endpoint of the current selection always wins over the tool:
    // editing a thing you have selected should not require changing mode.
    if (this._grabHandle(p, tol)) return;

    switch (this._tool) {
      case 'select': {
        this._sel = hitTest(this.scene, this._image, p, tol, w);
        return;
      }
      case 'calibrate': {
        if (!this.scene.calibration) {
          const r = this.scene.resolution;
          this.scene.calibration = {
            p0: { x: r.width * 0.3, y: r.height * 0.5 },
            p1: { x: r.width * 0.7, y: r.height * 0.5 },
            size_mm: 100,
          };
          this._changed();
        }
        return;
      }
      case 'car': {
        if (!this._ghost) {
          this._ghost = { kind: 'car', points: [p], cursor: p };
        } else {
          const car: CarSpan = {
            id: protoId('car'),
            cls: this._crumbClass(),
            p0: this._ghost.points[0]!,
            p1: p,
            provenance: 'human',
          };
          this._image?.cars.push(car);
          this._ghost = null;
          this._sel = { kind: 'car', id: car.id, label: 'car' };
          this._changed();
        }
        return;
      }
      case 'sensor': {
        const s = {
          id: protoId('s'),
          x: p.x,
          y: p.y,
          name: `B${this.scene.sensors.length + 1}`,
        };
        this.scene.sensors.push(s);
        this._sel = { kind: 'sensor', id: s.id, label: 'sensor' };
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
    }
  }

  private _grabHandle(p: Point, tol: number): boolean {
    const car = this._selectedCar;
    if (car) {
      if (Math.hypot(p.x - car.p0.x, p.y - car.p0.y) < tol * 1.6) {
        this._dragging = { kind: 'p0', id: car.id };
        return true;
      }
      if (Math.hypot(p.x - car.p1.x, p.y - car.p1.y) < tol * 1.6) {
        this._dragging = { kind: 'p1', id: car.id };
        return true;
      }
    }
    const cal = this.scene.calibration;
    if (cal && this._tool === 'calibrate') {
      if (Math.hypot(p.x - cal.p0.x, p.y - cal.p0.y) < tol * 2) {
        this._dragging = { kind: 'cal0', id: 'cal' };
        return true;
      }
      if (Math.hypot(p.x - cal.p1.x, p.y - cal.p1.y) < tol * 2) {
        this._dragging = { kind: 'cal1', id: 'cal' };
        return true;
      }
    }
    if (this._sel?.kind === 'sensor') {
      const s = this.scene.sensors.find((x) => x.id === this._sel!.id);
      if (s && Math.hypot(p.x - s.x, p.y - s.y) < tol * 1.6) {
        this._dragging = { kind: 'sensor', id: s.id };
        return true;
      }
    }
    return false;
  }

  private _drag(p: Point) {
    const d = this._dragging!;
    if (d.kind === 'p0' || d.kind === 'p1') {
      const car = this._image?.cars.find((c) => c.id === d.id);
      if (car) {
        car[d.kind] = p;
        // Editing a proposal makes it a correction (decision 12).
        if (car.provenance === 'proposed') car.provenance = 'corrected';
      }
    } else if (d.kind === 'cal0' && this.scene.calibration) {
      this.scene.calibration.p0 = p;
    } else if (d.kind === 'cal1' && this.scene.calibration) {
      this.scene.calibration.p1 = p;
    } else if (d.kind === 'sensor') {
      const s = this.scene.sensors.find((x) => x.id === d.id);
      if (s) {
        s.x = p.x;
        s.y = p.y;
      }
    }
    this._changed();
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

  // -- cascading class picker ----------------------------------------------

  @state() private _crumb: string[] = ['stock'];

  private _crumbClass(): string {
    return this._crumb.join('.');
  }

  /** Children of the current prefix, derived from the flat dotted list. */
  private _childrenOf(prefix: string[]): string[] {
    const p = prefix.join('.');
    const out = new Set<string>();
    for (const c of CAR_CLASSES) {
      if (!c.startsWith(p + '.')) continue;
      const rest = c.slice(p.length + 1).split('.');
      out.add(rest[0]!);
    }
    return [...out];
  }

  private _renderClassPicker() {
    const levels: Array<{ prefix: string[]; options: string[] }> = [];
    for (let i = 0; i <= this._crumb.length; i++) {
      const prefix = this._crumb.slice(0, i);
      if (prefix.length === 0) continue;
      const options = this._childrenOf(prefix);
      if (options.length) levels.push({ prefix, options });
    }
    return html`
      <div class="crumb">${this._crumbClass()}</div>
      ${levels.map(
        (lvl) => html`
          <div class="chips">
            ${lvl.options.map(
              (o) => html`
                <button
                  data-on=${this._crumb[lvl.prefix.length] === o ? '1' : '0'}
                  @click=${() => {
                    const next = [...lvl.prefix];
                    if (this._crumb[lvl.prefix.length] !== o) next.push(o);
                    this._crumb = next;
                    const car = this._selectedCar;
                    if (car) {
                      car.cls = this._crumbClass();
                      this._changed();
                    }
                  }}
                >
                  ${o}
                </button>
              `,
            )}
          </div>
        `,
      )}
    `;
  }

  // -- render --------------------------------------------------------------

  render() {
    const img = this._image;
    const tools: Tool[] = ['select', 'calibrate', 'track', 'car', 'sensor'];
    const missing = this._missing();

    return html`
      <div class="main">
        <div class="tools">
          ${tools.map(
            (t) => html`
              <button
                data-active=${this._tool === t ? '1' : '0'}
                @click=${() => {
                  this._tool = t;
                  this._ghost = null;
                }}
              >
                ${TOOL_LABEL[t]}
              </button>
            `,
          )}
          <span class="note">
            No delete tool — select an object, then Delete
          </span>
        </div>

        <div class="canvas-wrap">
          <rr-proto-canvas
            .scene=${this.scene}
            .image=${img}
            .widths=${this._widths}
            .hover=${this._hover}
            .selection=${this._sel}
            .ghost=${this._ghost}
            .tint=${null}
            .cursor=${this._tool === 'select' ? 'default' : 'crosshair'}
            .showCalibration=${this._tool === 'calibrate'}
            .showProvenance=${true}
            @proto-pointer=${this._onPointer}
            @proto-scale=${(e: CustomEvent) => (this._k = e.detail.k)}
          ></rr-proto-canvas>
        </div>
      </div>

      <div class="inspector">
        <h4>Selection</h4>
        ${this._sel
          ? html`
              <div class="card">
                <div><strong>${this._sel.label}</strong></div>
                ${this._sel.kind === 'car'
                  ? html`
                      <div style="margin:8px 0 4px; color:#7c838e">Class</div>
                      ${this._renderClassPicker()}
                      <div style="margin:6px 0; color:#7c838e">
                        Provenance: ${this._selectedCar?.provenance}
                      </div>
                      <div style="margin-bottom:8px; color:#7c838e">
                        Drag either endpoint to adjust.
                      </div>
                    `
                  : nothing}
                ${this._sel.kind === 'track'
                  ? html`<div style="margin:8px 0; color:#ffcc80">
                      Layout-wide — deleting this removes it from
                      <strong>all ${this.scene.images.length} images</strong>.
                    </div>`
                  : nothing}
                ${this._sel.kind === 'sensor'
                  ? html`<div style="margin:8px 0; color:#7c838e">
                      Layout-wide query point. Never trained on.
                    </div>`
                  : nothing}
                <button class="del" @click=${this._deleteSelected}>
                  Delete this ${this._sel.kind}
                </button>
              </div>
            `
          : html`<div class="card empty">
              Nothing selected. Click an object to inspect, edit or delete it.
            </div>`}
        ${this._sel?.kind !== 'car'
          ? html`
              <h4>New car class</h4>
              <div class="card">${this._renderClassPicker()}</div>
            `
          : nothing}

        <h4>Training gate</h4>
        <div class="card gate ${missing.length === 0 ? 'ok' : ''}">
          ${missing.length === 0
            ? html`<div>
                ✓ Image ${this.imageIndex + 1} is complete —
                ${img?.cars.length} cars will be exported.
              </div>`
            : html`
                <div>
                  ⚠ Image ${this.imageIndex + 1} is
                  <strong>excluded from detector training</strong>.
                </div>
                <ul>
                  ${missing.map((m) => html`<li>${m}</li>`)}
                </ul>
              `}
          <label style="display:flex; gap:6px; margin-top:8px; cursor:pointer">
            <input
              type="checkbox"
              .checked=${img?.complete ?? false}
              @change=${(e: Event) => {
                if (img) img.complete = (e.target as HTMLInputElement).checked;
                this._changed();
              }}
            />
            Every car in this image is labeled
          </label>
        </div>
      </div>
    `;
  }

  private _missing(): string[] {
    const img = this._image;
    const out: string[] = [];
    if (this._widths.dpt === null) out.push('Layout is not calibrated');
    if ((img?.cars.length ?? 0) === 0) out.push('No cars labeled yet');
    if (!img?.complete) out.push('Not marked complete');
    return out;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-proto-variant-b': RrProtoVariantB;
  }
}
