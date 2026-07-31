import { z } from 'zod';
import {
  STANDARD_GAUGE,
  SCALE_TO_RATIO,
  SCALES,
  type Scale,
} from '@occupancy/config';

/**
 * Every valid scale name, in the order `config.yaml` defines them.
 *
 * Sourced from `@occupancy/config`; this package declares no scale table of its
 * own. `config.yaml` is the single authored home, and a staleness check in
 * `bin/test.sh` keeps the generated binding honest.
 */
export const VALID_SCALES: readonly Scale[] = SCALES;

/** A scale name. Alias of `@occupancy/config`'s `Scale`. */
export type ValidScales = Scale;

/** Model-domain track gauge in mm (prototype gauge / scale ratio). Internal — the prototype domain is not part of the package's public contract. */
function getGaugeMM(scale: Scale): number {
  return STANDARD_GAUGE / SCALE_TO_RATIO[scale];
}

/**
 * Resolution in Dots Per Track (DPT): a least-squares scale fit over the
 * calibration pairs that sit at equal height, converted to track widths.
 *
 * ```
 * pairs = { (i,j) : z_i == z_j,  i < j }
 * s     = Σ(d_px · d_mm) / Σ(d_mm²)   over pairs
 * DPT   = s · gauge_mm(scale)
 * ```
 *
 * Only equal-`z` pairs enter the fit. Under a pinhole camera two points at
 * different heights sit at different depths, so their pixel separation mixes
 * scale with depth and would bias the result silently — worse the taller the
 * feature. Points at other heights are stored but **inert**, which provisions
 * perspective correction without implementing it. `z` equality is exact: the
 * values are typed by hand, not measured.
 *
 * The `d_mm²` weighting favours long baselines automatically, which is the
 * right bias — click error is a fixed number of pixels, so short baselines are
 * proportionally noisier.
 *
 * At two points the fit reduces to `d_px / d_mm`, so a converted archive
 * reports the DPT it reported under v3.
 *
 * @returns DPT, or `null` when no equal-`z` pair with a nonzero separation
 *          exists — one rule covering the empty, single-point,
 *          all-different-height, and coincident-point cases. `null` means "I
 *          cannot answer", not "zero".
 */
export function getDPT(manifest: ManifestData): number | null {
  const scale = fitScale(equalHeightPairs(manifest.layout.calibration.points));
  if (scale === null) return null;
  return scale * getGaugeMM(manifest.layout.scale);
}

/** One equal-height pair of calibration points, as the two separations the fit sees. */
interface CalibrationPair {
  /** Separation in image pixels. */
  readonly dPx: number;
  /** Separation on the layout, in mm. */
  readonly dMm: number;
}

/**
 * Every pair of calibration points at equal `z`, reduced to two separations.
 *
 * The one place the equal-`z` rule is applied. {@link getDPT} and
 * {@link getDPTResidual} must select the same pairs or the residual would
 * describe a fit nobody computed.
 */
function equalHeightPairs(points: readonly CalibrationPoint[]): CalibrationPair[] {
  const pairs: CalibrationPair[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const a = points[i];
      const b = points[j];
      if (a.world.z !== b.world.z) continue;
      pairs.push({
        dPx: Math.hypot(a.px.x - b.px.x, a.px.y - b.px.y),
        dMm: Math.hypot(a.world.x - b.world.x, a.world.y - b.world.y),
      });
    }
  }
  return pairs;
}

/**
 * The least-squares scale in **pixels per millimetre**, before the gauge turns
 * it into DPT: `Σ(d_px · d_mm) / Σ(d_mm²)`.
 *
 * `null` when the denominator is zero — no pair, or every pair zero millimetres
 * apart. Zero-separation pairs contribute nothing to either sum, so coincident
 * points land here rather than dividing by zero.
 */
function fitScale(pairs: readonly CalibrationPair[]): number | null {
  let numerator = 0;
  let denominator = 0;
  for (const { dPx, dMm } of pairs) {
    numerator += dPx * dMm;
    denominator += dMm * dMm;
  }
  if (denominator === 0) return null;
  return numerator / denominator;
}

/**
 * How badly the calibration points disagree with the scale fitted through them:
 * the RMS of `d_px − s · d_mm` over the same equal-`z` pairs {@link getDPT}
 * uses, in **image pixels**.
 *
 * A mis-typed world coordinate is otherwise absorbed silently into `s`, which
 * shifts DPT and therefore every derived car width without anything looking
 * wrong. The residual is what makes it visible, so the editor shows it.
 *
 * Pixels rather than a percentage because a click error is a fixed number of
 * pixels; the number is directly comparable to how precisely a user can hit a
 * feature. It is a pixel-domain quantity and so does not depend on `layout.scale`.
 *
 * @returns The RMS residual, or `null` when fewer than two pairs contribute —
 *          one pair reproduces itself exactly, so its residual is zero by
 *          construction and would claim an agreement nothing checked. This is
 *          "more than two coplanar points", stated in terms of the fit.
 */
export function getDPTResidual(manifest: ManifestData): number | null {
  const pairs = equalHeightPairs(manifest.layout.calibration.points);
  if (pairs.length < 2) return null;

  const scale = fitScale(pairs);
  if (scale === null) return null;

  let sumSq = 0;
  for (const { dPx, dMm } of pairs) {
    sumSq += (dPx - scale * dMm) ** 2;
  }
  return Math.sqrt(sumSq / pairs.length);
}

/**
 * The manifest version this package reads and writes. There is no v3 code here
 * and no compatibility shim: loading anything else fails on the version number
 * alone. The existing archives were converted once, by a throwaway script.
 */
