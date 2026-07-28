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
// Converting between modelling scales, physical gauge, and image resolution.
export {
  getGauge,
  getDPT,
  Scale2Number,
  type ValidScales,
} from './manifest.schema.ts';

// Withheld: the zod schemas (ManifestDataSchema, PointSchema, LayoutSchema,
// …). Exporting them would make zod part of this package's contract, so it
// could not be replaced without a breaking change. Validation is an
// implementation detail — callers get validated data or an exception.
//
// Withheld: STANDARD_GAUGE. It is an input to getGauge(), not a result callers
// need; exposing it invites gauge arithmetic to be reimplemented downstream.
