import { describe, it, expect } from 'vitest';
import { fixture, html, oneEvent } from '@open-wc/testing';
import '../src/rr-thumbnail-bar.js';
import { RRThumbnailBar } from '../src/rr-thumbnail-bar.js';

describe('rr-thumbnail-bar', () => {
  const images = ['img1.jpg', 'img2.jpg'];

  it('is defined', () => {
    const el = document.createElement('rr-thumbnail-bar');
    expect(el).to.be.instanceOf(RRThumbnailBar);
  });

  it('renders correct number of thumbnails', async () => {
    const el = await fixture<RRThumbnailBar>(html`
      <rr-thumbnail-bar .images=${images}></rr-thumbnail-bar>
    `);
    const thumbs = el.shadowRoot!.querySelectorAll('img');
    expect(thumbs.length).to.equal(2);
  });

  it('highlights the selected thumbnail', async () => {
    const el = await fixture<RRThumbnailBar>(html`
      <rr-thumbnail-bar .images=${images} .selectedIndex=${1}></rr-thumbnail-bar>
    `);
    const thumbs = el.shadowRoot!.querySelectorAll('img');
    expect(thumbs[0].classList.contains('active')).to.be.false;
    expect(thumbs[1].classList.contains('active')).to.be.true;
  });

  it('emits rr-image-select when a thumbnail is clicked', async () => {
    const el = await fixture<RRThumbnailBar>(html`
      <rr-thumbnail-bar .images=${images}></rr-thumbnail-bar>
    `);
    const thumb = el.shadowRoot!.querySelector('img')!;
    
    setTimeout(() => thumb.click());
    const ev = await oneEvent(el, 'rr-image-select');
    
    expect(ev.detail.index).to.equal(0);
  });

  it('emits rr-image-delete when delete button is clicked', async () => {
    const el = await fixture<RRThumbnailBar>(html`
      <rr-thumbnail-bar .images=${images}></rr-thumbnail-bar>
    `);
    const deleteBtn = el.shadowRoot!.querySelector('.delete-btn')!;
    
    setTimeout(() => (deleteBtn as HTMLElement).click());
    const ev = await oneEvent(el, 'rr-image-delete');
    
    expect(ev.detail.index).to.equal(0);
  });

  it('emits rr-image-add when add buttons are clicked', async () => {
    const el = await fixture<RRThumbnailBar>(html`
      <rr-thumbnail-bar></rr-thumbnail-bar>
    `);
    const addBtns = el.shadowRoot!.querySelectorAll('.add-btn');
    
    // Test Camera
    setTimeout(() => (addBtns[0] as HTMLElement).click());
    const ev1 = await oneEvent(el, 'rr-image-add');
    expect(ev1.detail.source).to.equal('camera');

    // Test File
    setTimeout(() => (addBtns[1] as HTMLElement).click());
    const ev2 = await oneEvent(el, 'rr-image-add');
    expect(ev2.detail.source).to.equal('file');
  });

  it('emits rr-image-reorder when a thumbnail is dropped', async () => {
    const el = await fixture<RRThumbnailBar>(html`
      <rr-thumbnail-bar .images=${['img1.jpg', 'img2.jpg']}></rr-thumbnail-bar>
    `);
    const wrappers = el.shadowRoot!.querySelectorAll('.thumbnail-wrapper');
    
    // Simulate drag and drop
    const dragStartEvent = new Event('dragstart', { 
      bubbles: true,
      composed: true
    });
    (dragStartEvent as any).dataTransfer = {
      effectAllowed: '',
      setData: () => {}
    };
    wrappers[0].dispatchEvent(dragStartEvent);
    
    const dropEvent = new Event('drop', { 
      bubbles: true,
      composed: true
    });
    (dropEvent as any).preventDefault = () => {};
    setTimeout(() => wrappers[1].dispatchEvent(dropEvent));
    
    const ev = await oneEvent(el, 'rr-image-reorder');
    expect(ev.detail.from).to.equal(0);
    expect(ev.detail.to).to.equal(1);
  });
});
