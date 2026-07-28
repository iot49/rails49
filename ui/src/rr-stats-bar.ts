import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * Overlay for live classification statistics.
 */
@customElement('rr-stats-bar')
export class RRStatsBar extends LitElement {
  @property({ type: Number }) fps = 0;
  @property({ type: Number }) count = 0;
  @property({ type: Number }) latency = 0;
  @property({ type: Number }) sampleTime = 0;

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
        <span class="label">Markers:</span>
        <span>${this.count}</span>
      </div>
      <div class="stat">
        <span class="label">Time per Marker:</span>
        <span>${this.sampleTime.toFixed(1)}ms</span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-stats-bar': RRStatsBar;
  }
}
