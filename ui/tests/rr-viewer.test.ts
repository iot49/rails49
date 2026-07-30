import { fixture, html, expect } from '@open-wc/testing';
import { vi, describe, it } from 'vitest';
import '../src/rr-viewer.js';
import { RrViewer } from '../src/rr-viewer.js';

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

vi.stubGlobal('ResizeObserver', MockResizeObserver);

describe('rr-viewer', () => {
  const resolution = { width: 1000, height: 1000 };

  it('renders <img> when src is set', async () => {
    const el = await fixture<RrViewer>(html`
      <rr-viewer src="test.jpg" .resolution=${resolution}></rr-viewer>
    `);
    expect(el.shadowRoot!.querySelector('img')).to.exist;
    expect(el.shadowRoot!.querySelector('video')).to.not.exist;
  });

  it('renders <video> when stream is set', async () => {
    const stream = {} as MediaStream;
    const el = await fixture<RrViewer>(html`
      <rr-viewer .stream=${stream} .resolution=${resolution}></rr-viewer>
    `);
    expect(el.shadowRoot!.querySelector('video')).to.exist;
    expect(el.shadowRoot!.querySelector('img')).to.not.exist;
  });

  it('sets SVG viewBox correctly', async () => {
    const el = await fixture<RrViewer>(html`
      <rr-viewer .resolution=${{ width: 800, height: 600 }}></rr-viewer>
    `);
    const svg = el.shadowRoot!.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).to.equal('0 0 800 600');
  });

  it('renders one <use> per marker', async () => {
    const markers = [
      { id: '1', x: 100, y: 100, type: 'track' as const },
      { id: '2', x: 200, y: 200, type: 'train' as const },
    ];
    const el = await fixture<RrViewer>(html`
      <rr-viewer .markers=${markers} .resolution=${resolution}></rr-viewer>
    `);
    expect(el.shadowRoot!.querySelectorAll('use').length).to.equal(2);
  });

  // The viewer authors nothing after the v4 reduction (#19). v3's pointer
  // machinery placed and dragged point markers and dragged a {p0, p1}
  // calibration pair; v4 stores neither. Car authoring, sensor placement and
  // the calibration-point tool arrive with the editor spec.
  describe('is read-only', () => {
    it('emits no rr-marker-add when the svg is clicked', async () => {
      const el = await fixture<RrViewer>(html`
        <rr-viewer .resolution=${resolution}></rr-viewer>
      `);
      const svg = el.shadowRoot!.querySelector('svg')!;

      let emitted = false;
      el.addEventListener('rr-marker-add', () => { emitted = true; });
      svg.dispatchEvent(new MouseEvent('click', { clientX: 100, clientY: 200, bubbles: true }));

      expect(emitted).to.be.false;
    });

    it('renders no calibration line or drag handles', async () => {
      const markers = [{ id: 'm1', x: 50, y: 50, type: 'track' as const }];
      const el = await fixture<RrViewer>(html`
        <rr-viewer .markers=${markers} .resolution=${resolution}></rr-viewer>
      `);
      expect(el.shadowRoot!.querySelector('.calibration-line')).to.not.exist;
      expect(el.shadowRoot!.querySelector('use[href="#drag-handle"]')).to.not.exist;
    });
  });
});
