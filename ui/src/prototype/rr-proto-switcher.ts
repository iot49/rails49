// PROTOTYPE — throwaway. Wayfinder ticket #5.
//
// Floating variant switcher. Deliberately ugly and high-contrast so it reads as
// scaffolding rather than as part of the design being judged. Hidden in
// production builds so a stray merge cannot ship it.

import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('rr-proto-switcher')
export class RrProtoSwitcher extends LitElement {
  @property({ type: Array }) variants: string[] = [];
  @property({ type: String }) current = 'A';
  @property({ type: String }) name = '';

  static styles = css`
    :host {
      position: fixed;
      left: 50%;
      bottom: 10px;
      transform: translateX(-50%);
      z-index: 9999;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 2px;
      background: #ffe600;
      color: #111;
      border-radius: 999px;
      padding: 3px;
      box-shadow: 0 4px 20px rgb(0 0 0 / 0.6);
      font: 700 0.78rem system-ui, sans-serif;
    }
    button {
      border: 0;
      background: transparent;
      font: inherit;
      cursor: pointer;
      padding: 4px 10px;
      border-radius: 999px;
    }
    button:hover {
      background: rgb(0 0 0 / 0.12);
    }
    .label {
      padding: 4px 8px;
      white-space: nowrap;
    }
    .tag {
      background: #111;
      color: #ffe600;
      border-radius: 999px;
      padding: 2px 8px;
      margin-right: 6px;
      font-size: 0.7rem;
      letter-spacing: 0.08em;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('keydown', this._onKey);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this._onKey);
  }

  private _onKey = (e: KeyboardEvent) => {
    const t = e.composedPath()[0] as HTMLElement | undefined;
    if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName ?? '')) return;
    if ((t as HTMLElement | undefined)?.isContentEditable) return;
    if (e.key === 'ArrowLeft') this._step(-1);
    else if (e.key === 'ArrowRight') this._step(1);
  };

  private _step(d: number) {
    const i = this.variants.indexOf(this.current);
    const next =
      this.variants[
        (i + d + this.variants.length) % this.variants.length
      ] ?? this.variants[0]!;
    const url = new URL(window.location.href);
    url.searchParams.set('variant', next);
    window.history.replaceState({}, '', url);
    this.dispatchEvent(
      new CustomEvent('proto-variant', {
        detail: { variant: next },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    if (import.meta.env?.PROD) return nothing;
    return html`
      <div class="bar">
        <span class="tag">PROTOTYPE</span>
        <button @click=${() => this._step(-1)} title="Previous (←)">‹</button>
        <span class="label">${this.current} — ${this.name}</span>
        <button @click=${() => this._step(1)} title="Next (→)">›</button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'rr-proto-switcher': RrProtoSwitcher;
  }
}
