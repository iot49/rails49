import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * Vertical tool palette for the editor.
 * 
 * @fires rr-tool-select - When a tool button is clicked. Detail: { tool: string }
 * @fires rr-file-new - When the new file button is clicked.
 * @fires rr-file-open - When the open file button is clicked.
 * @fires rr-file-save - When the save file button is clicked.
 */
@customElement('rr-toolbar')
export class RRToolbar extends LitElement {
  @property({ type: String }) activeTool: string | null = null;
  @property({ type: Boolean }) disabled = false;

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

    sl-icon-button.active {
      background-color: var(--sl-color-success-600);
      border-radius: var(--sl-border-radius-medium);
      box-shadow: 0 0 0 2px var(--sl-color-warning-400);
    }

    sl-icon-button::part(base) {
      color: white;
    }

    sl-icon-button::part(base):hover {
      color: var(--sl-color-neutral-100);
    }

    sl-icon-button[disabled] {
      opacity: 0.3;
      cursor: not-allowed;
    }
  `;

  private _onToolClick(tool: string) {
    if (this.disabled) return;
    this.dispatchEvent(new CustomEvent('rr-tool-select', {
      detail: { tool },
      bubbles: true,
      composed: true
    }));
  }

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

      <div class="tool-group" role="radiogroup" aria-label="Labeling Tools">
        <sl-tooltip content="Label as Track">
          <sl-icon-button 
            id="tool-track"
            name="sign-railroad"
            class=${this.activeTool === 'track' ? 'active' : ''}
            ?disabled=${this.disabled}
            @click=${() => this._onToolClick('track')}
            aria-checked=${this.activeTool === 'track'}
            role="radio"
          ></sl-icon-button>
        </sl-tooltip>

        <sl-tooltip content="Label as Train Car">
          <sl-icon-button 
            id="tool-train"
            name="truck-front"
            class=${this.activeTool === 'train' ? 'active' : ''}
            ?disabled=${this.disabled}
            @click=${() => this._onToolClick('train')}
            aria-checked=${this.activeTool === 'train'}
            role="radio"
          ></sl-icon-button>
        </sl-tooltip>

        <sl-tooltip content="Label as Train Coupling">
          <sl-icon-button 
            id="tool-coupling"
            name="arrows-collapse-vertical"
            class=${this.activeTool === 'coupling' ? 'active' : ''}
            ?disabled=${this.disabled}
            @click=${() => this._onToolClick('coupling')}
            aria-checked=${this.activeTool === 'coupling'}
            role="radio"
          ></sl-icon-button>
        </sl-tooltip>

        <sl-tooltip content="Label as Other">
          <sl-icon-button 
            id="tool-other"
            name="question-circle"
            class=${this.activeTool === 'other' ? 'active' : ''}
            ?disabled=${this.disabled}
            @click=${() => this._onToolClick('other')}
            aria-checked=${this.activeTool === 'other'}
            role="radio"
          ></sl-icon-button>
        </sl-tooltip>
      </div>

      <div class="tool-group">
        <sl-tooltip content="Delete Label">
          <sl-icon-button 
            id="tool-delete"
            name="trash3"
            class=${this.activeTool === 'delete' ? 'active' : ''}
            ?disabled=${this.disabled}
            @click=${() => this._onToolClick('delete')}
            aria-checked=${this.activeTool === 'delete'}
            role="radio"
          ></sl-icon-button>
        </sl-tooltip>
      </div>

      <div class="tool-group">
        <sl-tooltip content="Calibrate Size">
          <sl-icon-button 
            id="tool-calibrate"
            name="rulers"
            class=${this.activeTool === 'calibrate' ? 'active' : ''}
            ?disabled=${this.disabled}
            @click=${() => this._onToolClick('calibrate')}
            aria-checked=${this.activeTool === 'calibrate'}
            role="radio"
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
