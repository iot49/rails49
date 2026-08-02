import { STANDARD_GAUGE, STANDARD_WIDTH } from '@occupancy/config';
import type { CalibrationPoint, CarLabel, Point, Sensor } from '@occupancy/r49';

/**
 * The editor's geometry, as pure functions.
 *
 * A plain module, not an element, and deliberately outside every component:
 * jsdom neither lays out nor paints, so `getBoundingClientRect()` is all zeros
 * and SVG geometry is absent. Arithmetic left inside a Lit element is therefore
 * untestable until `@web/test-runner` is stood up; the same arithmetic here is
 * covered today. Every editor-spec ticket that draws or grabs an object reads
 * its numbers from this file.
 *
 * It is **outside** `@occupancy/r49` for the same reason `history.ts` is: that
 * package parses and serializes archives, and a grab radius is an editing
 * concept the training exporter and the Node classifier have no use for.
 *
 * @see SPEC.md § Location Data: Cars and Sensors
 */

/**
 * Track width in image pixels — which **is** DPT, and this function exists to
 * say so once.
 *
 * `DPT = px_per_mm × gauge_mm` (`@occupancy/r49`'s `getDPT`), so the number
 * already is the track gauge measured in the image's own pixels. Callers that
 * need to draw something a track wide would otherwise pass `dpt` around with a
 * comment claiming the identity, and the identity would be re-derived, or
 * doubted, at every call site.
 *
 * A **sensor** is drawn at this diameter: it is a point on the track, and the
 * only honest sense of how big it is comes from the track it sits on. It is
 * therefore a **world** size and not a screen one — it shrinks with the
 * photograph's scale, exactly as the cars around it do, which is what makes a
 * sensor's footprint comparable to a car's.
 *
 * Callers hold a DPT that may be `null` on an uncalibrated archive and must
 * resolve that first, as {@link carWidthPx} says.
 */
export function trackWidthPx(dpt: number): number {
  return dpt;
}

/**
 * Size of a screen-constant symbol, in **screen** pixels.
 *
 * Markers, crosshairs and every label are drawn this big however far the
 * photograph is zoomed — they annotate the image rather than measure it. It
 * lives here rather than in `rr-viewer` because the hit-test needs the same
 * number: a sensor with no DPT is drawn at this size, and what is drawn is what
 * must be grabbable.
 */
export const SYMBOL_SIZE_SCREEN_PX = 36;

/**
 * The diameter a sensor is **drawn** at, in image pixels — the one place that
 * decides it.
 *
 * Shared by the renderer and the hit-test on purpose. The grab radius is
 * derived from this same number, so "what I can see" and "what I can grab"
 * cannot drift apart; two independent copies of the sizing rule is exactly how
 * a symbol ends up looking bigger than it is clickable.
 *
 * One track width when the layout is calibrated. With no DPT it falls back to
 * the screen-constant size: an archive can carry sensors and no calibration —
 * deleting a calibration point is allowed at any time — and a symbol sized from
 * a number that does not exist would vanish.
 */
export function sensorDiameterPx(dpt: number | null, imagePxPerScreenPx: number): number {
  return dpt === null ? SYMBOL_SIZE_SCREEN_PX * imagePxPerScreenPx : trackWidthPx(dpt);
}

/**
 * Car width in image pixels, derived from DPT rather than stored per label.
 *
 * `DPT * STANDARD_WIDTH / STANDARD_GAUGE` — the scale ratio cancels, so a car
 * is the same 2.09 track-widths wide in every scale and **no scale lookup
 * belongs anywhere in the editor**. Both constants come from
 * `@occupancy/config`, whose authored home is `config.yaml`; reimplementing the
 * gauge arithmetic here is exactly the duplication `lib/classifier` used to
 * carry.
 *
 * The same world-size argument as {@link trackWidthPx}, one multiply along: a
 * car is drawn 2.09 track widths across, so a sensor and the car covering it
 * are directly comparable on the photograph.
 *
 * `STANDARD_WIDTH` is the widest real prototype rather than a typical one, so
 * the rectangle errs wide — the direction occupancy output deliberately errs in.
 *
 * Callers hold a DPT that may be `null` (an uncalibrated archive) and must
 * resolve that before calling: an uncalibrated layout has no car width, which
 * is why calibration gates car labeling.
 */
