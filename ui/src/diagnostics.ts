/**
 * Reading the detector's output against the labels a human authored (#87).
 *
 * Pure functions, here rather than in the view for the reason `geometry.ts`
 * gives: jsdom lays nothing out, so anything left inside a Lit element is
 * untestable. Everything in this file is arithmetic over two rectangles, and
 * all of it is tested.
 *
 * **Not in `@occupancy/detector`, deliberately.** That package's root is the
 * car-box geometry both sides of the model need — `carWidthPx`, `spanToPolygon`,
 * `boxCorners`, `occupancy`. Scoring is a different job: it belongs to whoever
 * is *evaluating*, and today that is one view in one app. `lib/detector`'s own
 * interface notes say to add a `./node` entry point "when something wants to
 * score a corpus offline, not before"; the same restraint applies to the
 * scoring itself. When a second consumer appears — a CI gate, an offline
 * scorer — this moves down with a real second caller behind it.
 *
 * **What this is not.** It measures agreement between one model and one
 * archive's labels. It is not an accuracy figure and no number out of it
 * estimates how a model generalizes: `SPEC.md` § Accuracy makes that a property
 * of a held-out protocol over a corpus that does not exist yet. The vocabulary
 * here says "agreed", never "correct".
 */

import type { CarLabel, Point } from '@occupancy/r49';
import type { Detection, Frame } from '@occupancy/detector';
import { boxCorners, carWidthPx } from '@occupancy/detector';
import { carCorners } from './geometry.js';
import type { Rect } from './geometry.js';

/**
 * What one label-or-box turned out to be.
 *
 * Four outcomes and no fifth: a label is found or it is not, a box has a label
 * under it or it does not. `pose-off` is the found-but-badly case, split out
 * because it is the one a labeler can act on — a missed car and a phantom are
 * the model's problem, a pose that disagrees may be either side's.
 */
export type FindingKind = 'agreed' | 'pose-off' | 'missed' | 'phantom';

/** Why a matched pair was called `pose-off`. Empty on an `agreed` pair. */
export interface PoseDeviation {
  /** Angle between the two long axes, in degrees, undirected. */
  readonly angleDeg: number;
  /** Predicted length ÷ labelled length. */
  readonly lengthRatio: number;
  /** Centre-to-centre distance, in car widths. */
  readonly offsetWidths: number;
  /**
   * Predicted width ÷ the DPT-derived width — reported, never matched on.
   *
   * Width is a fit to a constant and its deviation is pure error (see
   * `Detection.width`), so matching normalizes it away. It still belongs in the
   * readout: a model whose widths drift is worth knowing about even though no
   * verdict here depends on it.
   */
  readonly widthRatio: number;
}

export interface Finding {
  readonly kind: FindingKind;
  /** The authored span, or `null` for a phantom. */
  readonly label: CarLabel | null;
  /** The predicted box, or `null` for a miss. */
  readonly detection: Detection | null;
  /**
   * Width-normalized IoU of the pair, or `null` when there is only one side.
   *
   * `0` never appears on a pair: a pair below {@link MATCH_IOU} is not a pair.
   */
  readonly iou: number | null;
  /** How the pair disagrees. `null` unless the kind is `pose-off`. */
  readonly deviation: PoseDeviation | null;
}

export interface ImageDiagnostics {
  readonly filename: string;
  /**
   * Whether a human asserted every car in this image is labelled.
   *
   * Load-bearing for reading the result rather than for computing it: on an
   * image without it, a phantom may simply be a car nobody has labelled yet, so
   * the number is not evidence against the model. Nothing here filters on it —
   * hiding those images would hide real detections — but every surface that
   * shows a phantom count must say which images carry the claim.
   */
  readonly labeledComplete: boolean;
  readonly labels: readonly CarLabel[];
  readonly detections: readonly Detection[];
  readonly findings: readonly Finding[];
  readonly counts: Readonly<Record<FindingKind, number>>;
  /** Everything that is not `agreed` — what the surfaces rank on. */
  readonly disagreements: number;
  /** Lowest confidence among this image's detections; `null` with none. */
  readonly worstConfidence: number | null;
}

export interface ArchiveDiagnostics {
  readonly images: readonly ImageDiagnostics[];
  readonly counts: Readonly<Record<FindingKind, number>>;
  readonly labels: number;
  readonly detections: number;
  readonly imagesWithDisagreements: number;
  /** Images no human has asserted complete — see {@link ImageDiagnostics}. */
  readonly incompleteImages: number;
}

