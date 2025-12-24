import { consume } from '@lit/context';
import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Manifest, Scale2Number } from './app/manifest.ts';
import { R49File, r49FileContext } from './app/r49file.ts';
import { 
  HEIGHT_COLOR, 
  WIDTH_COLOR, 
  MODEL_LIST, 
  PRECISION_OPTIONS,
  DEFAULT_MODEL,
  DEFAULT_PRECISION
} from './config.ts';


@customElement('rr-settings')
export class RrSettings extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }

    .settings-table {
      display: table;
      width: 100%;
      border-spacing: 0 8px;
    }

    .settings-row {
      display: table-row;
    }

    .settings-label {
      display: table-cell;
      text-align: right;
      padding-right: 12px;
      vertical-align: middle;
      width: 150px;
    }

    .settings-field {
      display: table-cell;
      vertical-align: middle;
    }

    sl-input,
    sl-dropdown,
    sl-select {
      width: 200px;
    }

    /* Classifier Tab Styles */
    .classifier-settings {
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
  `;

  @consume({ context: r49FileContext, subscribe: true })
  @state()
  r49File!: R49File;

  @state()
  private _selectedModel: string = DEFAULT_MODEL;

  @state()
  private _selectedPrecision: string = DEFAULT_PRECISION;

  get manifest(): Manifest {
    return this.r49File?.manifest;
  }

  connectedCallback() {
      super.connectedCallback();
      this._parseUrlParams();
  }

  private _parseUrlParams() {
      const params = new URLSearchParams(window.location.search);
      const model = params.get('model');
      const precision = params.get('precision');

      if (model && MODEL_LIST.includes(model)) {
          this._selectedModel = model;
      }
      
      if (precision && PRECISION_OPTIONS.includes(precision)) {
          this._selectedPrecision = precision;
      }

      // Emit initial state
      this._emitChange();
  }

  private _emitChange() {
      this.dispatchEvent(new CustomEvent('rr-classifier-settings-change', {
          detail: {
              model: this._selectedModel,
              precision: this._selectedPrecision
          },
          bubbles: true,
          composed: true
      }));
  }

  render() {
    return html`
      <sl-tab-group>
        <sl-tab slot="nav" panel="layout">Layout</sl-tab>
        <sl-tab slot="nav" panel="classifier">Classifier</sl-tab>

        <sl-tab-panel name="layout">
          ${this._renderLayoutSettings()}
        </sl-tab-panel>

        <sl-tab-panel name="classifier">
          ${this._renderClassifierSettings()}
        </sl-tab-panel>
      </sl-tab-group>
    `;
  }

  private _renderLayoutSettings() {
    return html`
      <div class="settings-table">
        <div class="settings-row">
          <div class="settings-label">Name:</div>
          <div class="settings-field">
            <sl-input
              value=${this.manifest.layout.name || ''}
              @sl-input=${this._handleLayoutNameChange}
            >
            </sl-input>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-label" style="color: ${WIDTH_COLOR}">Width in mm:</div>
          <div class="settings-field">
            <sl-input
              type="number"
              value=${this.manifest.layout.size.width ?? ''}
              @sl-change=${this._handleWidthChange}
            ></sl-input>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-label" style="color: ${HEIGHT_COLOR}">Height in mm:</div>
          <div class="settings-field">
            <sl-input
              type="number"
              value=${this.manifest.layout.size.height ?? ''}
              @sl-input=${this._handleHeightChange}
            ></sl-input>
          </div>
        </div>
        <div class="settings-row">
          <div class="settings-label">Scale:</div>
          <div class="settings-field">
            <sl-dropdown>
              <sl-button class="scale" slot="trigger" caret>
                ${this.manifest.layout.scale}
              </sl-button>
              <sl-menu @sl-select=${this._handleScaleSelect}>
                ${Object.keys(Scale2Number).map(
                  (scale) =>
                    html`<sl-menu-item value=${scale}
                      >${scale} (1:${Scale2Number[scale as keyof typeof Scale2Number]})</sl-menu-item
                    >`,
                )}
              </sl-menu>
            </sl-dropdown>
          </div>
        </div>
      </div>
    `;
  }

  private _renderClassifierSettings() {
    return html`
      <div class="classifier-settings">
          <div class="settings-row">
             <div class="settings-label">Model:</div>
             <div class="settings-field">
                 <sl-select 
                    value=${this._selectedModel}
                    @sl-change=${this._handleModelChange}
                 >
                    ${MODEL_LIST.map(m => html`<sl-option value=${m}>${m}</sl-option>`)}
                 </sl-select>
             </div>
          </div>

          <div class="settings-row">
             <div class="settings-label">Precision:</div>
             <div class="settings-field">
                 <sl-select 
                    value=${this._selectedPrecision}
                    @sl-change=${this._handlePrecisionChange}
                 >
                    ${PRECISION_OPTIONS.map(p => html`<sl-option value=${p}>${p}</sl-option>`)}
                 </sl-select>
             </div>
          </div>
      </div>
    `;
  }

  private _handleModelChange(e: Event) {
      const select = e.target as HTMLInputElement; // sl-select behaves like input
      this._selectedModel = select.value;
      this._emitChange();
  }

  private _handlePrecisionChange(e: Event) {
      const select = e.target as HTMLInputElement;
      this._selectedPrecision = select.value;
      this._emitChange();
  }

  private _handleLayoutNameChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.manifest.setLayout({ ...this.manifest.layout, name: input.value });
  }

  private _handleScaleSelect(event: Event) {
    const menuItem = (event as CustomEvent).detail.item;
    const scale = menuItem.value as keyof typeof Scale2Number;
    this.manifest.setLayout({ ...this.manifest.layout, scale: scale });
  }

  private _handleWidthChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const width = parseFloat(input.value) || 0;

    // estimate height from image aspect ratio (if not set by user)
    const aspect_ratio =
      this.manifest.camera.resolution.height / this.manifest.camera.resolution.width;
    const height = this.manifest.layout.size.height
      ? this.manifest.layout.size.height
      : Math.round(width * aspect_ratio);

    this.manifest.setLayout({
      ...this.manifest.layout,
      size: { width: width, height: height },
    });
  }

  private _handleHeightChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const height = parseFloat(input.value) || 0;
    this.manifest.setLayout({
      ...this.manifest.layout,
      size: { ...this.manifest.layout.size, height },
    });
  }
}
