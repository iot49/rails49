import { describe, it, expect } from 'vitest';
import { render } from 'lit';
import { svg } from 'lit';
import { markerDefs, markerStyles, renderMarker } from '../src/marker.js';
import type { MarkerData, MarkerType, MarkerStatus } from '../src/marker.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render a lit SVGTemplateResult into a detached <svg> element and return it. */
function renderSvg(template: ReturnType<typeof svg>): SVGElement {
  const container = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  render(template, container);
  return container;
}

/** Render markerDefs + renderMarker together into a <svg>. */
function renderWithDefs(marker: MarkerData, size: number): SVGElement {
  return renderSvg(svg`${markerDefs()}${renderMarker(marker, size)}`);
}

const MARKER_TYPES: MarkerType[] = ['track', 'train', 'coupling', 'other'];


// ---------------------------------------------------------------------------
// markerDefs()
// ---------------------------------------------------------------------------

describe('markerDefs()', () => {
  it('produces a <defs> element', () => {
    const el = renderSvg(markerDefs());
    expect(el.querySelector('defs')).not.toBeNull();
  });

  it.each(MARKER_TYPES)('contains a <symbol id="%s">', (type) => {
    const el = renderSvg(markerDefs());
    const symbol = el.querySelector(`symbol#${type}`);
    expect(symbol, `symbol#${type} missing from markerDefs`).not.toBeNull();
  });

  it('contains a <symbol id="drag-handle">', () => {
    const el = renderSvg(markerDefs());
    expect(el.querySelector('symbol#drag-handle')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// markerStyles
// ---------------------------------------------------------------------------

describe('markerStyles', () => {
  it('is a non-empty CSSResult', () => {
    expect(typeof markerStyles.cssText).toBe('string');
    expect(markerStyles.cssText.trim().length).toBeGreaterThan(0);
  });

  it('contains .validation-rect rules', () => {
    expect(markerStyles.cssText).toContain('validation-rect');
  });
});

// ---------------------------------------------------------------------------
// renderMarker() — symbol reference
// ---------------------------------------------------------------------------

describe('renderMarker() — symbol reference', () => {
  it.each(MARKER_TYPES)('renders <use href="#%s"> for type "%s"', (type) => {
    const m: MarkerData = { id: '1', x: 100, y: 200, type };
    const el = renderWithDefs(m, 36);
    const use = el.querySelector('use');
    expect(use, '<use> missing').not.toBeNull();
    expect(use!.getAttribute('href')).toBe(`#${type}`);
  });

  it('falls back to "other" for unknown marker types', () => {
    const m: any = { id: '7', x: 100, y: 100, type: 'unknown' };
    const el = renderWithDefs(m, 36);
    const use = el.querySelector('use');
    expect(use!.getAttribute('href')).toBe('#other');
  });
});

// ---------------------------------------------------------------------------
// renderMarker() — position
// ---------------------------------------------------------------------------

describe('renderMarker() — position', () => {
  it('centers the symbol on (x, y) using transform and x/y offsets', () => {
    const m: MarkerData = { id: '2', x: 100, y: 200, type: 'track' };
    const size = 40;
    const el = renderWithDefs(m, size);
    const use = el.querySelector('use')!;
    expect(use.getAttribute('transform')).toBe(`translate(${m.x}, ${m.y})`);
    expect(Number(use.getAttribute('x'))).toBe(-size / 2);
    expect(Number(use.getAttribute('y'))).toBe(-size / 2);
    expect(Number(use.getAttribute('width'))).toBe(size);
    expect(Number(use.getAttribute('height'))).toBe(size);
  });

  it('correctly places a marker at origin (0, 0)', () => {
    const m: MarkerData = { id: '3', x: 0, y: 0, type: 'coupling' };
    const size = 20;
    const el = renderWithDefs(m, size);
    const use = el.querySelector('use')!;
    expect(use.getAttribute('transform')).toBe('translate(0, 0)');
    expect(Number(use.getAttribute('x'))).toBe(-10);
    expect(Number(use.getAttribute('y'))).toBe(-10);
  });
});

// ---------------------------------------------------------------------------
// renderMarker() — validation ring
// ---------------------------------------------------------------------------

describe('renderMarker() — validation ring', () => {
  it('renders no .validation-rect when status is null/undefined', () => {
    const m: MarkerData = { id: '4', x: 0, y: 0, type: 'track' };
    const el = renderWithDefs(m, 36);
    expect(el.querySelector('.validation-rect')).toBeNull();
  });

  const statusColors: Array<[MarkerStatus, string]> = [
    ['match', 'match'],
    ['mismatch', 'mismatch'],
    ['pending', 'pending'],
  ];

  it.each(statusColors)('renders .validation-rect with data-status="%s"', (status) => {
    const m: MarkerData = { id: '5', x: 50, y: 50, type: 'train', status };
    const el = renderWithDefs(m, 36);
    const rect = el.querySelector('.validation-rect');
    expect(rect, '.validation-rect missing').not.toBeNull();
    expect(rect!.getAttribute('data-status')).toBe(status);
  });

  it('validation-rect is positioned identically to the <use> element', () => {
    const m: MarkerData = { id: '6', x: 120, y: 80, type: 'other', status: 'match' };
    const size = 32;
    const el = renderWithDefs(m, size);
    const use = el.querySelector('use')!;
    const rect = el.querySelector('.validation-rect')!;
    expect(rect.getAttribute('transform')).toBe(use.getAttribute('transform'));
    expect(rect.getAttribute('x')).toBe(use.getAttribute('x'));
    expect(rect.getAttribute('y')).toBe(use.getAttribute('y'));
    expect(rect.getAttribute('width')).toBe(use.getAttribute('width'));
    expect(rect.getAttribute('height')).toBe(use.getAttribute('height'));
  });
});