export function carWidthPx(dpt: number): number {
  return (dpt * STANDARD_WIDTH) / STANDARD_GAUGE;
}

/** The four corners of a car's rectangle, in polygon order starting at `p0`. */
export type CarCorners = readonly [Point, Point, Point, Point];

/**
 * The oriented rectangle a car's centerline span covers: the `p0`–`p1` chord
 * offset by *half* of {@link carWidthPx} to either side, so the rectangle is
 * one car width across.
 *
 * Returned in polygon order — `p0` side, `p1` side, `p1` other side, `p0` other
 * side — so the four points feed an SVG `polygon` directly.
 *
 * A zero-length span collapses all four corners onto the point. The first click
 * of a chain has no second point yet, so the axis is genuinely undefined;
 * picking an arbitrary one would draw a rectangle the user did not describe.
 */
export function carCorners(p0: Point, p1: Point, dpt: number): CarCorners {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return [{ ...p0 }, { ...p0 }, { ...p0 }, { ...p0 }];
  }

  // Unit normal to the span, scaled to half a car width.
  const half = carWidthPx(dpt) / 2;
  const nx = (dy / length) * half;
  const ny = (-dx / length) * half;

  return [
    { x: p0.x + nx, y: p0.y + ny },
    { x: p1.x + nx, y: p1.y + ny },
    { x: p1.x - nx, y: p1.y - ny },
    { x: p0.x - nx, y: p0.y - ny },
  ];
}

/** The image the editor draws into, in image pixels — `rr-viewer`'s `resolution`. */
export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

/** Where a symbol's text label goes, as the SVG attributes that place it. */
export interface LabelPlacement {
  readonly x: number;
  readonly y: number;
  /** `end` means the label runs leftwards from `x` — the right-edge flip. */
  readonly textAnchor: 'start' | 'end';
  /** `text-before-edge` means it hangs below `y` — the top-edge flip. */
  readonly dominantBaseline: 'text-after-edge' | 'text-before-edge';
}

/**
 * Advance width per character, as a fraction of the font size.
 *
 * Every label the editor draws is monospace (`--sl-font-mono`), where one
 * character is one advance; 0.6em is the advance of the common monospace faces
 * and errs slightly wide, which is the safe direction for a flip test.
 */
const MONOSPACE_ADVANCE_EM = 0.6;

/**
 * An **estimate** of a rendered label's width, not a measurement.
 *
 * Nothing here measures text: `measureText` and `getBBox` need layout, jsdom
 * performs none, and a placement rule that depended on them would be untestable
 * — the reason this module exists at all. So the width is derived from what is
 * known without laying anything out: the label is monospace and its content is
 * in hand, so it is character count × advance. Naming it an estimate is the
 * point — a caller must not treat the number as a box the glyphs are inside.
 */
export function estimateLabelWidthPx(text: string, fontSizePx: number): number {
  return text.length * fontSizePx * MONOSPACE_ADVANCE_EM;
}

/**
 * Where to put a symbol's label so it does not run off the frame.
 *
 * The preferred placement is **up and to the right** of the point, which is
 * what every labelled symbol in the editor uses when it has room. Near the
 * right edge the label flips to the left of the point, near the top it flips
 * below: it is drawn on the inside, where a clipped label was.
 *
 * Only the axis that overflows flips, and it flips **only when the other side
 * actually fits** — a frame narrower than the label overflows either way, and
 * flipping there would trade a clipped tail for a clipped head, losing the
 * leading digits that identify the point.
 *
 * Shared rather than inlined in a renderer because the sensor symbol (#31)
 * carries a name in the same frame against the same edges. Its geometry differs;
 * this decision does not.
 *
 * @param at The symbol's anchor, in image pixels.
 * @param text The label's exact content — the width estimate reads it.
 * @param fontSizePx Label font size in image pixels.
 * @param offsetPx Gap between the anchor and the label, on both axes.
 * @param frame The image bounds the flip is decided against.
 */
