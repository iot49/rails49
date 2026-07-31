import { describe, it, expect } from 'vitest';
import { render, svg } from 'lit';
import type { CalibrationPoint } from '@occupancy/r49';
import {
  renderCalibrationPoint,
  calibrationMarkerStyles,
} from '../src/calibrationMarker.js';

/** Render a lit SVGTemplateResult into a detached <svg> and return it. */
function renderSvg(template: ReturnType<typeof svg>): SVGElement {
  const container = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  render(template, container);
  return container;
}

const point = (over: Partial<CalibrationPoint> = {}): CalibrationPoint => ({
  px: { x: 100, y: 200 },
  world: { x: 0, y: 250, z: 0 },
  ...over,
});

describe('calibrationMarkerStyles', () => {
  it('carries the crosshair rules, so the host cannot render an unstyled one', () => {
    expect(calibrationMarkerStyles.cssText).toContain('calibration-point');
  });
});

describe('renderCalibrationPoint()', () => {
  it('draws a crosshair centered on the image pixel', () => {
    const el = renderSvg(renderCalibrationPoint(point(), 0, 40));
    const lines = [...el.querySelectorAll('line')];
    expect(lines).toHaveLength(2);

    const [horizontal, vertical] = lines;
    // Both arms are centered on (100, 200) and span the full symbol size.
    expect(Number(horizontal.getAttribute('x1')) + Number(horizontal.getAttribute('x2'))).toBe(200);
    expect(Number(horizontal.getAttribute('y1'))).toBe(200);
    expect(Number(horizontal.getAttribute('y2'))).toBe(200);
    expect(Number(horizontal.getAttribute('x2')) - Number(horizontal.getAttribute('x1'))).toBe(40);

    expect(Number(vertical.getAttribute('y1')) + Number(vertical.getAttribute('y2'))).toBe(400);
    expect(Number(vertical.getAttribute('x1'))).toBe(100);
    expect(Number(vertical.getAttribute('y2')) - Number(vertical.getAttribute('y1'))).toBe(40);
  });

  it('labels the point with its world coordinate in millimetres', () => {
    const el = renderSvg(renderCalibrationPoint(point(), 0, 40));
    expect(el.querySelector('text')!.textContent).toContain('0, 250, 0');
    expect(el.querySelector('text')!.textContent).toContain('mm');
  });

  it('rounds a fractional coordinate rather than printing float noise', () => {
    const el = renderSvg(
      renderCalibrationPoint(point({ world: { x: 0.1 + 0.2, y: -12.26, z: 3 } }), 0, 40)
    );
    expect(el.querySelector('text')!.textContent).toContain('0.3, -12.3, 3');
  });

  it('scales with the symbol size, so the crosshair is constant on screen', () => {
    const small = renderSvg(renderCalibrationPoint(point(), 0, 20));
    const large = renderSvg(renderCalibrationPoint(point(), 0, 80));
    const armOf = (el: SVGElement) => {
      const line = el.querySelector('line')!;
      return Number(line.getAttribute('x2')) - Number(line.getAttribute('x1'));
    };
    expect(armOf(large)).toBe(armOf(small) * 4);
    expect(Number(large.querySelector('text')!.getAttribute('font-size'))).toBeGreaterThan(
      Number(small.querySelector('text')!.getAttribute('font-size'))
    );
  });

  it('carries its index, which is the only handle a point has', () => {
    // Calibration points have no id — nothing references one individually —
    // so position in the list is what an editor gesture refers to.
    const el = renderSvg(renderCalibrationPoint(point(), 3, 40));
    expect(el.querySelector('[data-calibration-index]')!.getAttribute('data-calibration-index')).toBe('3');
  });
});
