import { fixture, html, expect } from '@open-wc/testing';
import { vi, describe, it, beforeEach } from 'vitest';
import '../src/rr-viewer.js';
import { RrViewer } from '../src/rr-viewer.js';
import type {
  ViewerPointerDetail,
  ViewerContextMenuDetail,
  ViewerPointerEventName,
} from '../src/rr-viewer.js';

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

vi.stubGlobal('ResizeObserver', MockResizeObserver);

// jsdom implements no PointerEvent. A MouseEvent carrying a pointerId is
// everything the viewer reads off one.
class FakePointerEvent extends MouseEvent {
  readonly pointerId: number;
  constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
  }
}

/**
 * Give the SVG the geometry jsdom lacks: a uniform scale plus an offset,
 * standing in for a letterboxed viewport. `screen = image * scale + offset`.
 */
function stubSvgGeometry(
  svg: SVGSVGElement,
  { scale, offsetX = 0, offsetY = 0 }: { scale: number; offsetX?: number; offsetY?: number }
) {
  const inverse = { a: 1 / scale, d: 1 / scale, e: -offsetX / scale, f: -offsetY / scale };
  const ctm = { a: scale, d: scale, e: offsetX, f: offsetY, inverse: () => inverse };
  svg.getScreenCTM = () => ctm as unknown as DOMMatrix;
  svg.createSVGPoint = () => {
    const pt = {
      x: 0,
      y: 0,
      matrixTransform: (m: { a: number; d: number; e: number; f: number }) => ({
        x: pt.x * m.a + m.e,
        y: pt.y * m.d + m.f,
      }),
    };
    return pt as unknown as DOMPoint;
  };
  // jsdom implements no pointer capture either. Track it for real, so the
  // viewer's hasPointerCapture guard is exercised rather than stubbed past.
  const captured = new Set<number>();
  svg.setPointerCapture = vi.fn((id: number) => void captured.add(id));
  svg.hasPointerCapture = vi.fn((id: number) => captured.has(id));
  svg.releasePointerCapture = vi.fn((id: number) => void captured.delete(id));
}

