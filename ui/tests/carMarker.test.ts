import { describe, it, expect } from 'vitest';
import { render, svg } from 'lit';
import type { CarLabel } from '@occupancy/r49';
import { renderCar, renderCoupler, renderPendingCar, carMarkerStyles } from '../src/carMarker.js';
import { carWidthPx } from '../src/geometry.js';

/** Render a lit SVGTemplateResult into a detached <svg> and return it. */
function renderSvg(template: ReturnType<typeof svg>): SVGElement {
  const container = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  render(template, container);
  return container;
}

/** A hand-drawn car — the only kind this editor authors. */
type HumanCar = Extract<CarLabel, { provenance: 'human' }>;

const car = (over: Partial<HumanCar> = {}): HumanCar => ({
  id: 'C1abcdefghi',
  class: 'stock',
  provenance: 'human',
  p0: { x: 100, y: 200 },
  p1: { x: 300, y: 200 },
  ...over,
});

/** A calibrated symbol: DPT 90, handles and labels at a fixed screen size. */
const size = (dpt: number | null, handlePx = 12, labelPx = 14) => ({ dpt, handlePx, labelPx });

/** The polygon's points, as `[x, y]` pairs. */
function polygonPoints(el: SVGElement): number[][] {
  return el
    .querySelector('polygon')!
    .getAttribute('points')!
    .split(' ')
    .map(pair => pair.split(',').map(Number));
}

