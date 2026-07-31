import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { R49Archive, MANIFEST_VERSION } from '@occupancy/r49';
import { EditHistory, type HistoryEntry } from './history.js';
import './rr-header.js';
import './rr-editor-view.js';
import type { RREditorView } from './rr-editor-view.js';
import './rr-live-view.js';
import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js';
import '@shoelace-style/shoelace/dist/components/alert/alert.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

// Set the base path for Shoelace assets (icons, etc.)
setBasePath('/ui/shoelace');

/**
 * True when a keystroke is being typed into a field, so the browser's own text
 * undo must win over the editor's.
 *
 * Reads `composedPath()[0]`, not `event.target`: Shoelace inputs are custom
 * elements, so the event is retargeted to the host and the focused `<input>`
 * sits inside its shadow root. Checking `target` would see `<sl-input>`, decide
 * it is not editable, and hijack Cmd+Z in the middle of typing a layout name.
 */
function isTypingTarget(event: KeyboardEvent): boolean {
  const node = event.composedPath()[0] as HTMLElement | undefined;
  if (!node || typeof node.tagName !== 'string') return false;
  const tag = node.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable === true;
}

/**
 * Top-level application shell.
 */
@customElement('rr-app')
export class RRApp extends LitElement {
  @state() private _archive: R49Archive | null = null;
  @state() private _viewMode: 'editor' | 'live' = 'editor';
  @state() private _status = 'No archive loaded';

  /**
   * The editor's undo stack. Owned here because the archive is owned here, and
   * passed down; see `history.ts` for why it is not part of `@occupancy/r49`.
   */
  private _history = new EditHistory();

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

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this._onKeyDown);
    super.disconnectedCallback();
  }

  /**
   * Cmd/Ctrl+Z and Cmd+Shift+Z / Ctrl+Y, editor view only.
   *
   * The buttons in `rr-toolbar` are not a duplicate of this: they carry the
   * disabled state, which is the only honest signal that the stack has a
   * bottom, and touch devices have no Cmd+Z at all.
   */
  private _onKeyDown = async (event: KeyboardEvent) => {
    if (this._viewMode !== 'editor' || !this._archive) return;
    if (!event.metaKey && !event.ctrlKey) return;
    if (isTypingTarget(event)) return;

    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      await this._undo();
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      await this._redo();
    }
  };

  private async _undo() {
    const entry = await this._history.undo();
    if (entry) await this._reveal(entry);
  }

  private async _redo() {
    const entry = await this._history.redo();
    if (entry) await this._reveal(entry);
  }

  /**
   * The navigation invariant: undo may move the user, but it may never change
   * something they cannot see. An entry scoped to another image selects that
   * image before the change lands.
   *
   * Object-level highlighting arrives with car authoring — for now the only
   * sub-image geometry is the image itself.
   */
  private async _reveal(entry: HistoryEntry) {
    const view = this.renderRoot.querySelector('rr-editor-view') as RREditorView | null;
    await view?.syncFromArchive(entry.target.kind === 'image' ? entry.target.filename : undefined);
    if (this._archive) {
      this._status = this._archive.getManifest().layout.name || this._status;
    }
    this.requestUpdate();
  }

  /** Re-renders the undo affordances after a child records an edit. */
  private _onHistoryChange() {
    this.requestUpdate();
  }

  /**
   * Guards the two acts undo structurally cannot cover: New and Open replace
   * the archive, and the stack goes with it.
   */
  private _confirmDiscard(): boolean {
    if (!this._history.isDirty) return true;
    return window.confirm('Discard unsaved changes to this layout?');
  }

  private _onFileNew() {
    if (!this._confirmDiscard()) return;
    this._archive = new R49Archive();
    this._archive.setManifest({
      version: MANIFEST_VERSION,
      layout: {
        name: 'New Layout',
        scale: 'N',
        // Uncalibrated is a real state, expressed as an empty point list.
        calibration: { points: [] },
        sensors: []
      },
      camera: {
        resolution: { width: 1920, height: 1080 }
      },
      images: []
    });
    this._status = 'New Layout';
    this._viewMode = 'editor';
    this._history.attach(this._archive);
  }

  private async _onFileOpen() {
    if (!this._confirmDiscard()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.r49';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (file) {
        try {
          this._status = `Loading ${file.name}...`;
          this._archive = await R49Archive.load(file);
          this._history.attach(this._archive);
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

  // Saving does not validate calibration. The v3 check read {p0, p1, size_mm}
  // structurally, which v4 does not have — calibration is a list of points that
  // legitimately starts empty, and "uncalibrated" is a state the format
  // expresses rather than an error to refuse a save over. The editor reports
  // DPT instead, and gating the labeling tools on it belongs to the editor
  // spec. See SPEC.md § Reference points.
  private async _onFileSave() {
    if (!this._archive) return;
    try {
      const data = await this._archive.export();
      const blob = new Blob([data as any], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this._archive.getManifest().layout.name || 'layout'}.r49`;
      a.click();
      URL.revokeObjectURL(url);
      // Saving marks the position rather than clearing the stack: the bytes on
      // disk are unaffected by anything undone afterwards, so undoing past a
      // save stays legitimate. The marker is what `isDirty` is measured from.
      this._history.markSaved();
      this._notify('Saved to disk', 'success', 'download');
      this.requestUpdate();
    } catch (err) {
      console.error('Failed to save archive', err);
      this._notify(`Save failed: ${String(err)}`, 'danger', 'exclamation-diamond');
    }
  }

  private _onViewToggle() {
    this._viewMode = this._viewMode === 'editor' ? 'live' : 'editor';
  }

  private async _onLayoutChange(e: CustomEvent) {
    if (!this._archive) return;
    const manifest = this._archive.getManifest();
    const field = Object.keys(e.detail.layout)[0] ?? 'layout';
    await this._history.record(`edit ${field}`, { kind: 'layout' }, () => {
      manifest.layout = { ...manifest.layout, ...e.detail.layout };
    });
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
        @rr-view-toggle=${this._onViewToggle}
        @rr-layout-change=${this._onLayoutChange}
      >
        <span slot="status">${this._status}</span>
      </rr-header>

      <main>
        ${this._viewMode === 'editor'
          ? html`
              <rr-editor-view
                .archive=${this._archive}
                .history=${this._history}
                .canUndo=${this._history.canUndo}
                .canRedo=${this._history.canRedo}
                .undoLabel=${this._history.undoLabel}
                .redoLabel=${this._history.redoLabel}
                @rr-file-new=${this._onFileNew}
                @rr-file-open=${this._onFileOpen}
                @rr-file-save=${this._onFileSave}
                @rr-history-change=${this._onHistoryChange}
                @rr-undo=${this._undo}
                @rr-redo=${this._redo}
              ></rr-editor-view>`
          : html`<rr-live-view .archive=${this._archive}></rr-live-view>`
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
