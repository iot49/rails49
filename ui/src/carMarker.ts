import { svg, css } from 'lit';
import type { SVGTemplateResult, CSSResult } from 'lit';
import type { CarLabel } from '@occupancy/r49';
import { carCorners } from './geometry.js';

/**
 * Car rendering for SVG: the chord between the two clicked ends, the
 * translucent width rectangle derived from DPT, and a handle at each end.
 *
 * A module rather than a custom element, like `marker.ts`, `calibrationMarker.ts`
 * and `sensorMarker.ts` — custom elements break the SVG namespace when nested
 * inside `<svg>`. Its two exports **must be used together**: `carMarkerStyles`
 * in the host's `static styles`, `renderCar` once per label.
 *
 * **The rectangle is the reason the car tool is gated on calibration.** A car
 * is two free clicks on the visible ends (`SPEC.md` § Authoring cars), and
 * nothing about those two clicks says whether the label actually covers the
 * car — the width does, and the width is *derived* from DPT rather than stored
 * (2.09 track widths, in every scale). Drawing it is therefore not decoration:
 * it is the only feedback the labeler gets.
 *
 * Magenta, against the calibration crosshair's cyan and the sensor diamond's
 * amber. The three objects are authored by three tools and mean three different
 * things, so `SPEC.md` § Reference points' requirement that they be
 * unmistakable extends to this one — and the colour is picked to be rare in a
 * photograph of a layout, where green foliage and amber ballast are not.
 */

export const carMarkerStyles: CSSResult = css`
  .car {
    /* One literal for the whole symbol, for the same reason the crosshair and
       the diamond each have one: this is ink on an arbitrary photograph rather
       than chrome, and it has to stay legible over both a dark tunnel mouth and
       a bright backdrop. */
    --car-ink: #f472b6;
  }

  .car polygon {
    stroke: var(--car-ink);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
    /* Translucent, and that is the requirement rather than a taste: the
       rectangle is read *against the car underneath it*, which is how a labeler
       tells a label that covers the car from one that does not. */
    fill: rgba(244, 114, 182, 0.16);
  }

  .car line {
    stroke: var(--car-ink);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }

  .car circle {
    fill: var(--car-ink);
    stroke: rgba(0, 0, 0, 0.75);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }
`;

/**
 * How big to draw a car — **one world size and one screen size**, exactly as
 * `SensorSymbolSize` splits them.
 *
 * The rectangle is a world size and is not passed as a width: it is passed as
 * the **DPT it is derived from**, because that derivation is the invariant
 * (`geometry.ts` § `carWidthPx`) and a caller handing over a width would be a
 * second place the 2.09 could be got wrong. `null` is a real state — a
 * calibration point can be deleted at any time, and the cars already labelled
 * have to stay on screen — and it means no rectangle, since there is then no
 * width to claim.
 *
 * The handles are a screen size: they are where the user grabs, and a grab
 * target belongs to the pointing device rather than to the photograph.
 */
export interface CarSymbolSize {
  /** The layout's DPT, or `null` when calibration resolves none. */
  readonly dpt: number | null;
  /** Endpoint handle diameter, constant on screen at any zoom. */
  readonly handlePx: number;
}

/**
 * A car as its chord, its width rectangle, and a handle at each end.
 *
 * The group carries `data-label-id` rather than an index: labels are keyed by
 * `id` throughout the editor, because applying a history snapshot replaces the
 * objects wholesale (`SPEC.md` § Undo and redo).
 *
 * A **coupling** needs nothing here. It is two ends at the identical pixel, so
 * the two handles are drawn on top of each other and read as the one shared
 * handle they are; nothing about the coupling is stored, and nothing about it
 * is rendered specially.
 *
 * @param car The label, in image pixels.
 * @param size The DPT the rectangle is derived from, and the handle size — see
 *   {@link CarSymbolSize}.
 */
export function renderCar(car: CarLabel, size: CarSymbolSize): SVGTemplateResult {
  const { p0, p1 } = car;
  const corners = size.dpt === null ? null : carCorners(p0, p1, size.dpt);
  const handle = size.handlePx / 2;

  return svg`
    <g class="car" data-label-id="${car.id}">
      ${
        corners
          ? svg`<polygon points="${corners.map(c => `${c.x},${c.y}`).join(' ')}" />`
          : ''
      }
      <line x1="${p0.x}" y1="${p0.y}" x2="${p1.x}" y2="${p1.y}" />
      <circle cx="${p0.x}" cy="${p0.y}" r="${handle}" />
      <circle cx="${p1.x}" cy="${p1.y}" r="${handle}" />
    </g>
  `;
}
