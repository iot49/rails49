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
});
