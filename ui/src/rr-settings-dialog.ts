import { LitElement, html, css } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { Scale2Number } from '@occupancy/r49';
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
import type { SlDialog } from '@shoelace-style/shoelace';

declare const __RAILS_DOMAIN__: string;

function getBaseDomain(): string {
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return __RAILS_DOMAIN__;
  }
  return hostname.replace(/^(ui|throttle|mqtt|rocrail|traefik)\./, '');
}

const DEFAULT_SERVER_URL = `https://ui.${getBaseDomain()}`;

/**
 * Dialog for configuring layout settings and selecting classifiers.
 * 
 * @fires rr-layout-change - When a layout field (name, scale) changes. Detail: { layout: Partial<Layout> }
 * @fires rr-classifier-change - When a classifier model is selected. Detail: { modelUrl: string, configUrl?: string }
 */
@customElement('rr-settings-dialog')
export class RRSettingsDialog extends LitElement {
  @property({ type: Object }) layout: { name?: string; scale: string; calibration?: any } = { scale: 'N' };
  @property({ type: Boolean }) serverConnected = false;
  @property({ type: Boolean }) isSyncing = false;
  
  @state() private _serverUrl = localStorage.getItem('rr-server-url') || DEFAULT_SERVER_URL;

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

  private _onServerUrlChange(url: string) {
    this._serverUrl = url;
    this.dispatchEvent(new CustomEvent('rr-server-url-change', {
      detail: { url },
      bubbles: true,
      composed: true
    }));
  }

  private _onServerSync(action: 'upload' | 'download') {
    this.dispatchEvent(new CustomEvent(`rr-server-${action}`, {
      bubbles: true,
      composed: true
    }));
  }

  private _onLayoutChange(field: string, value: any) {
    this.dispatchEvent(new CustomEvent('rr-layout-change', {
      detail: { layout: { [field]: value } },
      bubbles: true,
      composed: true
    }));
  }

  private _onCalibrationSizeChange(size_mm: number) {
    const cal = this.layout?.calibration || {
      p0: { x: 100, y: 100 },
      p1: { x: 200, y: 100 },
    };
    cal.size_mm = size_mm;
    this._onLayoutChange('calibration', cal);
  }


  render() {
    return html`
      <sl-dialog label="Settings" style="--width: 500px;">
        <sl-tab-group>
          <sl-tab slot="nav" panel="layout">Layout</sl-tab>
          <sl-tab slot="nav" panel="server">Server</sl-tab>

          <sl-tab-panel name="layout">
            <div class="settings-grid">
              <div class="label">Name</div>
              <sl-input 
                value=${this.layout?.name || ''} 
                @sl-input=${(e: any) => this._onLayoutChange('name', e.target.value)}
              ></sl-input>

              <div class="label">Scale</div>
              <sl-select 
                value=${this.layout?.scale || 'N'} 
                @sl-change=${(e: any) => this._onLayoutChange('scale', e.target.value)}
              >
                ${Object.keys(Scale2Number).map(s => html`
                  <sl-option value=${s}>${s} (1:${Scale2Number[s as keyof typeof Scale2Number]})</sl-option>
                `)}
              </sl-select>

              <div class="label">Ref Size (mm)</div>
              <sl-input 
                type="number"
                value=${this.layout?.calibration?.size_mm || ''} 
                @sl-change=${(e: any) => this._onCalibrationSizeChange(Number(e.target.value))}
              ></sl-input>
            </div>
          </sl-tab-panel>

          <sl-tab-panel name="server">
            <div class="settings-grid">
              <div class="label">Server URL</div>
              <sl-input 
                value=${this._serverUrl} 
                @sl-change=${(e: any) => this._onServerUrlChange(e.target.value)}
                placeholder=${DEFAULT_SERVER_URL}
              ></sl-input>

              <!-- Save button (toolbar) uploads to server when connected.
              <div class="label">Actions</div>
              <div style="display: flex; gap: 0.5rem;">
                <sl-button 
                  variant="primary" 
                  size="small" 
                  ?disabled=${!this.serverConnected}
                  ?loading=${this.isSyncing}
                  @click=${() => this._onServerSync('download')}
                >
                  <sl-icon slot="prefix" name="cloud-download"></sl-icon>
                  Download .r49
                </sl-button>
                <sl-button 
                  variant="success" 
                  size="small" 
                  ?disabled=${!this.serverConnected}
                  ?loading=${this.isSyncing}
                  @click=${() => this._onServerSync('upload')}
                >
                  <sl-icon slot="prefix" name="cloud-upload"></sl-icon>
                  Upload .r49
                </sl-button>
              </div>
              -->

              <div class="label">Status</div>
              <div style="color: ${this.serverConnected ? 'var(--sl-color-success-600)' : 'var(--sl-color-danger-600)'}">
                ${this.serverConnected ? 'Connected' : 'Offline'}
              </div>
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