export function placeLabel(
  at: Point,
  text: string,
  fontSizePx: number,
  offsetPx: number,
  frame: FrameSize
): LabelPlacement {
  const width = estimateLabelWidthPx(text, fontSizePx);

  const overflowsRight = at.x + offsetPx + width > frame.width;
  const flipLeft = overflowsRight && at.x - offsetPx - width >= 0;

  // One line of text sits a font size above the baseline; `text-after-edge` is
  // close enough to that for a flip test, and errs tall.
  const overflowsTop = at.y - offsetPx - fontSizePx < 0;
  const flipDown = overflowsTop && at.y + offsetPx + fontSizePx <= frame.height;

  return {
    x: flipLeft ? at.x - offsetPx : at.x + offsetPx,
    y: flipDown ? at.y + offsetPx : at.y - offsetPx,
    textAnchor: flipLeft ? 'end' : 'start',
    dominantBaseline: flipDown ? 'text-before-edge' : 'text-after-edge',
  };
}

/**
 * A rectangle's extent, in whatever frame the caller is working in.
 *
 * Distinct from {@link FrameSize}, which is the image: this one measures a
 * thing placed *on* the screen, and the two are never in the same units.
 */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * Moves a box of `size` at `at` so it sits inside `viewport`, keeping `margin`
 * from every edge.
 *
 * The one piece of editor arithmetic in **screen** coordinates, because it
 * positions the context menu on the glass rather than on the photograph. It
 * lives here for the same reason everything else does — a clamp left inside a
 * Lit element is untestable, since jsdom neither lays out nor paints.
 *
 * A box larger than the viewport is pinned to the top-left margin rather than
 * pushed off the opposite edge: the head of a menu is the part worth keeping,
 * exactly as {@link placeLabel} keeps a label's leading digits.
 */
export function clampToViewport(at: Point, size: Size, viewport: Size, margin: number): Point {
  return {
    x: Math.max(margin, Math.min(at.x, viewport.width - size.width - margin)),
    y: Math.max(margin, Math.min(at.y, viewport.height - size.height - margin)),
  };
}

/** One end of one car, keyed by label `id` — never by object identity. */
export interface CarEnd {
  readonly id: string;
  readonly end: 'p0' | 'p1';
}

/**
 * What the pointer found, as the editor's own vocabulary.
 *
 * A coupler is a distinct kind because the context menu and the drag path treat
 * it differently, but every car-side hit carries the same `ends` array, so a
 * drag handler can move whatever it grabbed without narrowing the union first.
 */
export type HitTarget =
  /** A free car end. */
  | { readonly kind: 'car-endpoint'; readonly ends: readonly [CarEnd] }
  /**
   * Two or more car ends at exactly the same pixel — a coupling. Nothing about
   * it is stored; it is derived from the coincidence, and dragging it must move
   * every end listed so the train survives the edit.
   */
  | { readonly kind: 'coupler'; readonly ends: readonly [CarEnd, CarEnd, ...CarEnd[]] }
  /** A sensor, keyed by its own id — a separate namespace from label ids. */
  | { readonly kind: 'sensor'; readonly id: string }
  /**
   * A calibration point, keyed by position in `layout.calibration.points`.
   * Points carry no id because nothing references one individually.
   */
  | { readonly kind: 'calibration'; readonly index: number };

/** Everything a pointer can land on, for one image of one layout. */
export interface HitScene {
  /** The current image's car labels — cars are per-image. */
  readonly cars: readonly CarLabel[];
  /** The layout's sensors — sensors are per-layout and show on every image. */
  readonly sensors: readonly Sensor[];
  /** The layout's calibration points. */
  readonly calibrationPoints: readonly CalibrationPoint[];
  /**
   * The layout's DPT, or `null` when calibration resolves none.
   *
   * Not an object to hit: it is the **scale the world-sized objects are drawn
   * at**, and a hit-test that did not know it would grab a sensor at a radius
   * unrelated to the one on screen. It belongs to the scene rather than to the
   * tolerance because it describes the layout, not the pointing device.
   */
  readonly dpt: number | null;
}

