import { svg, css } from 'lit';
import type { SVGTemplateResult, CSSResult } from 'lit';
import type { CalibrationPoint, WorldPoint } from '@occupancy/r49';

/**
 * Calibration-point rendering for SVG: a crosshair labelled with its world
 * coordinate.
 *
 * A module rather than a custom element for the same reason `marker.ts` is —
 * custom elements break the SVG namespace when nested inside `<svg>`. Its two
 * exports **must be used together**: `calibrationMarkerStyles` in the host's
 * `static styles`, the renderer once per point.
 *
 * Why a crosshair and not another symbol from `marker.ts`: a calibration point
 * must be visually unmistakable from everything else the editor draws
 * (`SPEC.md` § Reference points), and the sensor tool that arrives next needs a
 * symbol that cannot be confused with this one. A crosshair also shows the
 * *exact* pixel it names, which a boxed icon does not.
 */

export const calibrationMarkerStyles: CSSResult = css`
  .calibration-point {
    /* One literal for the whole symbol. Not an --sl-* token: this is ink on an
       arbitrary photograph, not chrome, and it has to stay legible against both
       a dark tunnel mouth and a bright backdrop. */
    --calibration-ink: #22d3ee;
  }

  .calibration-point line,
  .calibration-point circle {
    stroke: var(--calibration-ink);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }

  .calibration-point circle {
    fill: none;
  }

  .calibration-point text {
    fill: var(--calibration-ink);
    /* The photograph underneath is arbitrary, so the label carries its own
       contrast rather than relying on what it happens to sit on. */
    stroke: rgba(0, 0, 0, 0.75);
    stroke-width: 3;
    paint-order: stroke;
    font-family: var(--sl-font-mono, monospace);
    dominant-baseline: text-after-edge;
  }
`;

/**
 * One millimetre value, at one decimal and without trailing-zero noise.
 *
 * Coordinates are typed by hand, so they are whole millimetres in practice; a
 * dragged point (issue #30) will not be, and `0.30000000000000004` in a label
 * reads as a bug in the editor rather than as arithmetic.
 */
function formatMm(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** `x, y, z mm` — the frame's origin is arbitrary, so only the numbers matter. */
function formatWorld(world: WorldPoint): string {
  return `${formatMm(world.x)}, ${formatMm(world.y)}, ${formatMm(world.z)} mm`;
}

/**
 * A calibration point as a crosshair labelled with its world coordinate.
 *
 * @param point The point, in image pixels and millimetres.
 * @param index Its position in `layout.calibration.points`. Points carry no
 *   `id` — nothing references one individually — so the index is the only
 *   handle a gesture has on one, and it is rendered as `data-calibration-index`
 *   for tests and for debugging.
 * @param size Symbol size in **image pixels**, which the viewer recomputes from
 *   the viewport so the crosshair stays a constant size on screen.
 */
export function renderCalibrationPoint(
  point: CalibrationPoint,
  index: number,
  size: number
): SVGTemplateResult {
  const { x, y } = point.px;
  const arm = size / 2;
  const gap = size * 0.18;

  return svg`
    <g class="calibration-point" data-calibration-index="${index}">
      <line x1="${x - arm}" y1="${y}" x2="${x + arm}" y2="${y}" />
      <line x1="${x}" y1="${y - arm}" x2="${x}" y2="${y + arm}" />
      <circle cx="${x}" cy="${y}" r="${gap}" />
      <text x="${x + gap * 1.6}" y="${y - gap * 1.6}" font-size="${size * 0.42}">
        ${formatWorld(point.world)}
      </text>
    </g>
  `;
}
