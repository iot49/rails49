import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Frame } from '@occupancy/detector';
import { KIND_COLOR, KIND_LABEL, LABEL_INK, describeFinding, findingBounds } from './diagnostics.js';
import { isInsideOpenDialog, isTypingTarget } from './keyboard.js';
import type { Finding, ImageDiagnostics } from './diagnostics.js';
import './rr-viewer.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

/**
 * One image's disagreements, one at a time (#87).
 *
 * The **judging** half of the diagnostics mode, reached from a report row. The
 * report says how the archive is doing; this says what is wrong with this
 * picture, and it shows exactly one finding at a time on purpose — a surface
 * that drew all of them would be the report again, and the question here is
 * whether *this* box is wrong, which needs the photograph legible around it.
 *
 * Agreed findings are not in the queue. There is nothing to judge about a box
 * that matched, and putting them in would bury four disagreements among forty.
 *
 * **Properties:** `image`, `imageUrl`, `dpt`, `resolution`.
 *
 * @fires rr-diagnostics-close - Back to the report. No detail.
 */
@customElement('rr-diagnostics-queue')
export class RRDiagnosticsQueue extends LitElement {
  @property({ attribute: false }) image: ImageDiagnostics | null = null;
  @property({ attribute: false }) imageUrl: string | null = null;
  @property({ attribute: false }) dpt: number | null = null;
  @property({ attribute: false }) resolution: Frame = { width: 1920, height: 1080 };