/**
 * How close counts as a hit.
 *
 * The radius is expressed in **screen** pixels, because a grab radius is a
 * property of the finger and the mouse, not of the photograph: an 8-megapixel
 * image and a 720p one must feel identical. `imagePxPerScreenPx` converts it —
 * `rr-viewer` puts the current factor in every pointer event's detail.
 */
export interface HitTolerance {
  /** Grab radius, in screen pixels. */
  readonly screenPx: number;
  /** Image pixels per screen pixel, from the viewer's pointer event. */
  readonly imagePxPerScreenPx: number;
}

/**
 * The grab radius every editor tool uses, in **screen** pixels.
 *
 * One number rather than one per tool: the radius describes the pointing
 * device, and a sensor that grabs at a different distance than a calibration
 * point would feel like a bug. Sized for a fingertip on the phone the labeling
 * is done on, not for a mouse.
 *
 * It is a **floor, not a cap**. An object drawn larger than this is grabbable
 * across what is drawn — see {@link hitTest} — because the visible symbol is
 * the editor's promise about where the object is, and a symbol wider than its
 * own hit area breaks that promise the first time a click on it misses. The
 * floor is what keeps the promise from shrinking below a fingertip when the
 * object itself is tiny.
 */
export const DEFAULT_GRAB_RADIUS_SCREEN_PX = 14;

/**
 * How far a pointer may travel between press and release and still be a click,
 * in **screen** pixels.
 *
 * Smaller than the grab radius: this is hand tremor, not aim. Without it every
 * swipe over the image is a click, and the labeling device is a phone.
 */
export const CLICK_SLOP_SCREEN_PX = 5;

/**
 * Whether a gesture that started at `from` and ended at `to` is a click.
 *
 * Expressed as a distance in screen pixels, like every other tolerance here,
 * and evaluated against the same `HitTolerance` shape so the conversion happens
 * in one place. A gesture that is not a click is a drag — which nothing acts on
 * yet.
 */
export function isClick(from: Point, to: Point, tolerance: HitTolerance): boolean {
  const reach = tolerance.screenPx * tolerance.imagePxPerScreenPx;
  return (to.x - from.x) ** 2 + (to.y - from.y) ** 2 <= reach * reach;
}

/**
 * Rank used only to break an exact distance tie, densest geometry first.
 *
 * Couplers are absent because they are never candidates: a coincidence is
 * recognised after the nearest car end has already won.
 */
const KIND_RANK: Record<'car-endpoint' | 'sensor' | 'calibration', number> = {
  'car-endpoint': 0,
  sensor: 1,
  calibration: 2,
};

/** What can be *found* directly. A coupler is derived, never a candidate. */
type CandidateTarget = Extract<HitTarget, { kind: keyof typeof KIND_RANK }>;

interface Candidate {
  readonly target: CandidateTarget;
  readonly at: Point;
  readonly distanceSq: number;
}

/**
 * The object under `at`, or `null` when nothing is within the tolerance.
 *
 * **Nearest wins**, whatever its kind; an exact tie goes to the denser geometry
 * (car ends, then sensors, then calibration points). Only handles are hit — the
 * body of a car is not grabbable, because the only edits a span supports are to
 * its two ends.
 *
 * **A sensor is grabbable across the whole symbol**, not just at its centre.
 * Every other target is a point wearing an annotation, so the pointing device's
 * radius is the whole story; a sensor is a drawn *footprint* one track wide,
 * and a symbol visibly larger than its own hit area reads as a bug the first
 * time a click on it misses. Its reach is therefore the larger of the two —
 * never smaller, so a sensor on a distant track stays as easy to hit as
 * anything else. Being a circle of the diamond's half-diagonal, it also extends
 * a little past the diamond's edges, which is the forgiving direction.
 *
 * Coincidence for couplers is **exact equality**, not a tolerance: chaining and
 * the shared handle both write the identical value to every end they join, so
 * anything that merely looks close is two objects the user placed separately,
 * and fusing them would move geometry they never joined.
 */