describe('renderCar()', () => {
  it('draws the chord between the two clicked ends', () => {
    const el = renderSvg(renderCar(car(), size(90)));
    const line = el.querySelector('line')!;

    expect(line.getAttribute('x1')).toBe('100');
    expect(line.getAttribute('y1')).toBe('200');
    expect(line.getAttribute('x2')).toBe('300');
    expect(line.getAttribute('y2')).toBe('200');
  });

  it('draws the width rectangle, one car width across', () => {
    // The rectangle is the whole point of the calibration gate: it is what
    // tells the user whether the label covers the car.
    const el = renderSvg(renderCar(car(), size(90)));
    const ys = polygonPoints(el).map(([, y]) => y);

    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(carWidthPx(90), 6);
  });

  it('sizes the rectangle from DPT, so it shrinks with the photograph', () => {
    // Width is derived, never stored — 2.09 track widths in every scale.
    const wide = renderSvg(renderCar(car(), size(90)));
    const narrow = renderSvg(renderCar(car(), size(20)));

    const spread = (el: SVGElement) => {
      const ys = polygonPoints(el).map(([, y]) => y);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(spread(wide) / spread(narrow)).toBeCloseTo(90 / 20, 6);
  });

  it('orients the rectangle along the span', () => {
    // A diagonal car: the offset is perpendicular to the chord, so neither the
    // x nor the y extent alone is the car width.
    const el = renderSvg(renderCar(car({ p1: { x: 200, y: 300 } }), size(90)));
    const [a, b] = polygonPoints(el);

    // The p0-side and p1-side corners are one span apart, unchanged by the
    // offset, which is what makes the shape a rectangle rather than a wedge.
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(Math.hypot(100, 100), 6);
  });

  it('draws a handle at each end, at the screen-constant size', () => {
    const el = renderSvg(renderCar(car(), size(90, 12)));
    const handles = [...el.querySelectorAll('circle')];

    expect(handles).toHaveLength(2);
    expect(handles.map(h => [h.getAttribute('cx'), h.getAttribute('cy')])).toEqual([
      ['100', '200'],
      ['300', '200'],
    ]);
    // A handle is annotation, not a measurement: it is where the user grabs.
    expect(Number(handles[0].getAttribute('r'))).toBeCloseTo(6, 6);
  });

  it('drops the rectangle, not the car, when no DPT resolves', () => {
    // A calibration point can be deleted at any time, and the cars already
    // labelled must stay visible and grabbable — there is simply no width to
    // draw, since width is derived from DPT rather than stored.
    const el = renderSvg(renderCar(car(), size(null)));

    expect(el.querySelector('polygon')).toBeNull();
    expect(el.querySelector('line')).not.toBeNull();
    expect(el.querySelectorAll('circle')).toHaveLength(2);
  });

  it('keys the group on the label id, never on position', () => {
    const el = renderSvg(renderCar(car(), size(90)));
    expect(el.querySelector('g')!.getAttribute('data-label-id')).toBe('C1abcdefghi');
  });

  it('survives a zero-length span', () => {
    // The two clicks can land on the same pixel; the axis is then genuinely
    // undefined and `carCorners` collapses the rectangle onto the point.
    const el = renderSvg(renderCar(car({ p1: { x: 100, y: 200 } }), size(90)));

    expect(polygonPoints(el)).toEqual([
      [100, 200],
      [100, 200],
      [100, 200],
      [100, 200],
    ]);
  });

  it('ships styles for what it renders', () => {
    const css = carMarkerStyles.cssText;
    expect(css).toContain('.car');
    expect(css).toContain('polygon');
  });
});

describe('renderCar() with a class the vocabulary does not name', () => {
  const frame = { width: 1920, height: 1080 };
  const warned = (over = {}) =>
    renderSvg(renderCar(car({ class: 'stock.loko', ...over }), size(90), undefined, {
      text: 'stock.loko',
      frame,
    }));

  it('says which class is wrong, rather than only that one is', () => {
    // A typo is the likely cause, and a warning that does not name the class
    // leaves the labeler hunting for it (`SPEC.md` § Format).
    expect(warned().querySelector('text')!.textContent).toContain('stock.loko');
  });

  it('marks the car itself, so the warning is findable on the image', () => {
    expect(warned().querySelector('g')!.classList.contains('unknown-class')).toBe(true);
  });

  it('still draws the car, because the archive still opens', () => {
    // `class` is not validated at parse time on purpose: a format that refused
    // to open files because someone pruned `config.yaml` would punish config
    // edits. So a non-conforming label is a warning, never a hidden car.
    const el = warned();
    expect(el.querySelector('line')).not.toBeNull();
    expect(el.querySelector('polygon')).not.toBeNull();
    expect(el.querySelectorAll('circle')).toHaveLength(2);
  });

  it('flips the label inwards at the frame edge, like every other label', () => {
    const nearEdge = renderSvg(
      renderCar(car({ p0: { x: 1900, y: 1060 }, p1: { x: 1910, y: 1070 } }), size(90), undefined, {
        text: 'stock.loko',
        frame,
      })
    );
    expect(nearEdge.querySelector('text')!.getAttribute('text-anchor')).toBe('end');
  });

  it('draws no label and no mark for a class the vocabulary does name', () => {
    const el = renderSvg(renderCar(car(), size(90)));
    expect(el.querySelector('text')).toBeNull();
    expect(el.querySelector('g')!.classList.contains('unknown-class')).toBe(false);
  });

  it('warns a coupled car too, where the handles are gone', () => {
    const el = renderSvg(
      renderCar(car(), size(90), { p0: true, p1: true }, { text: 'stock.loko', frame })
    );
    expect(el.querySelector('text')).not.toBeNull();
    expect(el.querySelectorAll('circle')).toHaveLength(0);
  });
});

describe('renderCar() at a coupling', () => {
  it('leaves out the handle of a coupled end, which the coupler draws instead', () => {
    // A coupling renders as **one** shared handle (`SPEC.md` § Authoring cars).
    // Two circles stacked on the same pixel would only look like one.
    const el = renderSvg(renderCar(car(), size(90, 12), { p0: false, p1: true }));
    const handles = [...el.querySelectorAll('circle')];

    expect(handles).toHaveLength(1);
    expect(handles[0].getAttribute('cx')).toBe('100');
  });

  it('draws no handle at all for a car coupled at both ends', () => {
    const el = renderSvg(renderCar(car(), size(90, 12), { p0: true, p1: true }));
    expect(el.querySelectorAll('circle')).toHaveLength(0);
    // The car itself is untouched: a middle car of a train is still a car.
    expect(el.querySelector('line')).not.toBeNull();
    expect(el.querySelector('polygon')).not.toBeNull();
  });

  it('draws both handles when nothing is coupled', () => {
    expect(renderSvg(renderCar(car(), size(90, 12))).querySelectorAll('circle')).toHaveLength(2);
  });
});

describe('renderCoupler()', () => {
  it('draws one handle on the shared pixel', () => {
    const el = renderSvg(renderCoupler({ x: 300, y: 200 }, size(90, 12)));
    const handles = [...el.querySelectorAll('circle')];

    expect(handles).toHaveLength(1);
    expect(handles[0].getAttribute('cx')).toBe('300');
    expect(handles[0].getAttribute('cy')).toBe('200');
  });

  it('is larger than a free end, because it is a joint and not an end', () => {
    const coupler = renderSvg(renderCoupler({ x: 300, y: 200 }, size(90, 12)));
    const free = renderSvg(renderCar(car(), size(90, 12)));

    const r = (el: SVGElement) => Number(el.querySelector('circle')!.getAttribute('r'));
    expect(r(coupler)).toBeGreaterThan(r(free));
  });

  it('stays a screen size, so it does not grow with the photograph', () => {
    const near = renderSvg(renderCoupler({ x: 0, y: 0 }, size(90, 24)));
    const far = renderSvg(renderCoupler({ x: 0, y: 0 }, size(20, 24)));
    const r = (el: SVGElement) => Number(el.querySelector('circle')!.getAttribute('r'));

    expect(r(near)).toBe(r(far));
  });
});

describe('renderPendingCar()', () => {
  it('draws the band from the anchor to the cursor', () => {
    const el = renderSvg(
      renderPendingCar({ anchor: { x: 100, y: 200 }, to: { x: 400, y: 260 } }, size(90))
    );
    const line = el.querySelector('line')!;

    expect([line.getAttribute('x1'), line.getAttribute('y1')]).toEqual(['100', '200']);
    expect([line.getAttribute('x2'), line.getAttribute('y2')]).toEqual(['400', '260']);
  });

  it('previews the width rectangle the car will get', () => {
    // The rectangle is the only feedback that a label covers the car, so the
    // band shows it before the click rather than after.
    const el = renderSvg(
      renderPendingCar({ anchor: { x: 100, y: 200 }, to: { x: 400, y: 200 } }, size(90))
    );
    const ys = polygonPoints(el).map(([, y]) => y);

    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(carWidthPx(90), 6);
  });

  it('shows the anchor alone before the pointer has moved', () => {
    const el = renderSvg(
      renderPendingCar({ anchor: { x: 100, y: 200 }, to: { x: 100, y: 200 } }, size(90, 12))
    );

    // One handle: the anchor. The chord and the rectangle collapse onto it,
    // since a span with no length has no axis to draw along.
    expect(el.querySelectorAll('circle')).toHaveLength(1);
    expect(polygonPoints(el)).toEqual([
      [100, 200],
      [100, 200],
      [100, 200],
      [100, 200],
    ]);
  });

  it('drops the rectangle with no DPT, like a car does', () => {
    const el = renderSvg(
      renderPendingCar({ anchor: { x: 100, y: 200 }, to: { x: 400, y: 200 } }, size(null))
    );
    expect(el.querySelector('polygon')).toBeNull();
    expect(el.querySelector('line')).not.toBeNull();
  });

  it('is drawn dashed, so a band in flight is not read as a placed car', () => {
    const el = renderSvg(
      renderPendingCar({ anchor: { x: 100, y: 200 }, to: { x: 400, y: 200 } }, size(90))
    );
    expect(el.querySelector('g')!.getAttribute('class')).toContain('pending');
    expect(carMarkerStyles.cssText).toContain('stroke-dasharray');
  });
});
