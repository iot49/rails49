import { describe, it, expect } from 'vitest';
import { render, svg } from 'lit';
import type { Sensor } from '@occupancy/r49';
import { renderSensor, sensorLabelText, sensorMarkerStyles } from '../src/sensorMarker.js';
import { renderCalibrationPoint } from '../src/calibrationMarker.js';

/** Render a lit SVGTemplateResult into a detached <svg> and return it. */
function renderSvg(template: ReturnType<typeof svg>): SVGElement {
  const container = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  render(template, container);
  return container;
}

const sensor = (over: Partial<Sensor> = {}): Sensor => ({
  id: 'S1abcdefghi',
  x: 100,
  y: 200,
  ...over,
});

/** Big enough that the fixture sensor at (100, 200) is nowhere near an edge. */
const frame = { width: 1920, height: 1080 };

describe('sensorLabelText()', () => {
  it('shows the name when there is one', () => {
    expect(sensorLabelText(sensor({ name: 'Yard throat' }))).toBe('Yard throat');
  });

  it('falls back to the id, which is what consumers key on', () => {
    // Never an auto-generated "Sensor 3": it would be indistinguishable from a
    // name a human chose, and stops matching as sensors are added and removed.
    expect(sensorLabelText(sensor())).toBe('S1abcdefghi');
  });

  it('treats a blank name as no name', () => {
    expect(sensorLabelText(sensor({ name: '   ' }))).toBe('S1abcdefghi');
  });
});

describe('renderSensor()', () => {
  it('draws a diamond centered on the image pixel', () => {
    const el = renderSvg(renderSensor(sensor(), 40, frame));
    const points = el
      .querySelector('polygon')!
      .getAttribute('points')!
      .split(' ')
      .map(pair => pair.split(',').map(Number));

    expect(points).toEqual([
      [100, 180],
      [120, 200],
      [100, 220],
      [80, 200],
    ]);
  });

  it('marks the exact pixel with a filled core', () => {
    const el = renderSvg(renderSensor(sensor(), 40, frame));
    const circle = el.querySelector('circle')!;
    expect(Number(circle.getAttribute('cx'))).toBe(100);
    expect(Number(circle.getAttribute('cy'))).toBe(200);
  });

  it('is a different shape from the calibration crosshair', () => {
    // `SPEC.md` § Reference points: a calibration point must be unmistakable
    // from a sensor. Shape, not just colour — the two never share an element.
    const sensorEl = renderSvg(renderSensor(sensor(), 40, frame));
    const calibrationEl = renderSvg(
      renderCalibrationPoint({ px: { x: 100, y: 200 }, world: { x: 0, y: 0, z: 0 } }, 0, 40, frame)
    );

    expect(sensorEl.querySelector('polygon')).to.exist;
    expect(sensorEl.querySelector('line')).to.be.null;
    expect(calibrationEl.querySelector('polygon')).to.be.null;
    expect(calibrationEl.querySelectorAll('line')).toHaveLength(2);
  });

  it('scales with the symbol size, so the diamond is constant on screen', () => {
    const spanOf = (el: SVGElement) => {
      const xs = el
        .querySelector('polygon')!
        .getAttribute('points')!
        .split(' ')
        .map(pair => Number(pair.split(',')[0]));
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spanOf(renderSvg(renderSensor(sensor(), 80, frame)))).toBe(
      spanOf(renderSvg(renderSensor(sensor(), 20, frame))) * 4
    );
  });

  it('carries its id, which is the handle every gesture refers to', () => {
    const el = renderSvg(renderSensor(sensor(), 40, frame));
    expect(el.querySelector('[data-sensor-id]')!.getAttribute('data-sensor-id')).toBe('S1abcdefghi');
  });

  it('labels the sensor with its name, or its id when unnamed', () => {
    expect(
      renderSvg(renderSensor(sensor({ name: 'Yard throat' }), 40, frame)).querySelector('text')!
        .textContent
    ).toContain('Yard throat');
    expect(
      renderSvg(renderSensor(sensor(), 40, frame)).querySelector('text')!.textContent
    ).toContain('S1abcdefghi');
  });

  describe('label placement against the frame edges', () => {
    // As with the crosshair: jsdom neither lays out nor paints, so these assert
    // the attributes the flip produces, never that the label is visibly inside.
    const textOf = (el: SVGElement) => el.querySelector('text')!;

    it('draws up and to the right of a sensor well inside the frame', () => {
      const text = textOf(renderSvg(renderSensor(sensor(), 40, frame)));
      expect(text.getAttribute('text-anchor')).toBe('start');
      expect(text.getAttribute('dominant-baseline')).toBe('text-after-edge');
      expect(Number(text.getAttribute('x'))).toBeGreaterThan(100);
      expect(Number(text.getAttribute('y'))).toBeLessThan(200);
    });

    it('flips the label inwards at the right and top edges', () => {
      const right = textOf(
        renderSvg(renderSensor(sensor({ x: frame.width - 30, y: 500 }), 40, frame))
      );
      expect(right.getAttribute('text-anchor')).toBe('end');

      const top = textOf(renderSvg(renderSensor(sensor({ x: 500, y: 4 }), 40, frame)));
      expect(top.getAttribute('dominant-baseline')).toBe('text-before-edge');
    });

    it('leaves the diamond itself untouched by the flip', () => {
      const el = renderSvg(renderSensor(sensor({ x: frame.width - 5, y: 5 }), 40, frame));
      expect(Number(el.querySelector('circle')!.getAttribute('cx'))).toBe(frame.width - 5);
      expect(Number(el.querySelector('circle')!.getAttribute('cy'))).toBe(5);
    });
  });
});

describe('sensorMarkerStyles', () => {
  it('carries the sensor rules, so the host cannot render an unstyled one', () => {
    expect(sensorMarkerStyles.cssText).toContain('.sensor');
  });

  it('does not pin the baseline in CSS, which would beat the flipped attribute', () => {
    expect(sensorMarkerStyles.cssText).not.toContain('dominant-baseline:');
    expect(sensorMarkerStyles.cssText).not.toContain('text-anchor:');
  });
});
