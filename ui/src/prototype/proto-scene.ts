// PROTOTYPE — throwaway. Wayfinder ticket #5 (labeling-mode interaction design).
// Not production code. No tests, no error handling, no persistence.
//
// An in-memory sketch of the v4 geometry model, layered over a real v3 archive:
// images and calibration are carried forward, v3 point labels are dropped
// (map decision 4/5 — clean break, one-way lossy import).
//
// The real v4 schema is ticket #8's job. Nothing here pins it.

import { getDPT } from '@occupancy/r49';
import type { ManifestData, Point } from '@occupancy/r49';

// ---------------------------------------------------------------------------
// Geometry — three kinds, differing in scope and in whether a model sees them
// ---------------------------------------------------------------------------

/** How a label came to exist (map decision 12). Prototyped so the badges can be judged. */
export type Provenance = 'human' | 'proposed' | 'corrected';

/** Track: a spline, authored once per layout, never trained on. */
export interface TrackSpline {
  id: string;
  /** Control points in image pixels. Rendered as a Catmull-Rom spline. */
  points: Point[];
  provenance: Provenance;
}

/** Car: two endpoints over the track centerline, per image, the detector's only class. */
export interface CarSpan {
  id: string;
  /** Dotted class string (map decision 7). `stock`, `stock.loco.steam`, ... */
  cls: string;
  p0: Point;
  p1: Point;
  provenance: Provenance;
}

/** Sensor: a query point, per layout, an output specification that never enters a loss. */
export interface Sensor {
  id: string;
  x: number;
  y: number;
  name?: string;
}

export interface Calibration {
  p0: Point;
  p1: Point;
  size_mm: number;
}

export interface ImageState {
  filename: string;
  url: string;
  cars: CarSpan[];
  /** Only complete images are exported for training (map decision 8, narrowed). */
  complete: boolean;
}

export interface Scene {
  layoutName: string;
  scale: string;
  resolution: { width: number; height: number };
  calibration: Calibration | null;
  /** Layout-scoped. */
  track: TrackSpline[];
  /** Layout-scoped. */
  sensors: Sensor[];
  /** Image-scoped. */
  images: ImageState[];
}

// ---------------------------------------------------------------------------
// Class taxonomy — decision 7. Dotted strings, valid set would live in config.yaml.
// ---------------------------------------------------------------------------

export const CAR_CLASSES = [
  'stock',
  'stock.loco',
  'stock.loco.steam',
  'stock.loco.diesel',
  'stock.freight',
  'stock.passenger',
] as const;

/** Leaf name of a dotted class, for compact display. */
export function classLeaf(cls: string): string {
  const parts = cls.split('.');
  return parts[parts.length - 1] ?? cls;
}

// ---------------------------------------------------------------------------
// Scale geometry — widths are derived, never stored (map decision 6)
// ---------------------------------------------------------------------------

/** Prototype rolling-stock width in mm, against the 1435 mm prototype gauge. */
const STOCK_WIDTH_MM = 2800;
const PROTOTYPE_GAUGE_MM = 1435;

export interface Widths {
  /** Dots per track width. Null when the layout is uncalibrated. */
  dpt: number | null;
  /** Rendered width of a car span, in image pixels. Null when uncalibrated. */
  carPx: number | null;
  /** Rendered width of track, in image pixels. Null when uncalibrated. */
  trackPx: number | null;
}

export function widthsFor(manifest: ManifestData): Widths {
  const dpt = getDPT(manifest);
  if (dpt === null) return { dpt: null, carPx: null, trackPx: null };
  return {
    dpt,
    carPx: dpt * (STOCK_WIDTH_MM / PROTOTYPE_GAUGE_MM),
    trackPx: dpt,
  };
}

// ---------------------------------------------------------------------------
// Import — v3 archive in, v4 scene out
// ---------------------------------------------------------------------------

let seq = 0;
export function protoId(prefix: string): string {
  seq += 1;
  return `${prefix}${seq}`;
}

export function sceneFromManifest(
  manifest: ManifestData,
  urls: Map<string, string>,
): Scene {
  return {
    layoutName: manifest.layout.name ?? 'Untitled',
    scale: manifest.layout.scale ?? 'HO',
    resolution: manifest.camera.resolution ?? { width: 1920, height: 1080 },
    calibration: (manifest.layout.calibration as Calibration | undefined) ?? null,
    track: [],
    sensors: [],
    images: manifest.images.map((img) => ({
      filename: img.filename,
      url: urls.get(img.filename) ?? '',
      cars: [],
      complete: false,
    })),
  };
}

/** How many v3 labels the import discarded — the warning the user must see. */
export function droppedLabelCount(manifest: ManifestData): number {
  return manifest.images.reduce(
    (n, img) => n + Object.keys(img.labels ?? {}).length,
    0,
  );
}

// ---------------------------------------------------------------------------
// Rendering maths
// ---------------------------------------------------------------------------

/** The four corners of a span rendered at `width` pixels across. */
export function spanCorners(p0: Point, p1: Point, width: number): Point[] {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * (width / 2);
  const ny = (dx / len) * (width / 2);
  return [
    { x: p0.x + nx, y: p0.y + ny },
    { x: p1.x + nx, y: p1.y + ny },
    { x: p1.x - nx, y: p1.y - ny },
    { x: p0.x - nx, y: p0.y - ny },
  ];
}

export function cornersToPoints(c: Point[]): string {
  return c.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

/** Catmull-Rom through the control points, emitted as a cubic Bezier path. */
export function splinePath(pts: Point[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M ${pts[0]!.x} ${pts[0]!.y}`;
  if (pts.length === 2) {
    return `M ${pts[0]!.x} ${pts[0]!.y} L ${pts[1]!.x} ${pts[1]!.y}`;
  }
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)}, ${c2.x.toFixed(1)} ${c2.y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/** Distance from a point to a segment, for hit-testing spans. */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export type HitKind = 'car' | 'track' | 'sensor';

export interface Hit {
  kind: HitKind;
  id: string;
  /** Human-readable, for the "what would die" affordance in variant A. */
  label: string;
}

/**
 * What is under the cursor. Cars first — they are the densest thing on screen
 * and the thing the user is usually reaching for.
 */
export function hitTest(
  scene: Scene,
  image: ImageState | undefined,
  p: Point,
  tolerance: number,
  widths: Widths,
): Hit | null {
  const carHalf = Math.max((widths.carPx ?? 40) / 2, tolerance);
  for (const car of image?.cars ?? []) {
    if (distToSegment(p, car.p0, car.p1) <= carHalf) {
      return { kind: 'car', id: car.id, label: `car (${classLeaf(car.cls)})` };
    }
  }
  for (const s of scene.sensors) {
    if (Math.hypot(p.x - s.x, p.y - s.y) <= tolerance) {
      return { kind: 'sensor', id: s.id, label: `sensor ${s.name ?? s.id}` };
    }
  }
  const trackHalf = Math.max((widths.trackPx ?? 20) / 2, tolerance);
  for (const t of scene.track) {
    for (let i = 0; i < t.points.length - 1; i++) {
      if (distToSegment(p, t.points[i]!, t.points[i + 1]!) <= trackHalf) {
        return {
          kind: 'track',
          id: t.id,
          label: `track spline (${t.points.length} points, whole layout)`,
        };
      }
    }
  }
  return null;
}