  @state() private _cursor = 0;
  @state() private _zoomed = true;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: #000;
      color: #eee;
      font: 14px/1.45 var(--sl-font-sans, system-ui), sans-serif;
    }

    header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.4rem 0.75rem;
      background: #111;
      border-bottom: 1px solid #2a2a2a;
      flex-shrink: 0;
    }

    header .file {
      font-weight: 600;
    }

    header .flag {
      color: #ffcc80;
      font-size: 0.8rem;
    }

    .stage {
      flex-grow: 1;
      min-height: 0;
      position: relative;
    }

    rr-viewer {
      width: 100%;
      height: 100%;
    }

    /* Over the photograph rather than beside it: the point of this surface is
       that one thing is in front of you, and a side panel invites scanning. */
    .card {
      position: absolute;
      left: 50%;
      bottom: 1rem;
      transform: translateX(-50%);
      width: min(38rem, calc(100% - 2rem));
      background: rgba(18, 18, 18, 0.94);
      border: 1px solid #333;
      border-left: 5px solid var(--kind, #888);
      border-radius: 8px;
      padding: 0.7rem 1rem;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7);
    }

    .card h2 {
      margin: 0 0 0.1rem;
      font-size: 1.05rem;
      color: var(--kind, #eee);
    }

    .card p {
      margin: 0 0 0.35rem;
      color: #bbb;
    }

    .meta {
      font-size: 0.75rem;
      color: #777;
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.5rem 0.75rem;
      background: #111;
      border-top: 1px solid #2a2a2a;
      flex-shrink: 0;
    }

    .counter {
      color: #999;
      font-size: 0.8rem;
    }

    .counter b {
      color: #eee;
    }

    .empty {
      margin: auto;
      color: #888;
      text-align: center;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this._onKeyDown);
    super.disconnectedCallback();
  }

  /**
   * Which image the cursor belongs to, by **filename**.
   *
   * Not object identity. `rr-diagnostics-view` scores on every render rather
   * than caching, so `image` is a fresh `ImageDiagnostics` each time and
   * `changed.has('image')` is true on every parent update — including the one
   * per completed image during a sweep. Resetting on that put the cursor back
   * to the first finding roughly twice a second while the sweep ran, which made
   * the queue unusable exactly when someone reviews early.
   */
  private _cursorImage: string | null = null;

  protected willUpdate(_changed: Map<string, unknown>) {
    const filename = this.image?.filename ?? null;
    if (filename !== this._cursorImage) {
      this._cursorImage = filename;
      this._cursor = 0;
    }
    // A re-score at a new threshold can still shorten the queue under a cursor
    // that stays put, so clamp separately. Here rather than in render, so the
    // counter and the card always read the same finding.
    const count = this._queue.length;
    if (count > 0 && this._cursor >= count) this._cursor = count - 1;
  }

  /**
   * Arrow keys, with `j`/`k` alongside them.
   *
   * The arrows are what the buttons name and what a tooltip can teach; the vim
   * pair is muscle memory for anyone who has it. Escape leaves, because this is
   * a drill-down and every drill-down owes the user a way back that is not a
   * button hunt.
   *
   * **Bound to `window`, so it must decline what is not its own.** These are
   * bare keys with no modifier: without the guards, typing "Zurich" into the
   * settings dialog's layout name would swallow the `z` into a zoom toggle, and
   * Escape would close this queue while leaving the dialog the user is actually
   * looking at open.
   */
  private _onKeyDown = (event: KeyboardEvent) => {
    if (isTypingTarget(event) || isInsideOpenDialog(event)) return;
    if (event.key === 'ArrowDown' || event.key === 'j') this._move(1);
    else if (event.key === 'ArrowUp' || event.key === 'k') this._move(-1);
    else if (event.key === 'z') this._zoomed = !this._zoomed;
    else if (event.key === 'Escape') this._close();
    else return;
    event.preventDefault();
  };

  /**
   * Everything worth judging, worst kind first.
   *
   * A missed car is the most serious — a car the system would drive a train
   * into — then a phantom (a stop for nothing), then a duplicate (a false
   * positive that at least found a real car), then a pose that only disagrees
   * about extent.
   */
  private get _queue(): readonly Finding[] {
    const order: Record<string, number> = {
      missed: 0,
      phantom: 1,
      duplicate: 2,
      'pose-off': 3,
      agreed: 4,
    };
    return (this.image?.findings ?? [])
      .filter(finding => finding.kind !== 'agreed')
      .slice()
      .sort((a, b) => order[a.kind] - order[b.kind]);
  }

  private _move(delta: number) {
    const count = this._queue.length;
    if (count === 0) return;
    this._cursor = Math.min(Math.max(this._cursor + delta, 0), count - 1);
  }

  private _close() {
    this.dispatchEvent(
      new CustomEvent('rr-diagnostics-close', { bubbles: true, composed: true })
    );
  }

  render() {
    const image = this.image;
    if (!image) return html`<div class="empty">Nothing to review.</div>`;

    const queue = this._queue;
    const header = html`
      <header>
        <sl-tooltip content="Back to the report (Esc)">
          <sl-icon-button name="arrow-left" label="Back to the report" @click=${this._close}>
          </sl-icon-button>
        </sl-tooltip>
        <span class="file">${image.filename}</span>
        ${image.labeledComplete
          ? ''
          : html`<span class="flag"
              >⚠ not marked labeled complete — a phantom here may be an unlabelled car</span
            >`}
      </header>
    `;

    if (queue.length === 0) {
      return html`${header}
        <div class="empty">
          <p>Every label on this image agreed with the model.</p>
        </div>`;
    }

    const finding = queue[Math.min(this._cursor, queue.length - 1)];
    const colour = KIND_COLOR[finding.kind];

    return html`
      ${header}
      <div class="stage">
        <rr-viewer
          .src=${this.imageUrl}
          .cars=${finding.label ? [finding.label] : []}
          .carInks=${[finding.kind === 'missed' ? KIND_COLOR.missed : LABEL_INK]}
          .detections=${finding.detection ? [finding.detection] : []}
          .detectionInks=${[colour]}
          .dpt=${this.dpt}
          .resolution=${this.resolution}
          .zoom=${this._zoomed && this.dpt !== null
            ? findingBounds(finding, this.dpt, this.resolution)
            : null}
        ></rr-viewer>

        <div class="card" style="--kind:${colour}">
          <h2>${KIND_LABEL[finding.kind]}</h2>
          <p>${describeFinding(finding)}</p>
          <div class="meta">
            <span>${image.disagreements} disagreement${image.disagreements === 1 ? '' : 's'} here</span>
            <span><kbd>↓</kbd>/<kbd>↑</kbd> step · <kbd>z</kbd> zoom · <kbd>Esc</kbd> back</span>
          </div>
        </div>
      </div>

      <nav>
        <sl-tooltip content="Previous disagreement — ↑ arrow, or k">
          <sl-button size="small" ?disabled=${this._cursor === 0} @click=${() => this._move(-1)}>
            ↑ Previous
          </sl-button>
        </sl-tooltip>
        <span class="counter">
          <b>${this._cursor + 1}</b> of <b>${queue.length}</b> on this image
        </span>
        <sl-tooltip content="Next disagreement — ↓ arrow, or j">
          <sl-button
            size="small"
            ?disabled=${this._cursor >= queue.length - 1}
            @click=${() => this._move(1)}
          >
            Next ↓
          </sl-button>
        </sl-tooltip>
      </nav>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-diagnostics-queue': RRDiagnosticsQueue;
  }
}