/**
 * Minimum width-normalized IoU for a box and a label to be **the same car**.
 *
 * Deliberately loose. This threshold does not decide whether the model did
 * well — {@link AGREE_IOU} does — it decides whether two rectangles are talking
 * about the same vehicle at all. Set it high and a badly-posed box stops being
 * a `pose-off` and becomes a `missed` **and** a `phantom` at once, which
 * double-counts one error and hides that the model did find something there.
 */
export const MATCH_IOU = 0.15;

/**
 * Width-normalized IoU at or above which a matched pair is `agreed`.
 *
 * **Not 0.5.** That is mAP50's convention, and it answers a different question:
 * whether a detector should be *credited* with a hit when a benchmark is
 * summarizing thousands of boxes. Here a human is looking at one picture, and
 * at 0.5 a box **half the car's length** scores as agreement — two equal-width
 * rectangles sharing half their length have exactly IoU 0.5. Nobody looking at
 * that would say the model agreed.
 *
 * 0.7 puts the boundary at roughly a 30% length error or a 10° rotation, which
 * is about where a box stops looking right over a car. It is a legibility
 * threshold, not a scoring one, and no published figure depends on it.
 */
export const AGREE_IOU = 0.7;

/** Area of a simple polygon, by the shoelace formula. Sign-free. */
export function polygonArea(polygon: readonly Point[]): number {
  let twice = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/**
 * Area shared by two **convex** polygons, by Sutherland–Hodgman clipping.
 *
 * Convexity is what makes this correct and it is not an assumption to relax:
 * both inputs here are rectangles by construction — `carCorners` and
 * `boxCorners` both walk a perimeter rather than pairing ends, so neither can
 * produce the bowtie that would break this.
 *
 * Winding is normalized before clipping rather than assumed. `carCorners` and
 * `boxCorners` build their corners from normals that point opposite ways for a
 * span running right-to-left, so a shared rule cannot be relied on — and a
 * mismatched pair silently clips to nothing, which reads as a total miss.
 */
export function convexIntersectionArea(a: readonly Point[], b: readonly Point[]): number {
  let output = counterClockwise(a);
  const clip = counterClockwise(b);

  for (let i = 0; i < clip.length && output.length > 0; i++) {
    const edgeStart = clip[i];
    const edgeEnd = clip[(i + 1) % clip.length];
    const input = output;
    output = [];

    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const previous = input[(j + input.length - 1) % input.length];
      const currentInside = side(edgeStart, edgeEnd, current) >= 0;
      const previousInside = side(edgeStart, edgeEnd, previous) >= 0;

      if (currentInside) {
        if (!previousInside) output.push(intersect(previous, current, edgeStart, edgeEnd));
        output.push(current);
      } else if (previousInside) {
        output.push(intersect(previous, current, edgeStart, edgeEnd));
      }
    }
  }

  return output.length < 3 ? 0 : polygonArea(output);
}

