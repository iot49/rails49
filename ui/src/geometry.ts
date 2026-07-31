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
 * Car width in image pixels, derived from DPT rather than stored per label.
 *
 * `DPT * STANDARD_WIDTH / STANDARD_GAUGE` — the scale ratio cancels, so a car
 * is the same 2.09 track-widths wide in every scale and **no scale lookup
 * belongs anywhere in the editor**. Both constants come from
 * `@occupancy/config`, whose authored home is `config.yaml`; reimplementing the
 * gauge arithmetic here is exactly the duplication `lib/classifier` used to
 * carry.
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
 * Coincidence for couplers is **exact equality**, not a tolerance: chaining and
 * the shared handle both write the identical value to every end they join, so
 * anything that merely looks close is two objects the user placed separately,
 * and fusing them would move geometry they never joined.
 */
export function hitTest(scene: HitScene, at: Point, tolerance: HitTolerance): HitTarget | null {
  const reach = tolerance.screenPx * tolerance.imagePxPerScreenPx;
  const reachSq = reach * reach;

  const candidates: Candidate[] = [];
  const push = (target: CandidateTarget, point: Point) => {
    const distanceSq = (point.x - at.x) ** 2 + (point.y - at.y) ** 2;
    if (distanceSq <= reachSq) candidates.push({ target, at: point, distanceSq });
  };

  for (const label of scene.cars) {
    push({ kind: 'car-endpoint', ends: [{ id: label.id, end: 'p0' }] }, label.p0);
    push({ kind: 'car-endpoint', ends: [{ id: label.id, end: 'p1' }] }, label.p1);
  }
  for (const s of scene.sensors) {
    push({ kind: 'sensor', id: s.id }, { x: s.x, y: s.y });
  }
  scene.calibrationPoints.forEach((p, index) => {
    push({ kind: 'calibration', index }, p.px);
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

/** Every car end sitting exactly on `at`, in scene order. */
function coincidentEnds(cars: readonly CarLabel[], at: Point): CarEnd[] {
  const ends: CarEnd[] = [];
  for (const label of cars) {
    if (label.p0.x === at.x && label.p0.y === at.y) ends.push({ id: label.id, end: 'p0' });
    if (label.p1.x === at.x && label.p1.y === at.y) ends.push({ id: label.id, end: 'p1' });
  }
  return ends;
}
