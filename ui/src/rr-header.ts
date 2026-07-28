import { LitElement, html, css } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import '@shoelace-style/shoelace/dist/components/icon-button/icon-button.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/tooltip/tooltip.js';
import './rr-settings-dialog.js';
import type { RRSettingsDialog } from './rr-settings-dialog.js';

/**
 * Top app bar with title/status, view toggle, and settings gear.
 * 
 * @fires rr-view-toggle - Toggle between editor and live views.
 */
@customElement('rr-header')
export class RRHeader extends LitElement {
  @property({ type: String }) viewMode: 'editor' | 'live' = 'editor';
  @property({ type: Object }) layout: any = null;
  @property({ type: Boolean }) serverConnected = false;
  @property({ type: Boolean }) isSyncing = false;

  @query('rr-settings-dialog') settingsDialog!: RRSettingsDialog;

  static styles = css`
    :host {
      display: block;
      height: 60px;
      background-color: var(--sl-color-primary-600);
      color: white;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      z-index: 100;
    }

    nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 100%;
      padding: 0 1rem;
    }

    .left-section {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .title-status {
      font-size: 1.25rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .right-section {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    sl-icon-button {
      font-size: 1.5rem;
      color: white;
    }

    sl-icon-button::part(base):hover {
      color: var(--sl-color-primary-100);
    }

    .connection-status {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8rem;
      color: rgba(255, 255, 255, 0.8);
      background: rgba(0, 0, 0, 0.2);
      padding: 0.2rem 0.5rem;
      border-radius: 1rem;
      margin-left: 1rem;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .dot.online { background-color: #4ade80; box-shadow: 0 0 5px #4ade80; }
    .dot.offline { background-color: #f87171; }
  `;

  private _onToggleView() {
    this.dispatchEvent(new CustomEvent('rr-view-toggle', {
      bubbles: true,
      composed: true
    }));
  }

  private _onOpenSettings() {
    this.settingsDialog.show();
  }

  render() {
    return html`
      <nav>
        <div class="left-section">
          <sl-tooltip content="${this.viewMode === 'editor' ? 'Switch to Live View' : 'Switch to Editor View'}">
            <sl-icon-button 
              name=${this.viewMode === 'editor' ? 'image-fill' : 'camera-video-fill'} 
              @click=${this._onToggleView}
            ></sl-icon-button>
          </sl-tooltip>
          <div class="title-status">
            <slot name="status">Occupancy UI</slot>
          </div>
          <div class="connection-status">
            <div class="dot ${this.serverConnected ? 'online' : 'offline'}"></div>
            ${this.serverConnected ? 'Connected' : 'Offline'}
          </div>
        </div>

        <div class="right-section">
          <sl-icon-button name="gear" @click=${this._onOpenSettings}></sl-icon-button>
        </div>
      </nav>

      <rr-settings-dialog 
        .layout=${this.layout} 
        .serverConnected=${this.serverConnected}
        .isSyncing=${this.isSyncing}
      ></rr-settings-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-header': RRHeader;
  }
}