export const MANIFEST_VERSION = 4;

const ScaleSchema = z.enum(SCALES);

const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const WorldPointSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
});

const CalibrationPointSchema = z.object({
  /** Where the feature is in the image. */
  px: PointSchema,
  /** Where it is on the layout, in mm from an arbitrary but fixed origin. */
  world: WorldPointSchema,
});

// Calibration is always present with `points` defaulting to []. "Uncalibrated"
// is a real state the editor handles, and an empty list expresses it without
// every consumer null-checking the parent.
const CalibrationSchema = z
  .object({
    points: z.array(CalibrationPointSchema).default([]),
  })
  .default({});

const SensorSchema = z.object({
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  /** Free text, not unique, and never auto-generated — absent when unset. */
  name: z.string().optional(),
});

// `provenance` is a discriminated union with no default. `proposed_by` is
// required on `proposed`/`corrected` and forbidden on `human`, enforced by the
// schema rather than by a downstream runtime check: a default of `human` would
// launder model output as human authorship, which is the exact feedback loop
// provenance exists to make measurable.
const carLabelBase = {
  id: z.string().min(1),
  /**
   * A plain string here, deliberately unvalidated against the vocabulary.
   * Conformance is a warning in the editor and a fatal error in the training
   * exporter; a format that refused to open files because someone pruned
   * `config.yaml` would punish config edits.
   */
  class: z.string(),
  p0: PointSchema,
  p1: PointSchema,
};

const CarLabelSchema = z.discriminatedUnion('provenance', [
  z.object({
    ...carLabelBase,
    provenance: z.literal('human'),
    // Present-and-set fails; absent passes.
    proposed_by: z.never().optional(),
  }),
  z.object({
    ...carLabelBase,
    provenance: z.literal('proposed'),
    proposed_by: z.string().min(1),
  }),
  z.object({
    ...carLabelBase,
    provenance: z.literal('corrected'),
    proposed_by: z.string().min(1),
  }),
]);

/**
 * Ids are unique **within** a collection. Sensor ids and label ids are separate
 * namespaces and are never compared — an id shared between the two is fine.
 */
function uniqueIds<T extends { id: string }>(kind: string) {
  return {
    check: (items: readonly T[]) => new Set(items.map(i => i.id)).size === items.length,
    message: `duplicate ${kind} id: ids must be unique within their collection`,
  };
}

const sensorIds = uniqueIds<z.infer<typeof SensorSchema>>('sensor');
const labelIds = uniqueIds<z.infer<typeof CarLabelSchema>>('label');

const ImageSchema = z.object({
  filename: z.string(),
  /**
   * A human asserts that no car in this image is unlabeled. Defaults to
   * `false` unconditionally — that is a claim no default and no conversion can
   * make on a human's behalf. An image marked complete with zero labels is
   * legitimate: it is an all-background sample.
   */
  labeled_complete: z.boolean().default(false),
  labels: z.array(CarLabelSchema).refine(labelIds.check, labelIds.message).default([]),
});

const LayoutSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  contact: z.string().optional(),
  /**
   * Required, with **no default**. v3 defaulted this to `'N'`, which is not
   * safe here: `DPT = s · gauge_mm(scale)`, so a silently-assumed scale
   * reports a DPT wrong by the ratio between the two scales — up to 8.8×
   * between Z and G. SPEC § The v4 manifest names only two defaults,
   * `points: []` and `labeled_complete: false`, and this is not one of them.
   */
  scale: ScaleSchema,
  calibration: CalibrationSchema,
  /** Per **layout**, not per image: placing one answers for every frame. */
  sensors: z.array(SensorSchema).refine(sensorIds.check, sensorIds.message).default([]),
});

const CameraSchema = z.object({
  /** Retained because L0 detections are reported in this frame. */
  resolution: z.object({
    width: z.number().int(),
    height: z.number().int(),
  }),
  model: z.string().optional(),
});

export const ManifestDataSchema = z.object({
  version: z.literal(MANIFEST_VERSION),
  layout: LayoutSchema,
  camera: CameraSchema,
  images: z.array(ImageSchema).default([]),
});

/**
 * Rejects a non-v4 manifest with a message that names the version, before the
 * schema gets a chance to report it as one issue among many.
 *
 * @throws If `data` is not an object, or its `version` is not 4.
 */
export function assertManifestVersion(data: unknown): void {
  const version = (data as { version?: unknown } | null)?.version;
  if (version === MANIFEST_VERSION) return;

  throw new Error(
    `Unsupported manifest version ${JSON.stringify(version)}: this build reads version ` +
      `${MANIFEST_VERSION} only. There is no v3 compatibility path — v4 replaced point ` +
      `markers with cars and sensors, and no automated migration is possible because a ` +
      `point carries neither extent nor orientation.`
  );
}

export type Point = z.infer<typeof PointSchema>;
export type WorldPoint = z.infer<typeof WorldPointSchema>;
export type CalibrationPoint = z.infer<typeof CalibrationPointSchema>;
export type Calibration = z.infer<typeof CalibrationSchema>;
export type Sensor = z.infer<typeof SensorSchema>;
export type CarLabel = z.infer<typeof CarLabelSchema>;
export type Provenance = CarLabel['provenance'];
export type Image = z.infer<typeof ImageSchema>;
export type Layout = z.infer<typeof LayoutSchema>;
export type Camera = z.infer<typeof CameraSchema>;
export type ManifestData = z.infer<typeof ManifestDataSchema>;
