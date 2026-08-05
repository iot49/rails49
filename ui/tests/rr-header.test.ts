import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fixture, html, oneEvent } from '@open-wc/testing';
import '../src/rr-header.js';
import { RRHeader } from '../src/rr-header.js';
import { RRSettingsDialog } from '../src/rr-settings-dialog.js';

// Mock ResizeObserver for Shoelace
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver for Shoelace
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock matchMedia for Shoelace
window.matchMedia = vi.fn().mockImplementation(query => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

// Mock getAnimations for Shoelace
if (!Element.prototype.getAnimations) {
  Element.prototype.getAnimations = vi.fn().mockReturnValue([]);
}

// Mock animate for Shoelace
if (!Element.prototype.animate) {
  Element.prototype.animate = vi.fn().mockImplementation(() => ({
    finished: Promise.resolve(),
    cancel: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    reverse: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

// Mock fetch globally for catalog requests
global.fetch = vi.fn().mockImplementation(() => 
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ models: ['test-model'], 'default-model': 'default' })
  })
);
describe('rr-header', () => {
  it('is defined', () => {
    const el = document.createElement('rr-header');
    expect(el).to.be.instanceOf(RRHeader);
  });

  it('offers every mode as its own control, so none is two clicks away', async () => {
    // The reason this is a segmented control rather than the old toggle (#87):
    // with three modes, a single cycling button puts one destination behind two
    // clicks with nothing on screen saying which.
    const el = await fixture<RRHeader>(html`<rr-header></rr-header>`);
    const labels = [...el.shadowRoot!.querySelectorAll('.modes sl-icon-button')].map(b =>
      b.getAttribute('label')
    );
    expect(labels).to.deep.equal(['Label', 'Live', 'Diagnostics']);
  });

  it('emits rr-view-change naming the mode chosen', async () => {
    const el = await fixture<RRHeader>(html`<rr-header></rr-header>`);
    const diagnostics = el.shadowRoot!.querySelector('sl-icon-button[label="Diagnostics"]')!;

    setTimeout(() => (diagnostics as HTMLElement).click());
    const event = await oneEvent(el, 'rr-view-change');
    expect(event.detail.mode).to.equal('diagnostics');
  });

  it('says which mode is current, rather than which one is next', async () => {
    // The old toggle showed the icon of where you would *go*. With three modes
    // that reads backwards, so the control marks the one you are in.
    const el = await fixture<RRHeader>(html`<rr-header .viewMode=${'live'}></rr-header>`);
    const active = el.shadowRoot!.querySelectorAll('.modes sl-icon-button.active');
    expect(active).to.have.lengthOf(1);
    expect(active[0].getAttribute('label')).to.equal('Live');
  });

  it('emits nothing when the current mode is clicked again', async () => {
    const el = await fixture<RRHeader>(html`<rr-header .viewMode=${'editor'}></rr-header>`);
    const label = el.shadowRoot!.querySelector('sl-icon-button[label="Label"]')!;

    let fired = false;
    el.addEventListener('rr-view-change', () => (fired = true));
    (label as HTMLElement).click();
    await el.updateComplete;
    expect(fired).to.be.false;
  });

  // Selected by name rather than by index: the right-hand group holds more than
  // one button, so an index would silently follow whichever was added last.
  it('opens settings dialog when gear icon is clicked', async () => {
    const el = await fixture<RRHeader>(html`<rr-header></rr-header>`);
    const gearBtn = el.shadowRoot!.querySelector('sl-icon-button[name="gear"]')!;
    const dialog = el.shadowRoot!.querySelector('rr-settings-dialog')!;

    const showSpy = vi.spyOn(dialog, 'show');
    (gearBtn as HTMLElement).click();

    expect(showSpy).toHaveBeenCalled();
  });

  it('links to the source repository from the right-hand button group', async () => {
    const el = await fixture<RRHeader>(html`<rr-header></rr-header>`);
    const group = el.shadowRoot!.querySelector('.right-section')!;
    const githubBtn = group.querySelector('sl-icon-button[name="github"]')!;

    expect(githubBtn).to.exist;
    expect(githubBtn.getAttribute('href')).to.equal('https://github.com/iot49/rails49');
    expect(githubBtn.getAttribute('target')).to.equal('_blank');
    expect(githubBtn.getAttribute('label')).to.equal('Source on GitHub');
  });

  // Asserted on the rendered anchor, not the host: sl-icon-button forwards no
  // `rel`, and emits its own whenever `target` is set. Reading the host would
  // pass just as happily with no rel on the anchor at all — and without
  // noopener the opened tab keeps a handle on this one, which holds an unsaved
  // archive in memory.
  it('opens the repository in a tab with no handle back on this one', async () => {
    const el = await fixture<RRHeader>(html`<rr-header></rr-header>`);
    const githubBtn = el.shadowRoot!.querySelector('sl-icon-button[name="github"]')!;
    const anchor = githubBtn.shadowRoot!.querySelector('a')!;

    expect(anchor).to.exist;
    expect(anchor.getAttribute('href')).to.equal('https://github.com/iot49/rails49');
    expect(anchor.getAttribute('target')).to.equal('_blank');
    expect(anchor.getAttribute('rel')).to.contain('noopener');
    expect(anchor.getAttribute('rel')).to.contain('noreferrer');
  });

  it('gives the repository link a tooltip naming its destination', async () => {
    const el = await fixture<RRHeader>(html`<rr-header></rr-header>`);
    const githubBtn = el.shadowRoot!.querySelector('sl-icon-button[name="github"]')!;
    const tooltip = githubBtn.closest('sl-tooltip')!;

    expect(tooltip).to.exist;
    expect(tooltip.getAttribute('content')).to.match(/github/i);
  });
});

describe('rr-settings-dialog', () => {
  beforeEach(() => {
    // Mock fetch for catalog
    global.fetch = vi.fn().mockImplementation(() => 
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ models: ['test-model'], 'default-model': 'default' })
      })
    );
  });

  it('is defined', () => {
    const el = document.createElement('rr-settings-dialog');
    expect(el).to.be.instanceOf(RRSettingsDialog);
  });

  // sl-change, not sl-input: text fields commit on blur or Enter so that an
  // edit is one undo entry rather than one per keystroke. See history.ts.
  it('emits rr-layout-change when name is committed', async () => {
    const el = await fixture<RRSettingsDialog>(html`<rr-settings-dialog></rr-settings-dialog>`);
    const nameInput = el.shadowRoot!.querySelector('sl-input')!;

    nameInput.value = 'New Layout Name';
    setTimeout(() => nameInput.dispatchEvent(new CustomEvent('sl-change')));


    const ev = await oneEvent(el, 'rr-layout-change');
    expect(ev.detail.layout.name).to.equal('New Layout Name');
  });

  it('emits rr-layout-change when scale is selected', async () => {
    const el = await fixture<RRSettingsDialog>(html`<rr-settings-dialog></rr-settings-dialog>`);
    const scaleSelect = el.shadowRoot!.querySelector('sl-select')!;
    
    scaleSelect.value = 'HO';
    setTimeout(() => scaleSelect.dispatchEvent(new CustomEvent('sl-change')));
    
    const ev = await oneEvent(el, 'rr-layout-change');
    expect(ev.detail.layout.scale).to.equal('HO');
  });

  it('fetches catalog when shown', async () => {
    // Obsolete: catalog fetch was removed from RRSettingsDialog
  });
});