export function hitTest(scene: HitScene, at: Point, tolerance: HitTolerance): HitTarget | null {
  const pointerReach = tolerance.screenPx * tolerance.imagePxPerScreenPx;
  const sensorReach = Math.max(
    pointerReach,
    sensorDiameterPx(scene.dpt, tolerance.imagePxPerScreenPx) / 2
  );

  const candidates: Candidate[] = [];
  const push = (target: CandidateTarget, point: Point, reach: number) => {
    const distanceSq = (point.x - at.x) ** 2 + (point.y - at.y) ** 2;
    if (distanceSq <= reach * reach) candidates.push({ target, at: point, distanceSq });
  };

  for (const label of scene.cars) {
    push({ kind: 'car-endpoint', ends: [{ id: label.id, end: 'p0' }] }, label.p0, pointerReach);
    push({ kind: 'car-endpoint', ends: [{ id: label.id, end: 'p1' }] }, label.p1, pointerReach);
  }
  for (const s of scene.sensors) {
    push({ kind: 'sensor', id: s.id }, { x: s.x, y: s.y }, sensorReach);
  }
  scene.calibrationPoints.forEach((p, index) => {
    push({ kind: 'calibration', index }, p.px, pointerReach);
  });

  let best: Candidate | null = null;
  for (const candidate of candidates) {
    if (
      best === null ||
      candidate.distanceSq < best.distanceSq ||
      (candidate.distanceSq === best.distanceSq &&
        KIND_RANK[candidate.target.kind] < KIND_RANK[best.target.kind])
    ) {
      best = candidate;
    }
  }
  if (best === null) return null;
  if (best.target.kind !== 'car-endpoint') return best.target;

  // A car end that shares its exact pixel with another is a coupling.
  const ends = coincidentEnds(scene.cars, best.at);
  return ends.length > 1
    ? { kind: 'coupler', ends: ends as [CarEnd, CarEnd, ...CarEnd[]] }
    : best.target;
}

/**
 * What a drag handle addresses in the manifest.
 *
 * Keyed the way the rest of the editor keys — label `id` for a car, sensor `id`,
 * position for a calibration point, which carries no id because nothing
 * references one individually. **Never an object reference**: applying a history
 * snapshot replaces the objects wholesale.
 */
export type HandleRef =
  | { readonly kind: 'calibration'; readonly index: number }
  | { readonly kind: 'car-end'; readonly id: string; readonly end: 'p0' | 'p1' }
  | { readonly kind: 'sensor'; readonly id: string };

/** One point a drag moves, and where it sat when the gesture began. */
export interface DragHandle {
  readonly ref: HandleRef;
  /**
   * Position at pointer-down. Deltas apply to **this**, not to the live value:
   * accumulating them onto the current position drifts under rounding, and
   * snapping the object to the pointer instead would discard the grab offset.
   */
  readonly from: Point;
}

/**
 * The handles a grab moves — one per object, and **more than one for a
 * coupler**.
 *
 * This is where a drag stops being about the thing under the cursor and becomes
 * a list, which is what lets one history entry cover several objects: a coupler
 * drag moves both cars' ends by the same delta, and dropping either one would
 * silently uncouple the train. A handle whose object is not in the scene is
 * dropped rather than faked.
 */
export function dragHandles(hit: HitTarget, scene: HitScene): readonly DragHandle[] {
  switch (hit.kind) {
    case 'calibration': {
      const point = scene.calibrationPoints[hit.index];
      return point ? [{ ref: { kind: 'calibration', index: hit.index }, from: point.px }] : [];
    }
    case 'sensor': {
      const found = scene.sensors.find((s) => s.id === hit.id);
      return found ? [{ ref: { kind: 'sensor', id: hit.id }, from: { x: found.x, y: found.y } }] : [];
    }
    case 'car-endpoint':
    case 'coupler': {
      const handles: DragHandle[] = [];
      for (const end of hit.ends) {
        const label = scene.cars.find((c) => c.id === end.id);
        if (label) handles.push({ ref: { kind: 'car-end', ...end }, from: label[end.end] });
      }
      return handles;
    }
  }
}

/**
 * Where a handle lands for a given drag delta, in whole image pixels.
 *
 * Rounded because a handle names a pixel, and applied to `from` so every handle
 * in one gesture takes the identical translation — which is what keeps a
 * coupler's two ends on the *same* pixel, and a coupling is exact coincidence.
 */
