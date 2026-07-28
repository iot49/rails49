// Public interface of @occupancy/r49.
//
// This file is the package's interface — the only surface consumers may rely
// on. Anything not exported here is internal and may change without notice.
// Per-symbol documentation lives on the declarations in ./archive.ts and
// ./manifest.schema.ts, because TypeScript discards doc comments written on
// re-export statements.

//── Archive I/O ──────────────────────────────────────────────────────────────
// Read and write .r49 layout archives (a zip of manifest.json + images).
// Manifests are validated against the v3 schema on load; invalid input throws.
export { R49Archive } from './archive.ts';

//── Manifest types (v3) ──────────────────────────────────────────────────────
// The shape of a parsed manifest, as returned by R49Archive.getManifest().
export type {
  ManifestData,
  Layout,
  Camera,
  Image,
  Marker,
  Point,
} from './manifest.schema.ts';

//── Scale geometry ───────────────────────────────────────────────────────────
// Consumers work with scale names and pixel-domain measurements only — the
// prototype domain (real-world 1435mm gauge) and the model domain (physical
// gauge in mm) are internal implementation details of how getDPT() is
// computed.
export {
  getDPT,
  VALID_SCALES,
  type ValidScales,
} from './manifest.schema.ts';

// Withheld: the zod schemas (ManifestDataSchema, PointSchema, LayoutSchema,
// …). Exporting them would make zod part of this package's contract, so it
// could not be replaced without a breaking change. Validation is an
// implementation detail — callers get validated data or an exception.
//
// Withheld: STANDARD_GAUGE and Scale2Number, the prototype-domain constants,
// and getGaugeMM (prototype gauge / scale ratio), the function built from
// them. Nothing outside this package needs a physical model-domain gauge in
// mm — only the pixel-domain getDPT() and the scale names in VALID_SCALES.
// Exposing the prototype domain would invite gauge arithmetic to be
// reimplemented downstream (which is exactly what lib/classifier used to do).
