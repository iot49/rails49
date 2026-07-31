import { svg, css } from 'lit';
import type { SVGTemplateResult, CSSResult } from 'lit';
import type { Sensor } from '@occupancy/r49';
import { placeLabel } from './geometry.js';
import type { FrameSize } from './geometry.js';

/**
 * Sensor rendering for SVG: a ringed diamond labelled with its name, or with
 * its id when it has none.
 *
 * A module rather than a custom element, like `marker.ts` and
 * `calibrationMarker.ts` — custom elements break the SVG namespace when nested
 * inside `<svg>`. `sensorMarkerStyles` and `renderSensor` **must be used
 * together**: the styles in the host's `static styles`, the renderer once per
 * sensor. `sensorLabelText` is separable — it answers what a sensor is called,
 * which a consumer may want without drawing anything.
 *
 * **The symbol is deliberately unlike the calibration crosshair** in shape and
 * in colour: `SPEC.md` § Reference points requires calibration points to be
 * placed with a tool distinct from the sensor tool and to be visually
 * unmistakable from one. A crosshair is two crossing arms in cyan; a sensor is a
 * closed amber diamond, so the two are told apart at a glance and by shape alone
 * on a photograph that happens to be cyan or amber.
 *
 * The diamond is also honest about what a sensor *is*: a single query point
 * (`SPEC.md` § Location Data), so the symbol closes around the pixel it names
 * rather than extending arms that could be read as an extent.
 */

export const sensorMarkerStyles: CSSResult = css`
  .sensor {
    /* One literal for the whole symbol, for the same reason the crosshair has
       one: this is ink on an arbitrary photograph rather than chrome, and it
       must stay legible over both a dark tunnel mouth and a bright backdrop.
       Amber against the crosshair's cyan — the two symbols never read as the
       same object. */
    --sensor-ink: #f59e0b;
  }

  .sensor polygon {
    stroke: var(--sensor-ink);
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
    /* Translucent rather than hollow: the fill is what makes the diamond read
       as one closed symbol at thumbnail size, and it still shows the track
       underneath, which is what the sensor is placed against. */
    fill: rgba(245, 158, 11, 0.18);
  }

  .sensor circle {
    fill: var(--sensor-ink);
    stroke: none;
  }

  .sensor text {
    fill: var(--sensor-ink);
    /* The photograph underneath is arbitrary, so the label carries its own
       contrast rather than relying on what it happens to sit on. */
    stroke: rgba(0, 0, 0, 0.75);
    stroke-width: 3;
    paint-order: stroke;
    /* Monospace is what makes the label's width estimable without measuring
       it — placeLabel counts characters. Changing this face changes what the
       edge flip is deciding against. */
    font-family: var(--sl-font-mono, monospace);
    /* text-anchor and dominant-baseline are deliberately absent: the edge flip
       sets both per element, and a rule here would beat the presentation
       attribute and pin every label to one corner. */
  }
`;

/**
 * What a sensor is labelled with: its `name`, or its `id` when it has none.
 *
 * `name` is optional, free text, not unique, and **never auto-generated**;
 * consumers key on `id` (`SPEC.md` § Occupancy Output). So the fallback is the
 * id itself rather than an invented "Sensor 3", which would be indistinguishable
 * from a name a human chose and would silently stop matching as sensors come and
 * go. A blank or whitespace-only name is treated as no name — it identifies
 * nothing, and showing it would leave the symbol looking unlabelled.
 */
export function sensorLabelText(sensor: Sensor): string {
  const name = sensor.name?.trim();
  return name ? name : sensor.id;
}

/**
 * A sensor as a ringed diamond labelled with its name or id.
 *
 * @param sensor The sensor, in image pixels.
 * @param size Symbol size in **image pixels**, which the viewer recomputes from
 *   the viewport so the diamond stays a constant size on screen.
 * @param frame The image's bounds, `rr-viewer`'s `resolution`. Only the label
 *   reads it, to flip inwards at an edge instead of being clipped; the diamond
 *   is drawn on its pixel wherever that pixel is.
 */
export function renderSensor(sensor: Sensor, size: number, frame: FrameSize): SVGTemplateResult {
  const { x, y } = sensor;
  const arm = size / 2;
  const core = size * 0.12;

  const label = sensorLabelText(sensor);
  const fontSize = size * 0.42;
  // Up and to the right when there is room, flipped inwards at the top or
  // right edge — the same rule the crosshair's label follows, because the
  // decision belongs to the frame rather than to the symbol. See `placeLabel`.
  const placement = placeLabel({ x, y }, label, fontSize, size * 0.29, frame);

  return svg`
    <g class="sensor" data-sensor-id="${sensor.id}">
      <polygon points="${x},${y - arm} ${x + arm},${y} ${x},${y + arm} ${x - arm},${y}" />
      <circle cx="${x}" cy="${y}" r="${core}" />
      <text
        x="${placement.x}"
        y="${placement.y}"
        text-anchor="${placement.textAnchor}"
        dominant-baseline="${placement.dominantBaseline}"
        font-size="${fontSize}"
      >
        ${label}
      </text>
    </g>
  `;
}
