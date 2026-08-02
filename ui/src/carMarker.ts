import { svg, css } from 'lit';
import type { SVGTemplateResult, CSSResult } from 'lit';
import type { CarLabel, Point } from '@occupancy/r49';
import { carCorners, placeLabel } from './geometry.js';
import type { CoupledEnds, FrameSize } from './geometry.js';

/**
 * Car rendering for SVG: the chord between the two clicked ends, the
 * translucent width rectangle derived from DPT, and a handle at each end.
 *
 * A module rather than a custom element, like `marker.ts`, `calibrationMarker.ts`
 * and `sensorMarker.ts` — custom elements break the SVG namespace when nested
 * inside `<svg>`. Its exports **must be used together**: `carMarkerStyles` in
 * the host's `static styles`, `renderCar` once per label, `renderCoupler` once
 * per coupling and `renderPendingCar` for the chain in flight.
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
  .car,
  .coupler,
  .car-pending {
    /* One literal for the whole symbol, for the same reason the crosshair and
       the diamond each have one: this is ink on an arbitrary photograph rather
       than chrome, and it has to stay legible over both a dark tunnel mouth and
       a bright backdrop. The coupler and the band in flight are the same ink
       because they are the same object at a different moment. */
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

  /* A coupling reads as a joint rather than as an end: the same ink, a wider
     ring, and a light outline so it stays visible where two cars overlap. */
  .coupler circle {
    fill: var(--car-ink);
    stroke: rgba(255, 255, 255, 0.9);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }

  /* The band in flight is dashed, so a chain in progress is never mistaken for
     a car that has been written. Nothing about it is in the manifest. */
  .car-pending polygon,
  .car-pending line {
    stroke: var(--car-ink);
    stroke-width: 1.5;
    stroke-dasharray: 8 6;
    vector-effect: non-scaling-stroke;
    fill: none;
  }

  .car-pending circle {
    fill: var(--car-ink);
    stroke: rgba(0, 0, 0, 0.75);
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  /* A class the authored vocabulary does not name. Red rather than the car's
     magenta, and the whole symbol changes colour rather than gaining a badge:
     the label is *wrong*, not annotated, and the thing that has to be findable
     on a photograph of a whole layout is the car. One override of the ink
     literal recolours the chord, the rectangle and the handles together. */
  .car.unknown-class {
    --car-ink: #ef4444;
  }

  .car text {
    fill: var(--car-ink);
    /* The photograph underneath is arbitrary, so the label carries its own
       contrast rather than relying on what it happens to sit on — the same
       reason the sensor's name does. */
    stroke: rgba(0, 0, 0, 0.75);
    stroke-width: 3;
    paint-order: stroke;
    /* Monospace is what makes the label's width estimable without measuring
       it — placeLabel counts characters. */
    font-family: var(--sl-font-mono, monospace);
    /* text-anchor and dominant-baseline are set per element by the edge flip. */
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
  /** Warning label font size, constant on screen at any zoom. */
  readonly labelPx: number;
}

/** A car with two free ends — the shape of a car that is not in a train. */
const NO_COUPLED_ENDS: CoupledEnds = { p0: false, p1: false };

/**
 * A car whose stored `class` names no entry of the authored vocabulary.
 *
 * `class` is a plain string at the format layer and deliberately unvalidated at
 * parse time (`SPEC.md` § Format), so a pruned or mistyped class opens fine and
 * has to be **visible** instead — a class that matches no entry of
 * `detector.classes` is dropped from the training export, which is the
 * unlabeled-car-as-background failure the completeness rule exists to prevent.
 *
 * The caller decides *what* is wrong and this module decides how it looks —
 * `text` is the offending class rather than a sentence, because a typo is the
 * likely cause and the labeler needs to read it.
 */
export interface CarWarning {
  /** The offending class, drawn beside the car. */
  readonly text: string;
  /** The image bounds, so the label flips inwards at an edge. */
  readonly frame: FrameSize;
}


/**
 * A car as its chord, its width rectangle, and a handle at each free end.
 *
 * The group carries `data-label-id` rather than an index: labels are keyed by
 * `id` throughout the editor, because applying a history snapshot replaces the
 * objects wholesale (`SPEC.md` § Undo and redo).
 *
 * A **coupled** end draws no handle here. The coupling renders as *one* shared
 * handle (#33) and this is the half of that which stays out of its way: two
 * circles stacked on the same pixel would only ever look like one, and would
 * leave the shared handle unable to say it is shared. Nothing about the
 * coupling is stored either way — it is the coincidence, and
 * {@link renderCoupler} draws what the coincidence means.
 *
 * A car whose class the vocabulary does not name draws in the warning ink and
 * carries the offending class as a label — see {@link CarWarning}. It is still
 * a car, drawn whole: the archive opens, and hiding the label would hide the
 * one thing that needs fixing.
 *
 * @param car The label, in image pixels.
 * @param size The DPT the rectangle is derived from, and the handle size — see
 *   {@link CarSymbolSize}.
 * @param coupled Which ends a shared handle covers. Both free by default.
 * @param warning The non-conformance to show, or `null` when the class is one
 *   the authored vocabulary names.
 */
export function renderCar(
  car: CarLabel,
  size: CarSymbolSize,
  coupled: CoupledEnds = NO_COUPLED_ENDS,
  warning: CarWarning | null = null
): SVGTemplateResult {
  const { p0, p1 } = car;
  const corners = size.dpt === null ? null : carCorners(p0, p1, size.dpt);
  const handle = size.handlePx / 2;

  return svg`
    <g class="car ${warning ? 'unknown-class' : ''}" data-label-id="${car.id}">
      ${
        corners
          ? svg`<polygon points="${corners.map(c => `${c.x},${c.y}`).join(' ')}" />`
          : ''
      }
      <line x1="${p0.x}" y1="${p0.y}" x2="${p1.x}" y2="${p1.y}" />
      ${coupled.p0 ? '' : svg`<circle cx="${p0.x}" cy="${p0.y}" r="${handle}" />`}
      ${coupled.p1 ? '' : svg`<circle cx="${p1.x}" cy="${p1.y}" r="${handle}" />`}
      ${warning ? renderWarningLabel(car, size, warning) : ''}
    </g>
  `;
}

/**
 * The offending class, drawn beside the car's midpoint.
 *
 * The midpoint rather than an end, because a car is identified by the span
 * rather than by either end, and an end may be a coupling shared with a
 * neighbour whose own label would then sit on top of this one. The size is a
 * **screen** size like every other annotation here: it is text about the car,
 * not a measurement of it.
 */
function renderWarningLabel(
  car: CarLabel,
  size: CarSymbolSize,
  warning: CarWarning
): SVGTemplateResult {
  const mid = { x: (car.p0.x + car.p1.x) / 2, y: (car.p0.y + car.p1.y) / 2 };
  // Marked as a warning, and then the class itself: a typo is the likely cause.
  const text = `⚠ ${warning.text}`;
  const placement = placeLabel(mid, text, size.labelPx, size.labelPx * 0.7, warning.frame);

  return svg`
    <text
      x="${placement.x}"
      y="${placement.y}"
      text-anchor="${placement.textAnchor}"
      dominant-baseline="${placement.dominantBaseline}"
      font-size="${size.labelPx}"
    >
      ${text}
    </text>
  `;
}

/**
 * How much wider a coupling's handle is than a free end's.
 *
 * It covers two cars' ends and drags both, so it is the one grab target on the
 * overlay that is worth more than the object under it — and it has to be
 * recognisable *as* a coupling from across the frame, since that is the only
 * confirmation a labeler gets that a chain actually joined.
 */
const COUPLER_HANDLE_RATIO = 1.5;

/**
 * The one shared handle a coupling renders as.
 *
 * Drawn once per coincident pixel however many car ends meet there, which is
 * the whole claim: dragging it moves every end it covers, as one history entry,
 * so a train survives editing (`SPEC.md` § Authoring cars). It is a **screen**
 * size like the handles it replaces — it is where the pointer grabs, and a grab
 * target belongs to the pointing device rather than to the photograph.
 *
 * @param at The shared pixel, from `geometry.ts`'s `couplerPoints`.
 * @param size The same sizes the cars around it are drawn at.
 */
export function renderCoupler(at: Point, size: CarSymbolSize): SVGTemplateResult {
  return svg`
    <g class="coupler">
      <circle cx="${at.x}" cy="${at.y}" r="${(size.handlePx / 2) * COUPLER_HANDLE_RATIO}" />
    </g>
  `;
}

/**
 * The chain in flight: an anchor, and where the next click would put the far
 * end of the car.
 *
 * View state and never a label — nothing here is in the manifest, and an
 * abandoned chain leaves it untouched (`SPEC.md` § Undo and redo).
 */
export interface PendingCar {
  /** The end already clicked — the last click of the chain, or its first. */
  readonly anchor: Point;
  /** Where the pointer is now, in image pixels. Equals `anchor` before it moves. */
  readonly to: Point;
}

/**
 * The rubber band: the car the next click would write, drawn dashed.
 *
 * It is what makes a live chain visible, and that visibility is what pays for
 * right-click and undo meaning something different while one is in progress
 * (`SPEC.md` § Right-click is state-dependent). So it draws the whole car it
 * would commit — the chord *and* the derived width rectangle — rather than a
 * bare line: the rectangle is the only feedback that a label covers the car,
 * and seeing it before the click is worth more than seeing it after.
 *
 * The anchor keeps a handle even when the band has no length, so the first
 * click of a chain shows where it landed. The rectangle collapses onto the
 * point until the pointer moves, because a span with no length has no axis.
 */
export function renderPendingCar(pending: PendingCar, size: CarSymbolSize): SVGTemplateResult {
  const { anchor, to } = pending;
  const corners = size.dpt === null ? null : carCorners(anchor, to, size.dpt);

  return svg`
    <g class="car-pending">
      ${
        corners
          ? svg`<polygon points="${corners.map(c => `${c.x},${c.y}`).join(' ')}" />`
          : ''
      }
      <line x1="${anchor.x}" y1="${anchor.y}" x2="${to.x}" y2="${to.y}" />
      <circle cx="${anchor.x}" cy="${anchor.y}" r="${size.handlePx / 2}" />
    </g>
  `;
}
