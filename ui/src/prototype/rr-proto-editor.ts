// PROTOTYPE — throwaway. Wayfinder ticket #5.
//
// Host for the three labeling-mode variants. Everything above the variant is
// real: the real archive loaded through the real file picker, the real image
// list, the real calibration, real DPT. Only the v4 geometry is invented, and
// it is invented in memory only — nothing is written back.
//
// Three variants of labeling mode, switchable via ?variant=, mounted inside the
// existing editor route.

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { R49Archive } from '@occupancy/r49';
import type { ManifestData } from '@occupancy/r49';
import '../rr-thumbnail-bar.js';
import './rr-proto-variant-a.js';
import './rr-proto-variant-b.js';
import './rr-proto-variant-c.js';
import './rr-proto-switcher.js';
import {
  droppedLabelCount,
  protoId,
  sceneFromManifest,
  widthsFor,
} from './proto-scene.js';
import type { Scene } from './proto-scene.js';

const VARIANTS = ['A', 'B', 'C'] as const;
type Variant = (typeof VARIANTS)[number];

const VARIANT_NAME: Record<Variant, string> = {
  A: 'Sticky + Loud',
  B: 'No delete mode',
  C: 'Spring-loaded',
};

@customElement('rr-proto-editor')
export class RrProtoEditor extends LitElement {
  @property({ attribute: false }) archive: R49Archive | null = null;

  @state() private _variant: Variant = 'A';
  @state() private _scene: Scene | null = null;
  @state() private _index = 0;
  @state() private _dropped = 0;
  @state() private _dismissed = false;

