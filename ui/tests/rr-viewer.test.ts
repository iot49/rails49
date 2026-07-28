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

// Polyfill PointerEvent for jsdom if missing
if (typeof PointerEvent === 'undefined') {
  class PointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, params: any = {}) {
      super(type, params);
      this.pointerId = params.pointerId || 0;
    }
  }
  vi.stubGlobal('PointerEvent', PointerEvent);
}


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

  it('renders markers at correct positions', async () => {
    const markers = [
      { id: '1', x: 100, y: 100, type: 'track' as const },
      { id: '2', x: 200, y: 200, type: 'train' as const },
    ];
    const el = await fixture<RrViewer>(html`
      <rr-viewer .markers=${markers} .resolution=${resolution}></rr-viewer>
    `);
    const uses = el.shadowRoot!.querySelectorAll('use:not([href="#drag-handle"])');
    expect(uses.length).to.equal(2);
    
    // Position check (assuming MARKER_SIZE_PX = 36 and svg width is 1000 as per resolution for 1:1)
    // Actually the x/y in <use> is (marker.x - size/2)
    // We need to wait for updateSymbolSize or manually trigger it for deterministic tests
  });

  it('renders calibration lines when provided', async () => {
    const calibration = {
      p0: { x: 10, y: 10 },
      p1: { x: 100, y: 100 },
      size_mm: 100,
    };
    const el = await fixture<RrViewer>(html`
      <rr-viewer .calibration=${calibration} .resolution=${resolution}></rr-viewer>
    `);
    expect(el.shadowRoot!.querySelector('.calibration-line')).to.exist;
    expect(el.shadowRoot!.querySelectorAll('use[href="#drag-handle"]').length).to.equal(2);
  });

  describe('interaction', () => {
    function setupSvgMock(svg: SVGSVGElement) {
      svg.createSVGPoint = () => {
        const pt = {
          x: 0, y: 0,
          matrixTransform: () => ({ x: pt.x, y: pt.y })
        };
        return pt as any;
      };
      svg.getScreenCTM = () => ({
        inverse: () => ({})
      } as any);
    }

    it('emits rr-marker-add on click when interactive', async () => {
      const el = await fixture<RrViewer>(html`
        <rr-viewer interactive activeTool="track" .resolution=${resolution}></rr-viewer>
      `);
      const svg = el.shadowRoot!.querySelector('svg')!;
      setupSvgMock(svg);

      const promise = new Promise(resolve => el.addEventListener('rr-marker-add', resolve, { once: true }));
      
      svg.dispatchEvent(new MouseEvent('click', {
        clientX: 100,
        clientY: 200,
        bubbles: true
      }));

      const ev = await promise as CustomEvent;
      expect(ev.detail).to.deep.equal({ x: 100, y: 200, type: 'track' });
    });

    it('does not emit rr-marker-add when not interactive', async () => {
      const el = await fixture<RrViewer>(html`
        <rr-viewer .interactive=${false} activeTool="track" .resolution=${resolution}></rr-viewer>
      `);
      const svg = el.shadowRoot!.querySelector('svg')!;
      setupSvgMock(svg);

      let emitted = false;
      el.addEventListener('rr-marker-add', () => emitted = true);
      
      svg.dispatchEvent(new MouseEvent('click', {
        clientX: 100,
        clientY: 200,
        bubbles: true
      }));

      expect(emitted).to.be.false;
    });

    it('emits rr-marker-move on drag', async () => {
      const markers = [{ id: 'm1', x: 50, y: 50, type: 'track' as const }];
      const el = await fixture<RrViewer>(html`
        <rr-viewer interactive .markers=${markers} .resolution=${resolution}></rr-viewer>
      `);
      const svg = el.shadowRoot!.querySelector('svg')!;
      setupSvgMock(svg);

      const markerEl = svg.querySelector('use[data-id="m1"]')!;
      // Mock setPointerCapture
      markerEl.setPointerCapture = vi.fn();

      const promise = new Promise(resolve => el.addEventListener('rr-marker-move', resolve, { once: true }));

      markerEl.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
      svg.dispatchEvent(new PointerEvent('pointermove', {
        clientX: 60,
        clientY: 70,
        bubbles: true,
        pointerId: 1
      }));

      const ev = await promise as CustomEvent;
      expect(ev.detail).to.deep.equal({ id: 'm1', x: 60, y: 70 });
    });

    it('emits rr-marker-delete when clicking with delete tool', async () => {
      const markers = [{ id: 'm1', x: 50, y: 50, type: 'track' as const }];
      const el = await fixture<RrViewer>(html`
        <rr-viewer interactive activeTool="delete" .markers=${markers} .resolution=${resolution}></rr-viewer>
      `);
      const svg = el.shadowRoot!.querySelector('svg')!;
      setupSvgMock(svg);

      const markerEl = svg.querySelector('use[data-id="m1"]')!;
      const promise = new Promise(resolve => el.addEventListener('rr-marker-delete', resolve, { once: true }));

      markerEl.dispatchEvent(new MouseEvent('click', { bubbles: true }));

      const ev = await promise as CustomEvent;
      expect(ev.detail).to.deep.equal({ id: 'm1' });
    });
  });
});

