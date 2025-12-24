import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import './rr-settings.ts';

@customElement('rr-page')
export class RrPage extends LitElement {
  // ... styles ...
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      font-family: sans-serif;
      overflow: hidden;
    }

    header {
      height: var(--rr-main-header-height);
      background-color: var(--sl-color-primary-600);
      color: var(--sl-color-neutral-0);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 1em;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      font-weight: bold;
      font-size: 2em;
      flex-shrink: 0;
    }

    .left-align {
      display: flex;
      align-items: center;
      gap: 0.5em;
    }

    .right-align {
      display: flex;
      align-items: center;
      gap: 0.5em;
    }

    .view-toggle {
        cursor: pointer;
        font-size: 1.2rem;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 1.5em;
        height: 1.5em;
        border-radius: 50%;
        transition: background-color 0.2s;
    }
    
    .view-toggle:hover {
        background-color: rgba(255, 255, 255, 0.2);
    }

    main {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
      position: relative;
    }
  `;

  private _handleSettingsClick() {
    const dialog = this.shadowRoot?.querySelector('sl-dialog') as any;
    if (dialog) {
      dialog.show();
    }
  }

  private _handleViewToggle() {
      this.dispatchEvent(new CustomEvent('rr-view-toggle', { bubbles: true, composed: true }));
  }

  render() {
    return html`
      <header>
        <div class="left-align">
            <div class="view-toggle" @click=${this._handleViewToggle} title="Toggle View">
               <sl-icon name="list"></sl-icon>
            </div>
            <slot name="status"></slot>
        </div>

        <div class="right-align">
            <sl-icon-button
            name="gear"
            label="Settings"
            style="font-size: 1.5rem; color: white;"
            @click=${this._handleSettingsClick}
          ></sl-icon-button>
        </div>
      </header>
      <main>
        <slot></slot>
      </main>
      
      <sl-dialog label="Layout">
        <rr-settings></rr-settings>
      </sl-dialog>
    `;
  }
}