/** Positive when `p` is left of the directed edge `a → b`. */
function side(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function counterClockwise(polygon: readonly Point[]): Point[] {
  let twice = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return twice < 0 ? [...polygon].reverse() : [...polygon];
}

/** Where segment `p → q` crosses the infinite line through `a → b`. */
function intersect(p: Point, q: Point, a: Point, b: Point): Point {
  const dx1 = q.x - p.x;
  const dy1 = q.y - p.y;
  const dx2 = b.x - a.x;
  const dy2 = b.y - a.y;
  const denominator = dx1 * dy2 - dy1 * dx2;
  // Parallel: the caller only reaches this when the endpoints straddle the
  // edge, so a zero here is floating-point noise on a near-tangent crossing.
  // Answering with `p` keeps the polygon closed instead of emitting NaN.
  if (denominator === 0) return { ...p };
  const t = ((a.x - p.x) * dy2 - (a.y - p.y) * dx2) / denominator;
  return { x: p.x + t * dx1, y: p.y + t * dy1 };
}

/** Intersection over union of two convex polygons. */
export function polygonIoU(a: readonly Point[], b: readonly Point[]): number {
  const intersection = convexIntersectionArea(a, b);
  if (intersection === 0) return 0;
  const union = polygonArea(a) + polygonArea(b) - intersection;
  return union <= 0 ? 0 : intersection / union;
}

/**
 * The rectangle a detection is **matched** by: its own centre, angle and
 * length, but the DPT-derived width.
 *
 * The same substitution `occupancy()` makes, for the same reason. Width is a
 * fit to a constant, so scoring the raw one would charge the model for a
 * quantity it was never asked to vary — and worse, it would make IoU depend on
 * a number that has no ground truth to compare against, since a label's width
 * is derived rather than authored. What matching should measure is whether the
 * model found the car and lay along it. The raw width is still reported, in
 * {@link PoseDeviation}.
 */
function normalizedBoxCorners(detection: Detection, dpt: number): readonly Point[] {
  return boxCorners({ ...detection, width: carWidthPx(dpt) });
}

/** Smallest angle between two undirected axes, in degrees. A car has no front. */
function axisDeltaDeg(a: number, b: number): number {
  let delta = Math.abs(a - b) % Math.PI;
  if (delta > Math.PI / 2) delta = Math.PI - delta;
  return (delta * 180) / Math.PI;
}

function labelCentre(label: CarLabel): Point {
  return { x: (label.p0.x + label.p1.x) / 2, y: (label.p0.y + label.p1.y) / 2 };
}

function labelLength(label: CarLabel): number {
  return Math.hypot(label.p1.x - label.p0.x, label.p1.y - label.p0.y);
}

function labelAngle(label: CarLabel): number {
  return Math.atan2(label.p1.y - label.p0.y, label.p1.x - label.p0.x);
}

export interface DiagnoseInput {
  readonly filename: string;
  readonly labeledComplete: boolean;
  readonly labels: readonly CarLabel[];
  readonly detections: readonly Detection[];
  /**
   * The layout's DPT. Required — with no calibration there is no car width, so
   * neither rectangle exists and there is nothing to compare. The caller
   * reports that state rather than passing `null` into arithmetic.
   */
  readonly dpt: number;
}

/**
 * Match one image's detections to its labels, and name every disagreement.
 *
 * **Confidence-ordered greedy assignment**, the convention detection
 * evaluation uses: take the most confident box first and give it the free label
 * it overlaps most. That ordering is what makes the result defensible on a
 * tight consist, where the prototype's nearest-centre rule failed — coupled
 * cars sit a car-length apart with no gap, so the nearest *centre* to a box
 * that drifted half a car is the neighbour, and one drifted box would cascade
 * into a chain of wrong pairings down the whole train. Overlap cannot cascade
 * that way: a box that drifted half a car still overlaps its own label far more
 * than the neighbour's.
 *
 * Not optimal assignment. Hungarian would maximize total IoU, and on the case
 * that matters — a consist of near-identical rectangles — it buys nothing that
 * confidence ordering does not already get, at the cost of an implementation
 * nobody can check by eye against a picture.
 */
export function diagnoseImage(input: DiagnoseInput): ImageDiagnostics {
  const { filename, labeledComplete, labels, detections, dpt } = input;

  const labelPolygons = labels.map(label => carCorners(label.p0, label.p1, dpt));
  const boxPolygons = detections.map(detection => normalizedBoxCorners(detection, dpt));
  const width = carWidthPx(dpt);

  const takenLabels = new Set<number>();
  const findings: Finding[] = [];

  // Most confident first. `detections` arrives in the model's own order, which
  // carries no meaning, so the sort is over indices to keep both polygon
  // arrays addressable.
  const byConfidence = detections
    .map((detection, index) => ({ detection, index }))
    .sort((a, b) => b.detection.confidence - a.detection.confidence);

  for (const { detection, index } of byConfidence) {
    let best = -1;
    let bestIoU = MATCH_IOU;

    for (let l = 0; l < labels.length; l++) {
      if (takenLabels.has(l)) continue;
      const iou = polygonIoU(boxPolygons[index], labelPolygons[l]);
      if (iou >= bestIoU) {
        best = l;
        bestIoU = iou;
      }
    }

    if (best < 0) {
      findings.push({
        kind: 'phantom',
        label: null,
        detection,
        iou: null,
        deviation: null,
      });
      continue;
    }

    takenLabels.add(best);
    const label = labels[best];
    const centre = labelCentre(label);
    const length = labelLength(label);
    const deviation: PoseDeviation = {
      angleDeg: axisDeltaDeg(detection.angle, labelAngle(label)),
      lengthRatio: length > 0 ? detection.length / length : 1,
      offsetWidths:
        Math.hypot(detection.centre.x - centre.x, detection.centre.y - centre.y) / width,
      widthRatio: detection.width / width,
    };

    const agreed = bestIoU >= AGREE_IOU;
    findings.push({
      kind: agreed ? 'agreed' : 'pose-off',
      label,
      detection,
      iou: bestIoU,
      deviation: agreed ? null : deviation,
    });
  }

  labels.forEach((label, index) => {
    if (takenLabels.has(index)) return;
    findings.push({ kind: 'missed', label, detection: null, iou: null, deviation: null });
  });

  const counts: Record<FindingKind, number> = {
    agreed: 0,
    'pose-off': 0,
    missed: 0,
    phantom: 0,
  };
  for (const finding of findings) counts[finding.kind]++;

  return {
    filename,
    labeledComplete,
    labels,
    detections,
    findings,
    counts,
    disagreements: counts['pose-off'] + counts.missed + counts.phantom,
    worstConfidence: detections.length
      ? Math.min(...detections.map(detection => detection.confidence))
      : null,
  };
}

/** Sum one archive's per-image results. */
export function rollUp(images: readonly ImageDiagnostics[]): ArchiveDiagnostics {
  const counts: Record<FindingKind, number> = {
    agreed: 0,
    'pose-off': 0,
    missed: 0,
    phantom: 0,
  };
  let labels = 0;
  let detections = 0;
  let imagesWithDisagreements = 0;
  let incompleteImages = 0;

  for (const image of images) {
    for (const kind of Object.keys(counts) as FindingKind[]) counts[kind] += image.counts[kind];
    labels += image.labels.length;
    detections += image.detections.length;
    if (image.disagreements > 0) imagesWithDisagreements++;
    if (!image.labeledComplete) incompleteImages++;
  }

  return { images, counts, labels, detections, imagesWithDisagreements, incompleteImages };
}

/**
 * A rect containing **both sides** of a finding, padded and clamped to frame.
 *
 * Framing on one side is the mistake this exists to prevent: a box that slid
 * two car lengths off its label falls outside a crop centred on the label, so
 * the one view meant to show a disagreement shows half of it and reads as
 * though nothing is wrong.
 *
 * @param aspect Width-to-height ratio to grow the rect to, so a crop is never
 *               taller than it is wide for a car lying across the frame.
 */
export function findingBounds(
  finding: Finding,
  dpt: number,
  frame: Frame,
  aspect = 1.75
): Rect {
  const points: Point[] = [];
  if (finding.label) points.push(finding.label.p0, finding.label.p1);
  if (finding.detection) points.push(...boxCorners(finding.detection));

  const width = carWidthPx(dpt);
  const xs = points.map(p => p.x);
  const ys = points.map(p => p.y);
  const centreX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centreY = (Math.min(...ys) + Math.max(...ys)) / 2;

  const pad = width * 1.6;
  let halfWidth = Math.max((Math.max(...xs) - Math.min(...xs)) / 2 + pad, width * 2.5);
  let halfHeight = Math.max((Math.max(...ys) - Math.min(...ys)) / 2 + pad, width * 1.5);
  if (halfWidth / halfHeight < aspect) halfWidth = halfHeight * aspect;
  else halfHeight = halfWidth / aspect;

  // Clamp the origin so the rect stays inside the frame where it can, then clip
  // the extent for the case where the padded box is larger than the frame.
  const x = Math.max(0, Math.min(centreX - halfWidth, frame.width - halfWidth * 2));
  const y = Math.max(0, Math.min(centreY - halfHeight, frame.height - halfHeight * 2));
  return {
    x,
    y,
    width: Math.min(halfWidth * 2, frame.width - x),
    height: Math.min(halfHeight * 2, frame.height - y),
  };
}

/** One line of prose per finding — what every surface has to say about it. */
export function describeFinding(finding: Finding): string {
  switch (finding.kind) {
    case 'missed':
      return 'No box over a labelled car';
    case 'phantom':
      return `Box over no label — ${percent(finding.detection!.confidence)} confident`;
    case 'agreed':
      return `Agrees — ${percent(finding.detection!.confidence)} confident, IoU ${finding.iou!.toFixed(2)}`;
    case 'pose-off': {
      const { angleDeg, lengthRatio, offsetWidths } = finding.deviation!;
      const parts: string[] = [];
      if (angleDeg >= 1) parts.push(`${angleDeg.toFixed(0)}° off axis`);
      if (Math.abs(lengthRatio - 1) >= 0.05) {
        const direction = lengthRatio < 1 ? 'short' : 'long';
        parts.push(`${direction} by ${Math.round(Math.abs(lengthRatio - 1) * 100)}%`);
      }
      if (offsetWidths >= 0.1) parts.push(`slid ${offsetWidths.toFixed(1)} widths`);
      const how = parts.length > 0 ? parts.join(', ') : 'overlaps only partly';
      return `${how} — IoU ${finding.iou!.toFixed(2)}`;
    }
  }
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** What each kind is called, wherever it is named. */
export const KIND_LABEL: Readonly<Record<FindingKind, string>> = {
  agreed: 'Agreed',
  'pose-off': 'Pose off',
  missed: 'Missed car',
  phantom: 'Phantom box',
};
