import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { R49Archive } from '@occupancy/r49';
import './rr-header.js';
import './rr-editor-view.js';
import './rr-live-view.js';
import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

declare const __RAILS_DOMAIN__: string;

// Set the base path for Shoelace assets (icons, etc.)
setBasePath('/ui/shoelace');

function getBaseDomain(): string {
  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return __RAILS_DOMAIN__;
  }
  return hostname.replace(/^(ui|throttle|mqtt|rocrail|traefik)\./, '');
}

const DEFAULT_SERVER_URL = `https://ui.${getBaseDomain()}`;

/**
 * Top-level application shell.
 */
@customElement('rr-app')
export class RRApp extends LitElement {
  @state() private _archive: R49Archive | null = null;
  @state() private _viewMode: 'editor' | 'live' = 'editor';
  @state() private _status = 'No archive loaded';
  @state() private _serverUrl = localStorage.getItem('rr-server-url') || DEFAULT_SERVER_URL;
  @state() private _serverConnected = false;
  @state() private _isSyncing = false;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
      background: #000;
      color: #eee;
    }

    main {
      flex-grow: 1;
      display: flex;
      overflow: hidden;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._checkServer();
    setInterval(() => this._checkServer(), 10000);
  }

  private async _checkServer() {
    try {
      const response = await fetch(`${this._serverUrl}/api/snapshot`, { method: 'HEAD' });
      const wasConnected = this._serverConnected;
      this._serverConnected = response.ok;
      
      // Auto-load if we just connected
      if (this._serverConnected && !wasConnected) {
        await this._onServerDownload(true); // silent auto-load
      }
    } catch (e) {
      this._serverConnected = false;
    }
  }

  /**
   * Helper to show a toast notification using Shoelace sl-alert
   */
  private _notify(message: string, variant: 'primary' | 'success' | 'danger' | 'warning' = 'primary', icon = 'info-circle', duration = 3000) {
    const alert = Object.assign(document.createElement('sl-alert'), {
      variant,
      closable: true,
      duration,
      innerHTML: `
        <sl-icon slot="icon" name="${icon}"></sl-icon>
        ${message}
      `
    });
    this.renderRoot.appendChild(alert);
    return (alert as any).toast();
  }

  private _onServerUrlChange(e: CustomEvent) {
    this._serverUrl = e.detail.url;
    localStorage.setItem('rr-server-url', this._serverUrl);
    this._checkServer();
  }

  private async _onServerDownload(silent = false) {
    if (this._isSyncing) return;
    try {
      this._isSyncing = true;
      const response = await fetch(`${this._serverUrl}/api/r49?t=${Date.now()}`);
      if (!response.ok) throw new Error(`Download failed: ${response.statusText}`);
      const arrayBuffer = await response.arrayBuffer();
      this._archive = await R49Archive.load(arrayBuffer);
      this._status = this._archive.getManifest().layout.name || 'Downloaded Layout';
      if (!silent) this._notify('Download successful', 'success', 'cloud-download');
    } catch (err) {
      console.error('Failed to download from server', err);
      this._notify(`Download failed: ${String(err)}`, 'danger', 'exclamation-triangle');
    } finally {
      this._isSyncing = false;
    }
  }

  private async _onServerUpload() {
    if (!this._archive) return;
    if (!this._validateCalibration()) return;
    if (this._isSyncing) return;
    try {
      this._isSyncing = true;
      const data = await this._archive.export();
      const response = await fetch(`${this._serverUrl}/api/r49`, {
        method: 'POST',
        body: data as any,
        headers: { 'Content-Type': 'application/octet-stream' }
      });
      if (!response.ok) throw new Error(`Upload failed: ${response.statusText}`);
      this._notify('Upload successful', 'success', 'cloud-upload');
    } catch (err) {
      console.error('Failed to upload to server', err);
      this._notify(`Upload failed: ${String(err)}`, 'danger', 'exclamation-triangle');
    } finally {
      this._isSyncing = false;
    }
  }
  
  private _onFileNew() {
    this._archive = new R49Archive();
    this._archive.setManifest({
      version: 3,
      layout: {
        name: 'New Layout',
        scale: 'N'
      },
      camera: {
        resolution: { width: 1920, height: 1080 }
      },
      images: []
    });
    this._status = 'New Layout';
    this._viewMode = 'editor';
  }
  
  private async _onFileOpen() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.r49';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (file) {
        try {
          this._status = `Loading ${file.name}...`;
          this._archive = await R49Archive.load(file);
          this._status = this._archive.getManifest().layout.name || file.name;
          this._notify(`Loaded ${file.name}`, 'success', 'file-earmark-check');
        } catch (err) {
          console.error('Failed to load archive', err);
          this._notify(`Load failed: ${String(err)}`, 'danger', 'exclamation-octagon');
        }
      }
    };
    input.click();
  }

  private _validateCalibration(): boolean {
    if (!this._archive) return false;
    const manifest = this._archive.getManifest();
    const cal = manifest.layout.calibration;

    if (!cal) {
      this._notify('Calibration is missing. Use rulers tool before saving.', 'warning', 'rulers');
      return false;
    }

    const { p0, p1, size_mm } = cal;

    if (!p0 || isNaN(p0.x) || isNaN(p0.y) || !p1 || isNaN(p1.x) || isNaN(p1.y)) {
      this._notify('Calibration points are invalid.', 'warning', 'exclamation-triangle');
      return false;
    }

    if (p0.x === p1.x && p0.y === p1.y) {
      this._notify('Calibration points cannot be identical.', 'warning', 'exclamation-triangle');
      return false;
    }

    if (isNaN(size_mm) || size_mm <= 0) {
      this._notify('Calibration size (mm) must be a positive number.', 'warning', 'exclamation-triangle');
      return false;
    }

    return true;
  }

  private async _onFileSave() {
    if (!this._archive) return;
    if (!this._validateCalibration()) return;
    try {
      const data = await this._archive.export();
      const blob = new Blob([data as any], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this._archive.getManifest().layout.name || 'layout'}.r49`;
      a.click();
      URL.revokeObjectURL(url);
      this._notify('Saved to disk', 'success', 'download');

      // Auto-upload if connected
      if (this._serverConnected) {
        await this._onServerUpload();
      }
    } catch (err) {
      console.error('Failed to save archive', err);
      this._notify(`Save failed: ${String(err)}`, 'danger', 'exclamation-diamond');
    }
  }

  private _onViewToggle() {
    this._viewMode = this._viewMode === 'editor' ? 'live' : 'editor';
  }

  private _onLayoutChange(e: CustomEvent) {
    if (!this._archive) return;
    const manifest = this._archive.getManifest();
    manifest.layout = { ...manifest.layout, ...e.detail.layout };
    this._status = manifest.layout.name || this._status;
    this.requestUpdate();
  }

  render() {
    let layout = { name: '', scale: 'N' };
    try {
      if (this._archive) {
        layout = this._archive.getManifest().layout as any;
      }
    } catch (e) {
      // Ignore if manifest not yet ready
    }

    return html`
      <rr-header 
        .viewMode=${this._viewMode}
        .layout=${layout}
        .serverConnected=${this._serverConnected}
        .isSyncing=${this._isSyncing}
        @rr-view-toggle=${this._onViewToggle}
        @rr-layout-change=${this._onLayoutChange}
        @rr-server-url-change=${this._onServerUrlChange}
        @rr-server-download=${() => this._onServerDownload()}
        @rr-server-upload=${this._onServerUpload}
      >
        <span slot="status">${this._status}</span>
      </rr-header>

      <main>
        ${this._viewMode === 'editor' 
          ? html`
              <rr-editor-view 
                .archive=${this._archive}
                .serverUrl=${this._serverConnected ? this._serverUrl : ''}
                @rr-file-new=${this._onFileNew}
                @rr-file-open=${this._onFileOpen}
                @rr-file-save=${this._onFileSave}
              ></rr-editor-view>`
          : html`<rr-live-view .archive=${this._archive} .serverUrl=${this._serverConnected ? this._serverUrl : ''}></rr-live-view>`
        }
      </main>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-app': RRApp;
  }
}
