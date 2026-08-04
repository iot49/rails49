import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * Overlay for live detection statistics: frame rate, what the model found, what
 * the sensors made of it, and what one inference cost.
 *
 * The four numbers are the two layers plus their price. `cars` is L0 and
 * `occupied` is L1, and showing both is what makes a disagreement visible — a
 * frame with cars and no occupied sensor is either an empty siding or a
 * mis-placed sensor, and the pair is the only readout that distinguishes them.
 *
 * `inference` is the **detect call**, not the frame: L1 is pure geometry and
 * costs nothing measurable, so a whole-frame number would attribute the render
 * to the model. It is the number that moves when the device changes, which is
 * the whole reason to watch it (see the map's hardware note).
 */
@customElement('rr-stats-bar')
export class RRStatsBar extends LitElement {
  @property({ type: Number }) fps = 0;
  /** L0: detections above the confidence threshold in the frame on screen. */
  @property({ type: Number }) cars = 0;
  /** L1: how many sensors read `occupied`. */
  @property({ type: Number }) occupied = 0;
  /** Milliseconds in `detect` — preprocessing, the session, the decode. */
  @property({ type: Number }) inference = 0;

  static styles = css`
    :host {
      display: block;
      position: absolute;
      top: 1rem;
      right: 1rem;
      background: rgba(0, 0, 0, 0.7);
      color: #0f0;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      font-family: monospace;
      font-size: 0.9rem;
      pointer-events: none;
      z-index: 1000;
      border: 1px solid rgba(0, 255, 0, 0.3);
      backdrop-filter: blur(4px);
    }

    .stat {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
    }

    .label {
      color: #aaa;
    }
  `;

  render() {
    return html`
      <div class="stat">
        <span class="label">FPS:</span>
        <span>${this.fps.toFixed(1)}</span>
      </div>
      <div class="stat">
        <span class="label">Cars:</span>
        <span>${this.cars}</span>
      </div>
      <div class="stat">
        <span class="label">Occupied:</span>
        <span>${this.occupied}</span>
      </div>
      <div class="stat">
        <span class="label">Inference:</span>
        <span>${this.inference.toFixed(1)}ms</span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-stats-bar': RRStatsBar;
  }
}