export function dragTo(handle: DragHandle, delta: Point): Point {
  return { x: Math.round(handle.from.x + delta.x), y: Math.round(handle.from.y + delta.y) };
}

/**
 * Every pixel where two or more car ends meet — the couplings of a scene,
 * derived rather than read, because nothing about a coupling is stored.
 *
 * The renderer's half of what {@link hitTest} answers for the pointer, and by
 * the same rule: **exact coincidence**, never proximity. That shared rule is
 * what makes the shared handle honest — the one place a click lands on two
 * cars is the one place one handle is drawn.
 *
 * Each coupling appears **once**, however many ends meet there, which is what
 * "renders as one shared handle" comes down to. In scene order, so a chained
 * train's couplings come back in the order it was authored.
 *
 * A car whose two ends are the same pixel counts as a coupling of itself: there
 * is one point on screen, so there is one handle. The editor refuses to author
 * such a car, so it can only arrive from outside.
 */
export function couplerPoints(cars: readonly CarLabel[]): readonly Point[] {
  const seen = new Map<string, { readonly at: Point; ends: number }>();
  for (const car of cars) {
    for (const end of [car.p0, car.p1]) {
      const key = `${end.x},${end.y}`;
      const found = seen.get(key);
      if (found) found.ends += 1;
      else seen.set(key, { at: { x: end.x, y: end.y }, ends: 1 });
    }
  }
  return [...seen.values()].filter(entry => entry.ends > 1).map(entry => entry.at);
}

/**
 * Whether two pixels are the same pixel.
 *
 * The **one** encoding of the coincidence rule, shared by everything that has
 * to agree on what a coupling is: the hit-test, the renderer's list, and the
 * staleness guards. Exact, never a tolerance — see {@link hitTest}.
 */
export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Whether `at` is exactly one of `points` — how a renderer asks whether an end
 * is coupled, against the list {@link couplerPoints} returned.
 */
export function isCoincident(at: Point, points: readonly Point[]): boolean {
  return points.some(point => samePoint(point, at));
}

/**
 * Which of a car's ends are coupled, and so are drawn once as a shared handle
 * rather than twice as two ends.
 *
 * Here rather than in the renderer that needs it, like every other piece of
 * editor geometry: a coupling is a property of the *scene*, and one car cannot
 * see it on its own.
 */
export interface CoupledEnds {
  readonly p0: boolean;
  readonly p1: boolean;
}

/** {@link CoupledEnds} for one car, against the scene's {@link couplerPoints}. */
export function coupledEnds(car: CarLabel, couplers: readonly Point[]): CoupledEnds {
  return { p0: isCoincident(car.p0, couplers), p1: isCoincident(car.p1, couplers) };
}

/** Which way one point lies from another, to the nearest quarter turn. */
export type CardinalDirection = 'left' | 'right' | 'up' | 'down';

/**
 * The direction of `to` seen from `from`, as a word — or `null` when the two
 * are the same point and there is no direction to name.
 *
 * It exists for the **coupler's context menu**: the rows there act on one of
 * two cars that meet at the identical pixel, and cars carry no name, so the
 * only thing that tells them apart is which way each one runs. Two cars
 * coupled end to end run in opposite directions from the coupling, and
 * opposite vectors always land in opposite quarters — so the two rows can never
 * read the same, which is the property the menu needs.
 *
 * **`y` grows downwards**, as it does everywhere in image pixels: a smaller `y`
 * is `up`. An exact diagonal resolves horizontally rather than being called a
 * tie, because a tie would have to be broken twice and could name both cars the
 * same way.
 */
export function cardinalDirection(from: Point, to: Point): CardinalDirection | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** Every car end sitting exactly on `at`, in scene order. */
function coincidentEnds(cars: readonly CarLabel[], at: Point): CarEnd[] {
  const ends: CarEnd[] = [];
  for (const label of cars) {
    if (samePoint(label.p0, at)) ends.push({ id: label.id, end: 'p0' });
    if (samePoint(label.p1, at)) ends.push({ id: label.id, end: 'p1' });
  }
  return ends;
}
