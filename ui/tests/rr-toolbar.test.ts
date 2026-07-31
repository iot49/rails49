import { describe, it } from 'vitest';
import { fixture, html, expect, oneEvent } from '@open-wc/testing';
import '../src/rr-toolbar.js';
import { RRToolbar } from '../src/rr-toolbar.js';

describe('rr-toolbar', () => {
  it('is defined', () => {
    const el = document.createElement('rr-toolbar');
    expect(el).to.be.instanceOf(RRToolbar);
  });

  it('renders the file buttons', async () => {
    const el = await fixture<RRToolbar>(html`<rr-toolbar></rr-toolbar>`);
    for (const id of ['file-new', 'file-open', 'file-save']) {
      expect(el.shadowRoot!.querySelector(`#${id}`), `#${id} missing`).to.exist;
    }
  });

  // The v3 labeling tools are gone with the v4 reduction (#19): v4 stores no
  // point markers, and its calibration is a list of world-coordinate points
  // rather than a draggable pair. Nothing here should offer a labeling mode
  // until the editor spec brings car, sensor and calibration-point tools back.
  it('offers no labeling, delete, or calibrate tool', async () => {
    const el = await fixture<RRToolbar>(html`<rr-toolbar></rr-toolbar>`);
    for (const tool of ['track', 'train', 'coupling', 'other', 'delete', 'calibrate']) {
      expect(el.shadowRoot!.querySelector(`#tool-${tool}`), `#tool-${tool} should be gone`).to.not.exist;
    }
    expect(el.shadowRoot!.querySelector('[role="radio"]')).to.not.exist;
  });

  it('emits rr-file-open when open button is clicked', async () => {
    const el = await fixture<RRToolbar>(html`<rr-toolbar></rr-toolbar>`);
    const openBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('#file-open')!;
    
    setTimeout(() => openBtn.click());
    await oneEvent(el, 'rr-file-open');
  });

  it('emits rr-file-new when new button is clicked', async () => {
    const el = await fixture<RRToolbar>(html`<rr-toolbar></rr-toolbar>`);
    const newBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('#file-new')!;
    
    setTimeout(() => newBtn.click());
    await oneEvent(el, 'rr-file-new');
  });

  it('emits rr-file-save when save button is clicked', async () => {
    const el = await fixture<RRToolbar>(html`<rr-toolbar></rr-toolbar>`);
    const saveBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('#file-save')!;

    setTimeout(() => saveBtn.click());
    await oneEvent(el, 'rr-file-save');
  });

  // The disabled state is the point of having buttons at all: it is the only
  // signal that distinguishes "the stack is empty" from "the undo landed on an
  // image you are not looking at". Keys alone cannot say that.
  it('disables undo and redo when there is no history', async () => {
    const el = await fixture<RRToolbar>(html`<rr-toolbar></rr-toolbar>`);
    expect(el.shadowRoot!.querySelector('#edit-undo')!.hasAttribute('disabled')).to.be.true;
    expect(el.shadowRoot!.querySelector('#edit-redo')!.hasAttribute('disabled')).to.be.true;
  });

  it('names the edit it would reverse', async () => {
    const el = await fixture<RRToolbar>(
      html`<rr-toolbar .canUndo=${true} .undoLabel=${'delete image'}></rr-toolbar>`
    );
    const tooltip = el.shadowRoot!.querySelector('#edit-undo')!.closest('sl-tooltip')!;
    expect(tooltip.getAttribute('content')).to.equal('Undo delete image');
  });

  it('emits rr-undo and rr-redo when enabled', async () => {
    const el = await fixture<RRToolbar>(
      html`<rr-toolbar .canUndo=${true} .canRedo=${true}></rr-toolbar>`
    );

    setTimeout(() => el.shadowRoot!.querySelector<HTMLButtonElement>('#edit-undo')!.click());
    await oneEvent(el, 'rr-undo');

    setTimeout(() => el.shadowRoot!.querySelector<HTMLButtonElement>('#edit-redo')!.click());
    await oneEvent(el, 'rr-redo');
  });
});