  private _urls = new Map<string, string>();

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
      overflow: hidden;
    }
    .notice {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.45rem 0.75rem;
      background: #4a2f00;
      color: #ffcc80;
      font: 500 0.78rem system-ui, sans-serif;
      flex-shrink: 0;
    }
    .notice button {
      margin-left: auto;
      background: transparent;
      border: 1px solid #7a5a20;
      color: #ffcc80;
      border-radius: 4px;
      padding: 2px 8px;
      cursor: pointer;
      font: inherit;
    }
    .stage {
      flex: 1;
      display: flex;
      min-height: 0;
    }
    rr-thumbnail-bar {
      flex-shrink: 0;
    }
    .empty {
      padding: 2rem;
      color: #888;
      font: 400 0.9rem system-ui, sans-serif;
    }
    .empty code {
      color: #cfd3da;
    }
    .seed {
      background: #23262d;
      border: 1px solid #3a3f48;
      color: #cfd3da;
      border-radius: 4px;
      padding: 2px 8px;
      cursor: pointer;
      font: 500 0.75rem system-ui, sans-serif;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    const v = new URL(window.location.href).searchParams.get('variant');
    if (v && (VARIANTS as readonly string[]).includes(v)) {
      this._variant = v as Variant;
    }
  }

  async updated(changed: Map<string, unknown>) {
    if (changed.has('archive') && this.archive) {
      await this._import();
    }
  }

  private async _import() {
    if (!this.archive) return;
    const manifest = this.archive.getManifest();

    this._urls.forEach((u) => URL.revokeObjectURL(u));
    this._urls.clear();
    for (const img of manifest.images) {
      const data = await this.archive.getImage(img.filename);
      if (data) {
        this._urls.set(
          img.filename,
          URL.createObjectURL(new Blob([data as BlobPart], { type: 'image/jpeg' })),
        );
      }
    }

    this._dropped = droppedLabelCount(manifest);
    this._dismissed = false;
    this._scene = sceneFromManifest(manifest, this._urls);
    this._index = 0;
  }

  private get _manifest(): ManifestData | null {
    try {
      return this.archive?.getManifest() ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Fake model proposals, so the provenance badges and the accept/correct
   * distinction can be judged without a detector existing. Lays spans along
   * the first track spline; if there is no track yet, across the middle.
   */
  private _seedProposals() {
    const scene = this._scene;
    const manifest = this._manifest;
    if (!scene || !manifest) return;
    const img = scene.images[this._index];
    if (!img) return;

    const w = widthsFor(manifest);
    const len = (w.dpt ?? 30) * 12;
    const spline = scene.track[0];

    for (let i = 0; i < 8; i++) {
      if (spline && spline.points.length >= 2) {
        const t = (i + 0.5) / 8;
        const seg = Math.min(
          Math.floor(t * (spline.points.length - 1)),
          spline.points.length - 2,
        );
        const a = spline.points[seg]!;
        const b = spline.points[seg + 1]!;
        const f = t * (spline.points.length - 1) - seg;
        const cx = a.x + (b.x - a.x) * f;
        const cy = a.y + (b.y - a.y) * f;
        const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const ux = ((b.x - a.x) / d) * (len / 2);
        const uy = ((b.y - a.y) / d) * (len / 2);
        img.cars.push({
          id: protoId('car'),
          cls: 'stock',
          p0: { x: cx - ux, y: cy - uy },
          p1: { x: cx + ux, y: cy + uy },
          provenance: 'proposed',
        });
      } else {
        const y = scene.resolution.height * (0.3 + 0.05 * i);
        const x = scene.resolution.width * 0.25;
        img.cars.push({
          id: protoId('car'),
          cls: 'stock',
          p0: { x, y },
          p1: { x: x + len, y: y + len * 0.15 },
          provenance: 'proposed',
        });
      }
    }
    this.requestUpdate();
  }

  private _setVariant(v: Variant) {
    this._variant = v;
  }

  /**
   * The real file picker lives in rr-toolbar, which this prototype replaces, so
   * ?proto had no way to open an archive at all. rr-app already listens for
   * rr-file-open; this just gives it a button to hear.
   */
  private _openArchive() {
    this.dispatchEvent(
      new CustomEvent('rr-file-open', { bubbles: true, composed: true }),
    );
  }

  render() {
    const manifest = this._manifest;
    const scene = this._scene;

    return html`
      ${!this.archive || !scene || !manifest
        ? html`<div class="empty">
            <p>
              No archive loaded. Try <code>dataset/r49/cars 0-10.r49</code>, the
              archive whose partial track labeling this ticket exists to prevent.
            </p>
            <button class="seed" @click=${this._openArchive}>
              Open .r49 archive…
            </button>
          </div>`
        : html`
            ${this._dropped > 0 && !this._dismissed
              ? html`<div class="notice">
                  <span>
                    v3 → v4 import: carried <strong>${scene.images.length}</strong>
                    images and ${scene.calibration ? 'calibration' : 'no calibration'}
                    forward, <strong>dropped ${this._dropped} v3 point labels</strong>.
                    A point carries neither extent nor orientation, so it cannot be
                    converted — relabel by hand.
                  </span>
                  <button @click=${this._seedProposals}>
                    Seed 8 model proposals
                  </button>
                  <button @click=${() => (this._dismissed = true)}>
                    Dismiss
                  </button>
                </div>`
              : nothing}

            <div class="stage">
              ${this._variant === 'A'
                ? html`<rr-proto-variant-a
                    .scene=${scene}
                    .manifest=${manifest}
                    .imageIndex=${this._index}
                    @proto-change=${() => this.requestUpdate()}
                  ></rr-proto-variant-a>`
                : this._variant === 'B'
                  ? html`<rr-proto-variant-b
                      .scene=${scene}
                      .manifest=${manifest}
                      .imageIndex=${this._index}
                      @proto-change=${() => this.requestUpdate()}
                    ></rr-proto-variant-b>`
                  : html`<rr-proto-variant-c
                      .scene=${scene}
                      .manifest=${manifest}
                      .imageIndex=${this._index}
                      @proto-change=${() => this.requestUpdate()}
                    ></rr-proto-variant-c>`}
            </div>

            <rr-thumbnail-bar
              .images=${scene.images.map((i) => i.url)}
              .selectedIndex=${this._index}
              @rr-image-select=${(e: CustomEvent) =>
                (this._index = e.detail.index)}
            ></rr-thumbnail-bar>
          `}

      <rr-proto-switcher
        .variants=${[...VARIANTS]}
        .current=${this._variant}
        .name=${VARIANT_NAME[this._variant]}
        @proto-variant=${(e: CustomEvent) => this._setVariant(e.detail.variant)}
      ></rr-proto-switcher>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-proto-editor': RrProtoEditor;
  }
}
