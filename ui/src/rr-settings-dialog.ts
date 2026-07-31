import { LitElement, html, css } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { VALID_SCALES } from '@occupancy/r49';
import type { Layout } from '@occupancy/r49';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/tab-group/tab-group.js';
import '@shoelace-style/shoelace/dist/components/tab/tab.js';
import '@shoelace-style/shoelace/dist/components/tab-panel/tab-panel.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/spinner/spinner.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import type { SlDialog, SlInput, SlSelect } from '@shoelace-style/shoelace';

/** The subset of `Layout` this dialog edits — the archive's other layout fields never pass through here. */
type LayoutFields = Pick<Layout, 'name' | 'scale' | 'description' | 'contact'>;

/**
 * Dialog for editing layout metadata.
 *
 * The "Ref Size (mm)" input was removed with the v4 reduction (#19): v4's
 * calibration is a list of points each carrying its own world coordinate, so
 * the single `size_mm` distance it wrote no longer exists. Calibration
 * authoring returns with the editor spec.
 *
 * @fires rr-layout-change - When a layout field (name, scale, description, contact) changes. Detail: { layout: Partial<Layout> }
 */
@customElement('rr-settings-dialog')
export class RRSettingsDialog extends LitElement {
  @property({ type: Object }) layout: LayoutFields = { scale: 'N' };

  @query('sl-dialog') private _dialog!: SlDialog;

  static styles = css`
    .settings-grid {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 1rem;
      align-items: center;
      padding: 1rem 0;
    }

    .label {
      text-align: right;
      font-weight: 500;
      color: var(--sl-color-neutral-600);
    }

    sl-tab-panel {
      padding: 1rem 0;
    }

    .model-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 1rem;
    }

    .model-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.75rem;
      border: 1px solid var(--sl-color-neutral-200);
      border-radius: var(--sl-border-radius-medium);
    }

    .model-info {
      display: flex;
      flex-direction: column;
    }

    .model-name {
      font-weight: 600;
    }

    .model-path {
      font-size: 0.8rem;
      color: var(--sl-color-neutral-500);
    }
  `;

  public show() {
    this._dialog.show();
  }

  public hide() {
    this._dialog.hide();
  }

  /**
   * Text fields commit on `sl-change` (blur or Enter), not `sl-input`.
   *
   * Per keystroke, each character would become its own undo entry, so Cmd+Z
   * would chew backwards through a name one letter at a time while the user is
   * trying to reverse an edit from minutes ago. One entry per editing session
   * is the unit the user perceives.
   */
  private _onLayoutChange<K extends keyof LayoutFields>(field: K, value: LayoutFields[K]) {
    this.dispatchEvent(new CustomEvent('rr-layout-change', {
      detail: { layout: { [field]: value } },
      bubbles: true,
      composed: true
    }));
  }

  render() {
    return html`
      <sl-dialog label="Settings" style="--width: 500px;">
        <sl-tab-group>
          <sl-tab slot="nav" panel="layout">Layout</sl-tab>

          <sl-tab-panel name="layout">
            <div class="settings-grid">
              <div class="label">Name</div>
              <sl-input
                value=${this.layout?.name || ''}
                @sl-change=${(e: Event) => this._onLayoutChange('name', (e.target as SlInput).value)}
              ></sl-input>

              <div class="label">Scale</div>
              <sl-select 
                value=${this.layout?.scale || 'N'} 
                @sl-change=${(e: Event) => {
                  const value = (e.target as SlSelect).value;
                  const scale = VALID_SCALES.find((s) => s === value);
                  if (scale !== undefined) this._onLayoutChange('scale', scale);
                }}
              >
                ${VALID_SCALES.map(s => html`
                  <sl-option value=${s}>${s}</sl-option>
                `)}
              </sl-select>

              <div class="label">Description</div>
              <sl-input
                id="layout-description"
                value=${this.layout?.description || ''}
                @sl-change=${(e: Event) => this._onLayoutChange('description', (e.target as SlInput).value)}
              ></sl-input>

              <div class="label">Contact</div>
              <sl-input
                id="layout-contact"
                value=${this.layout?.contact || ''}
                @sl-change=${(e: Event) => this._onLayoutChange('contact', (e.target as SlInput).value)}
              ></sl-input>
            </div>
          </sl-tab-panel>
        </sl-tab-group>
        
        <sl-button slot="footer" variant="primary" @click=${() => this.hide()}>Close</sl-button>
      </sl-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-settings-dialog': RRSettingsDialog;
  }
}
