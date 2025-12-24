import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { provide } from '@lit/context';
import { R49File, r49FileContext } from './app/r49file.ts';
import { Classifier, ClassifierSpec, classifierContext } from './app/classifier.ts';


@customElement('rr-main')
export class RrMain extends LitElement {
  @provide({ context: r49FileContext })
  @state()
  private _r49File: R49File;

  /* 
     State Management:
     We hold a stable `_r49File` instance and provide it via Context.
     Consumers (rr-layout-editor, etc.) must listen to 'r49-file-changed' events 
     on this instance to trigger their own updates.
     This avoids recreating the R49File wrapper for every change.
  */

  @provide({ context: classifierContext })
  @state()
  _classifier: Classifier | undefined;

  constructor() {
    super();
    this._r49File = new R49File();
    this._r49File.addEventListener('r49-file-changed', this._handleFileChange);
  }

  private _handleFileChange = (_: Event) => {
    // Clean up old instance logic:
    // 1. Remove RrMain's listener
    this._r49File.removeEventListener('r49-file-changed', this._handleFileChange);
    
    // 2. Detach old instance from Manifest (stop it from listening)
    // We use .detach() instead of .dispose() to PRESERVE the images/manifest for the new instance.
    this._r49File.detach();

    // 3. Create new instance (Copy Constructor)
    // This new instance takes the Manifest and Images from the old one.
    this._r49File = new R49File(this._r49File);
    
    // 4. Attach listener to new instance
    this._r49File.addEventListener('r49-file-changed', this._handleFileChange);
  }

  private _handleClassifierSettingsChange = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const { model, precision } = detail;
      
      console.log(`Loading classifier: ${model} (${precision})`);
      try {
          const spec = await ClassifierSpec.load(model, precision);
          this._classifier = new Classifier(spec);
          console.log(`Classifier context updated for ${model}`);
      } catch (err) {
          console.error("Failed to load classifier spec", err);
      }
  }

  @state()
  private _viewMode: 'editor' | 'live' = 'editor';

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      font-family: sans-serif;
    }
  `;

  async connectedCallback() {
    super.connectedCallback();
    this.addEventListener('rr-view-toggle', this._handleViewToggle as EventListener);
    this.addEventListener('rr-classifier-settings-change', this._handleClassifierSettingsChange as EventListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener('rr-view-toggle', this._handleViewToggle as EventListener);
    this.removeEventListener('rr-classifier-settings-change', this._handleClassifierSettingsChange as EventListener);
  }

  render() {
    // trivial routing
    return html`
        ${this._viewMode === 'live' 
            ? html`<rr-live-view></rr-live-view>`
            : html`<rr-layout-editor></rr-layout-editor>`
        }
    `;
  }
  
  private _handleViewToggle = () => {
      this._viewMode = this._viewMode === 'editor' ? 'live' : 'editor';
  };
}
