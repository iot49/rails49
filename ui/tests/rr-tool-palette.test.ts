import { describe, it, expect, vi } from 'vitest';
import { fixture, html } from '@open-wc/testing';
import '../src/rr-tool-palette.js';
import { RRToolPalette } from '../src/rr-tool-palette.js';
import type { EditorTool } from '../src/rr-tool-palette.js';

/** The palette's button for one tool. */
function button(el: RRToolPalette, tool: EditorTool): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>(`#tool-${tool}`)!;
}

describe('rr-tool-palette', () => {
  it('is defined', () => {
    expect(document.createElement('rr-tool-palette')).to.be.instanceOf(RRToolPalette);
  });

  it('offers calibration, sensor and car', async () => {
    const el = await fixture<RRToolPalette>(html`<rr-tool-palette></rr-tool-palette>`);
    for (const tool of ['calibration', 'sensor', 'car'] as const) {
      expect(button(el, tool), `#tool-${tool} missing`).to.exist;
    }
  });

  it('marks the active tool, because a click means something different per tool', async () => {
    const el = await fixture<RRToolPalette>(
      html`<rr-tool-palette .tool=${'sensor' as EditorTool} calibrated></rr-tool-palette>`
    );

    expect(button(el, 'sensor').classList.contains('active')).to.be.true;
    expect(button(el, 'sensor').getAttribute('aria-pressed')).to.equal('true');
    expect(button(el, 'calibration').classList.contains('active')).to.be.false;
  });

  it('reports the chosen tool rather than selecting it itself', async () => {
    // Props down, events up: the editor owns the active tool, since it is what
    // dispatches a click on it.
    const el = await fixture<RRToolPalette>(html`<rr-tool-palette calibrated></rr-tool-palette>`);
    const seen = vi.fn();
    el.addEventListener('rr-tool-select', e => seen((e as CustomEvent).detail));

    button(el, 'sensor').click();
    await el.updateComplete;

    expect(seen).toHaveBeenCalledWith({ tool: 'sensor' });
    expect(el.tool).to.equal('calibration');
  });

  it('says nothing when the active tool is clicked again', async () => {
    const el = await fixture<RRToolPalette>(html`<rr-tool-palette calibrated></rr-tool-palette>`);
    const seen = vi.fn();
    el.addEventListener('rr-tool-select', seen);

    button(el, 'calibration').click();

    expect(seen).not.toHaveBeenCalled();
  });

  describe('the calibration gate', () => {
    it('disables the labeling tools while DPT is unresolved', async () => {
      const el = await fixture<RRToolPalette>(html`<rr-tool-palette></rr-tool-palette>`);

      expect(button(el, 'sensor').hasAttribute('disabled')).to.be.true;
      expect(button(el, 'car').hasAttribute('disabled')).to.be.true;
      // Calibration is the tool that *produces* the DPT: gating it deadlocks.
      expect(button(el, 'calibration').hasAttribute('disabled')).to.be.false;
    });

    it('states why, next to the buttons it disables', async () => {
      const el = await fixture<RRToolPalette>(html`<rr-tool-palette></rr-tool-palette>`);
      const reason = el.shadowRoot!.querySelector('.gate-reason')!;

      expect(reason).to.exist;
      expect(reason.textContent!.toLowerCase()).to.contain('calibrate');
      expect(reason.textContent!).to.contain('DPT');
    });

    it('emits nothing for a disabled tool', async () => {
      const el = await fixture<RRToolPalette>(html`<rr-tool-palette></rr-tool-palette>`);
      const seen = vi.fn();
      el.addEventListener('rr-tool-select', seen);

      button(el, 'sensor').click();
      button(el, 'car').click();

      expect(seen).not.toHaveBeenCalled();
    });

    it('enables them the moment calibration resolves, and disables them again if it stops', async () => {
      // Gated on existence, never on completion: the gate opens and closes with
      // the DPT, and every stage stays re-enterable.
      const el = await fixture<RRToolPalette>(html`<rr-tool-palette></rr-tool-palette>`);

      el.calibrated = true;
      await el.updateComplete;
      expect(button(el, 'sensor').hasAttribute('disabled')).to.be.false;
      expect(button(el, 'car').hasAttribute('disabled')).to.be.false;
      expect(el.shadowRoot!.querySelector('.gate-reason')).to.not.exist;

      el.calibrated = false;
      await el.updateComplete;
      expect(button(el, 'sensor').hasAttribute('disabled')).to.be.true;
    });
  });
});