/** Arguments each call received. `expect` here is chai's, not vitest's. */
function calls(fn: unknown): unknown[][] {
  return (fn as ReturnType<typeof vi.fn>).mock.calls;
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

  describe('calibration points', () => {
    const points = [
      { px: { x: 100, y: 100 }, world: { x: 0, y: 0, z: 0 } },
      { px: { x: 400, y: 300 }, world: { x: 0, y: 250, z: 0 } },
    ];

    it('draws one labelled crosshair per point', async () => {
      const el = await fixture<RrViewer>(html`
        <rr-viewer .calibrationPoints=${points} .resolution=${resolution}></rr-viewer>
      `);
      const drawn = el.shadowRoot!.querySelectorAll('.calibration-point');
      expect(drawn.length).to.equal(2);
      expect(drawn[1].querySelector('text')!.textContent).to.contain('0, 250, 0');
    });

    it('draws none by default, so the live view is unaffected', async () => {
      const el = await fixture<RrViewer>(html`
        <rr-viewer .resolution=${resolution}></rr-viewer>
      `);
      expect(el.shadowRoot!.querySelector('.calibration-point')).to.not.exist;
    });
  });

  // The viewer reports pointer gestures but still authors nothing: v3's marker
  // add/move/delete and its draggable {p0, p1} pair went with the v4 reduction
  // (#19) and do not come back. Placing anything is the editor's job — the
  // crosshairs above are drawn from a property, never written by the viewer.
  describe('authors nothing', () => {
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

  describe('pointer events', () => {
    let el: RrViewer;
    let svg: SVGSVGElement;
    let details: ViewerPointerDetail[];

    beforeEach(async () => {
      el = await fixture<RrViewer>(html`
        <rr-viewer src="test.jpg" .resolution=${resolution}></rr-viewer>
      `);
      svg = el.shadowRoot!.querySelector('svg')!;
      // Half-size on screen, shifted 40px right by the letterbox.
      stubSvgGeometry(svg, { scale: 0.5, offsetX: 40, offsetY: 10 });
      details = [];
    });

    // No cast on `e.detail`: the events are declared in HTMLElementEventMap,
    // which is the whole point of declaring them there.
    const collect = (type: ViewerPointerEventName) => {
      el.addEventListener(type, e => details.push(e.detail));
    };

    const press = (type: string, clientX: number, clientY: number, pointerId = 7) =>
      svg.dispatchEvent(new FakePointerEvent(type, { clientX, clientY, pointerId, bubbles: true }));

    it('reports pointer-down in image pixels, not screen pixels', () => {
      collect('rr-pointer-down');
      press('pointerdown', 140, 110);

      expect(details.length).to.equal(1);
      expect(details[0].point).to.deep.equal({ x: 200, y: 200 });
    });

    it('reports the image-pixels-per-screen-pixel factor with every event', () => {
      collect('rr-pointer-down');
      press('pointerdown', 140, 110);

      // The image renders at half size, so one screen pixel spans two of it.
      expect(details[0].imagePxPerScreenPx).to.equal(2);
    });

    it('carries the originating event, for pointerId and modifiers', () => {
      collect('rr-pointer-down');
      press('pointerdown', 140, 110, 42);

      expect(details[0].originalEvent.pointerId).to.equal(42);
    });

    it('reports move and up as well as down', () => {
      collect('rr-pointer-down');
      collect('rr-pointer-move');
      collect('rr-pointer-up');

      press('pointerdown', 140, 110);
      press('pointermove', 240, 110);
      press('pointerup', 340, 110);

      expect(details.map(d => d.point.x)).to.deep.equal([200, 400, 600]);
    });

    it('reports a cancelled gesture separately from a finished one', () => {
      let ups = 0;
      let cancels = 0;
      el.addEventListener('rr-pointer-up', () => { ups += 1; });
      el.addEventListener('rr-pointer-cancel', () => { cancels += 1; });

      press('pointerdown', 140, 110);
      press('pointercancel', 240, 110);

      expect(ups).to.equal(0);
      expect(cancels).to.equal(1);
    });

    it('captures the pointer on down and releases it on up', () => {
      press('pointerdown', 140, 110, 9);
      expect(calls(svg.setPointerCapture)).to.deep.equal([[9]]);

      press('pointerup', 240, 110, 9);
      expect(calls(svg.releasePointerCapture)).to.deep.equal([[9]]);
    });

    it('does not release a capture it never took', () => {
      // Releasing an unheld capture throws in a real browser, and a throw here
      // would land ahead of nothing useful — the up event is already out.
      press('pointerup', 240, 110, 9);
      expect(calls(svg.releasePointerCapture)).to.deep.equal([]);
    });

    it('releases the pointer when the gesture is cancelled', () => {
      press('pointerdown', 140, 110, 9);
      press('pointercancel', 140, 110, 9);
      expect(calls(svg.releasePointerCapture)).to.deep.equal([[9]]);
    });

    it('reports a right-click without suppressing the native menu', () => {
      // Whether the browser menu is suppressed depends on editor state — a
      // right-click ends a chain in one state and opens a menu in another — so
      // the decision belongs to the consumer, not the viewer.
      const seen: ViewerContextMenuDetail[] = [];
      el.addEventListener('rr-pointer-contextmenu', e => {
        seen.push(e.detail);
      });
      const event = new MouseEvent('contextmenu', { clientX: 140, clientY: 110, bubbles: true, cancelable: true });
      svg.dispatchEvent(event);

      expect(seen.length).to.equal(1);
      expect(seen[0].point).to.deep.equal({ x: 200, y: 200 });
      expect(event.defaultPrevented).to.be.false;
    });

    it('bubbles out of the shadow root', async () => {
      const host = await fixture<HTMLDivElement>(html`
        <div><rr-viewer src="test.jpg" .resolution=${resolution}></rr-viewer></div>
      `);
      const viewer = host.querySelector('rr-viewer')!;
      const inner = viewer.shadowRoot!.querySelector('svg')!;
      stubSvgGeometry(inner, { scale: 1 });

      let seen = 0;
      host.addEventListener('rr-pointer-down', () => { seen += 1; });
      inner.dispatchEvent(new FakePointerEvent('pointerdown', { clientX: 5, clientY: 5, bubbles: true }));

      expect(seen).to.equal(1);
    });

    it('emits nothing when the SVG has no transform to convert with', async () => {
      // jsdom implements no SVG geometry, and neither does a detached element.
      // Emitting a coordinate derived from a missing CTM would be worse than
      // emitting none.
      const bare = await fixture<RrViewer>(html`
        <rr-viewer src="test.jpg" .resolution=${resolution}></rr-viewer>
      `);
      const bareSvg = bare.shadowRoot!.querySelector('svg')!;

      let seen = 0;
      bare.addEventListener('rr-pointer-down', () => { seen += 1; });
      bareSvg.dispatchEvent(new FakePointerEvent('pointerdown', { clientX: 5, clientY: 5, bubbles: true }));

      expect(seen).to.equal(0);
    });

    it('reports in stream mode too, from the same transform', async () => {
      const live = await fixture<RrViewer>(html`
        <rr-viewer .stream=${{} as MediaStream} .resolution=${resolution}></rr-viewer>
      `);
      const liveSvg = live.shadowRoot!.querySelector('svg')!;
      stubSvgGeometry(liveSvg, { scale: 0.5, offsetX: 40, offsetY: 10 });

      const seen: ViewerPointerDetail[] = [];
      live.addEventListener('rr-pointer-down', e => {
        seen.push(e.detail);
      });
      liveSvg.dispatchEvent(new FakePointerEvent('pointerdown', { clientX: 140, clientY: 110, bubbles: true }));

      expect(seen.length).to.equal(1);
      expect(seen[0].point).to.deep.equal({ x: 200, y: 200 });
    });
  });
});
