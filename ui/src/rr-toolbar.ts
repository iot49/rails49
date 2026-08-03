import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { COMPACT_MAX_HEIGHT_PX, compactStripStyles } from './layout.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';

/**
 * Tool palette for the editor: file actions and undo/redo.
 *
 * A column at the side of the editor, and a row in the strip along its top
 * below `COMPACT_MAX_HEIGHT_PX` — see `layout.ts` for why the two elements in
 * that strip must turn together.
 *
 * The v3 labeling tools — the four marker-type
 * modes, delete, and the two-point calibrate mode — were removed with the v4
 * reduction (#19): v4 has no point markers, and its calibration is a list of
 * world-coordinate points rather than a draggable pair. The car, sensor and
 * calibration-point tools that replace them belong to the editor spec.
 *
 * The undo buttons are not a duplicate of the keyboard shortcuts in `rr-app`.
 * Their disabled state is the only honest signal that the stack has a bottom —
 * otherwise "nothing happened" is indistinguishable from an edit applied to an
 * image the user is not looking at — and touch devices have no Cmd+Z at all.
 *
 * @fires rr-file-new - When the new file button is clicked.
 * @fires rr-file-open - When the open file button is clicked.
 * @fires rr-file-save - When the save file button is clicked.
 * @fires rr-undo - When the undo button is clicked.
 * @fires rr-redo - When the redo button is clicked.
 */
@customElement('rr-toolbar')
export class RRToolbar extends LitElement {
  @property({ type: Boolean }) canUndo = false;
  @property({ type: Boolean }) canRedo = false;
  /** Phrase for the tooltip: "Undo delete image". Null when nothing to undo. */
  @property({ attribute: false }) undoLabel: string | null = null;
  @property({ attribute: false }) redoLabel: string | null = null;

  static styles = [
    css`
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
      /* Height is the content's, not the column's: the tool palette sits below
         this in the same sidebar, and a toolbar demanding 100% would push it
         out of the view entirely. The sidebar carries the background. */
      flex-shrink: 0;
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

    sl-icon-button[disabled] {
      opacity: 0.35;
      cursor: default;
    }

    sl-icon-button[disabled]:hover {
      transform: none;
    }

    sl-icon-button::part(base) {
      color: white;
    }

    sl-icon-button::part(base):hover {
      color: var(--sl-color-neutral-100);
    }

  `,

    // The turn itself, shared with rr-tool-palette. After the rules above,
    // which is what lets it override them.
    compactStripStyles,

    css`
      @media (max-height: ${COMPACT_MAX_HEIGHT_PX}px) {
        :host {
          /* A shadow off this element's right edge would land inside the
             strip, drawn down its middle. The sidebar casts the strip's one
             edge instead. */
          box-shadow: none;
        }
      }
    `,
  ];

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

  private _onUndo() {
    this.dispatchEvent(new CustomEvent('rr-undo', {
      bubbles: true,
      composed: true
    }));
  }

  private _onRedo() {
    this.dispatchEvent(new CustomEvent('rr-redo', {
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

      <div class="tool-group">
        <sl-tooltip content=${this.undoLabel ? `Undo ${this.undoLabel}` : 'Nothing to undo'}>
          <sl-icon-button
            id="edit-undo"
            name="arrow-counterclockwise"
            ?disabled=${!this.canUndo}
            @click=${this._onUndo}
          ></sl-icon-button>
        </sl-tooltip>

        <sl-tooltip content=${this.redoLabel ? `Redo ${this.redoLabel}` : 'Nothing to redo'}>
          <sl-icon-button
            id="edit-redo"
            name="arrow-clockwise"
            ?disabled=${!this.canRedo}
            @click=${this._onRedo}
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
