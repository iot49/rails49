import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

/**
 * Vertical tool palette for the editor.
 *
 * Currently file actions only. The v3 labeling tools — the four marker-type
 * modes, delete, and the two-point calibrate mode — were removed with the v4
 * reduction (#19): v4 has no point markers, and its calibration is a list of
 * world-coordinate points rather than a draggable pair. The car, sensor and
 * calibration-point tools that replace them belong to the editor spec.
 *
 * @fires rr-file-new - When the new file button is clicked.
 * @fires rr-file-open - When the open file button is clicked.
 * @fires rr-file-save - When the save file button is clicked.
 */
@customElement('rr-toolbar')
export class RRToolbar extends LitElement {

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: 1.5em;
      padding: 1.5em 0.5em;
      background-color: #064e3b; /* Explicit dark green */
      width: 100px;
      user-select: none;
      box-shadow: 2px 0 8px rgba(0, 0, 0, 0.3);
      align-items: center;
      box-sizing: border-box;
      height: 100%;
    }

    .tool-group {
      display: flex;
      flex-direction: column;
      gap: 1.25em;
      padding: 0.8em 0;
      background-color: #059669; /* Explicit medium green */
      border-radius: 12px;
      width: calc(100% - 16px);
      align-items: center;
    }

    sl-icon-button {
      font-size: 2.25em;
      color: white;
      cursor: pointer;
      transition: transform 0.1s;
    }

    sl-icon-button:hover {
      transform: scale(1.1);
    }

    sl-icon-button::part(base) {
      color: white;
    }

    sl-icon-button::part(base):hover {
      color: var(--sl-color-neutral-100);
    }

  `;

  private _onFileNew() {
    this.dispatchEvent(new CustomEvent('rr-file-new', {
      bubbles: true,
      composed: true
    }));
  }

  private _onFileOpen() {
    this.dispatchEvent(new CustomEvent('rr-file-open', {
      bubbles: true,
      composed: true
    }));
  }

  private _onFileSave() {
    this.dispatchEvent(new CustomEvent('rr-file-save', {
      bubbles: true,
      composed: true
    }));
  }

  render() {
    return html`
      <div class="tool-group">
        <sl-tooltip content="New .r49 Archive">
          <sl-icon-button 
            id="file-new"
            name="file-earmark-plus"
            @click=${this._onFileNew}
          ></sl-icon-button>
        </sl-tooltip>

        <sl-tooltip content="Open .r49 Archive">
          <sl-icon-button 
            id="file-open"
            name="folder2-open"
            @click=${this._onFileOpen}
          ></sl-icon-button>
        </sl-tooltip>

        <sl-tooltip content="Save .r49 Archive">
          <sl-icon-button 
            id="file-save"
            name="floppy"
            @click=${this._onFileSave}
          ></sl-icon-button>
        </sl-tooltip>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-toolbar': RRToolbar;
  }
}
