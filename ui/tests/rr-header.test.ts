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

  it('emits rr-view-toggle when toggle button is clicked', async () => {
    const el = await fixture<RRHeader>(html`<rr-header></rr-header>`);
    const toggleBtn = el.shadowRoot!.querySelector('sl-icon-button')!;
    
    setTimeout(() => (toggleBtn as HTMLElement).click());
    await oneEvent(el, 'rr-view-toggle');
  });

  it('opens settings dialog when gear icon is clicked', async () => {
    const el = await fixture<RRHeader>(html`<rr-header></rr-header>`);
    const gearBtn = el.shadowRoot!.querySelectorAll('sl-icon-button')[1];
    const dialog = el.shadowRoot!.querySelector('rr-settings-dialog')!;
    
    const showSpy = vi.spyOn(dialog, 'show');
    (gearBtn as HTMLElement).click();
    
    expect(showSpy).toHaveBeenCalled();
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

  it('emits rr-layout-change when name is edited', async () => {
    const el = await fixture<RRSettingsDialog>(html`<rr-settings-dialog></rr-settings-dialog>`);
    const nameInput = el.shadowRoot!.querySelector('sl-input')!;
    
    nameInput.value = 'New Layout Name';
    setTimeout(() => nameInput.dispatchEvent(new CustomEvent('sl-input')));
    
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
