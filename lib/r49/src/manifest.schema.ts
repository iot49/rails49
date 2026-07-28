import { z } from 'zod';

export const Scale2Number = {
  G: 25,
  O: 48,
  S: 64,
  HO: 87,
  T: 120,
  N: 160,
  Z: 220,
} as const;

export const STANDARD_GAUGE = 1435.0; // Standard gauge in mm

export type ValidScales = keyof typeof Scale2Number;

export function getGauge(scale: ValidScales): number {
  return STANDARD_GAUGE / Scale2Number[scale];
}

/**
 * Calculates the resolution in Dots Per Track (DPT) based on calibration data.
 * Returns null if calibration data is missing.
 */
export function getDPT(manifest: ManifestData): number | null {
  const cal = manifest.layout?.calibration;
  if (cal && cal.p0 && cal.p1 && cal.size_mm) {
    const dx = cal.p0.x - cal.p1.x;
    const dy = cal.p0.y - cal.p1.y;
    const distPixels = Math.sqrt(dx * dx + dy * dy);
    const pixelsPerMm = distPixels / cal.size_mm;
    const gauge = getGauge((manifest.layout?.scale as ValidScales) || 'N');
    return pixelsPerMm * gauge;
  }
  return null;
}

export const ScaleSchema = z.enum(['G', 'O', 'S', 'HO', 'T', 'N', 'Z']);

export const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const MarkerSchema = PointSchema.extend({
  type: z.string().default('track'),
});

export const ImageSchema = z.object({
  filename: z.string(),
  labels: z.record(z.string(), MarkerSchema).default({}),
});

export const LayoutSchema = z.object({
  name: z.string().optional(),
  scale: ScaleSchema.default('N'),
  calibration: z.object({
    p0: PointSchema,
    p1: PointSchema,
    size_mm: z.number(),
  }).optional(),
  description: z.string().optional(),
  contact: z.string().optional(),
});

export const CameraSchema = z.object({
  resolution: z.object({
    width: z.number().int(),
    height: z.number().int(),
  }),
  model: z.string().optional(),
});


export const ManifestDataSchema = z.object({
  version: z.literal(3),
  layout: LayoutSchema,
  camera: CameraSchema,
  images: z.array(ImageSchema).default([]),
});

export type Point = z.infer<typeof PointSchema>;
export type Marker = z.infer<typeof MarkerSchema>;
export type Image = z.infer<typeof ImageSchema>;
export type Layout = z.infer<typeof LayoutSchema>;
export type Camera = z.infer<typeof CameraSchema>;
export type ManifestData = z.infer<typeof ManifestDataSchema>;
