import { describe, it } from 'vitest';
import { fixture, html, expect, oneEvent } from '@open-wc/testing';
import '../src/rr-toolbar.js';
import { RRToolbar } from '../src/rr-toolbar.js';

describe('rr-toolbar', () => {
  it('is defined', () => {
    const el = document.createElement('rr-toolbar');
    expect(el).to.be.instanceOf(RRToolbar);
  });

  it('renders all tool buttons', async () => {
    const el = await fixture<RRToolbar>(html`<rr-toolbar></rr-toolbar>`);
    const tools = ['track', 'train', 'coupling', 'other', 'delete'];
    for (const tool of tools) {
      expect(el.shadowRoot!.querySelector(`#tool-${tool}`)).to.exist;
    }
  });

  it('highlights the active tool', async () => {
    const el = await fixture<RRToolbar>(html`<rr-toolbar activeTool="train"></rr-toolbar>`);
    const trainBtn = el.shadowRoot!.querySelector('#tool-train')!;
    expect(trainBtn.classList.contains('active')).to.be.true;
    expect(trainBtn.getAttribute('aria-checked')).to.equal('true');
    
    const trackBtn = el.shadowRoot!.querySelector('#tool-track')!;
    expect(trackBtn.classList.contains('active')).to.be.false;
  });

  it('emits rr-tool-select when a tool is clicked', async () => {
    const el = await fixture<RRToolbar>(html`<rr-toolbar></rr-toolbar>`);
    const trackBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('#tool-track')!;
    
    setTimeout(() => trackBtn.click());
    const ev = await oneEvent(el, 'rr-tool-select');
    
    expect(ev.detail.tool).to.equal('track');
  });

  it('disables buttons when disabled=true', async () => {
    const el = await fixture<RRToolbar>(html`<rr-toolbar disabled></rr-toolbar>`);
    const btns = el.shadowRoot!.querySelectorAll('button[role="radio"]');
    btns.forEach(btn => {
      expect((btn as HTMLButtonElement).disabled).to.be.true;
    });
  });

  it('does not emit rr-tool-select when disabled', async () => {
    const el = await fixture<RRToolbar>(html`<rr-toolbar disabled></rr-toolbar>`);
    const trackBtn = el.shadowRoot!.querySelector<HTMLButtonElement>('#tool-track')!;
    
    let eventFired = false;
    el.addEventListener('rr-tool-select', () => { eventFired = true; });
    
    trackBtn.click();
    expect(eventFired).to.be.false;
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
