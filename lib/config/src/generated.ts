// GENERATED FILE — DO NOT EDIT.
//
// Source: config.yaml (the single authored home for these values).
// Regenerate with: pnpm config:generate
//
// Hand edits are lost on the next run, and bin/test.sh fails the build when
// this file disagrees with config.yaml.

//── Layout geometry ─────────────────────────────────────────────────────────

/** Prototype track gauge in mm. One authored home, in config.yaml. */
export const STANDARD_GAUGE = 1435.0;

/**
 * Prototype car width in mm — the widest real stock, not a typical one.
 *
 * Car width is derived from this rather than stored per label. Because
 * width in pixels is `DPT * STANDARD_WIDTH / STANDARD_GAUGE`, the scale
 * ratio cancels: a car is the same 2.09 track-widths wide in every scale.
 */
export const STANDARD_WIDTH = 3000.0;

/**
 * Minimum usable DPT. Warns persistently, never blocks — the fixture
 * corpus sits below it at DPT 18-19.
 */
export const MIN_DPT = 20;

/** Every scale name config.yaml defines a ratio for. */
export type Scale = "G" | "O" | "S" | "HO" | "T" | "N" | "Z";

/**
 * Scale name to reduction ratio (HO is 1:87). Model-domain gauge is
 * `STANDARD_GAUGE / SCALE_TO_RATIO[scale]`.
 */
export const SCALE_TO_RATIO = { "G": 25, "O": 48, "S": 64, "HO": 87, "T": 120, "N": 160, "Z": 220 } as const;

/**
 * Scale names as a non-empty tuple, in config.yaml's order — the form a
 * schema enum needs.
 */
export const SCALES: readonly [Scale, ...Scale[]] = ["G", "O", "S", "HO", "T", "N", "Z"];

//── Detector ────────────────────────────────────────────────────────────────

/** Detector input resolution, `[width, height]` in pixels. */
export const DETECTOR_INPUT = [960, 544] as const;

/**
 * Single confidence threshold for decoding detections.
 *
 * A placeholder until held-out recall can set it. Nothing reads it yet;
 * how the eventual detector export applies it is that export's to decide.
 */
export const DETECTOR_CONFIDENCE_THRESHOLD = 0.25;

/**
 * The YOLO class list, verbatim and index-ordered.
 *
 * ⚠️  APPEND-ONLY. A position in this array *is* a class index, so
 * reordering or removing an entry invalidates trained weights while
 * config.yaml still validates. Edit config.yaml, never this file.
 *
 * A label maps to the longest entry that is a segment-prefix of its class:
 * `stock` matches `stock.loco.steam` but never `stockyard`.
 */
export const DETECTOR_CLASSES = ["stock"] as const;

/**
 * The authoring taxonomy — what a label's `class` should match.
 *
 * The root is required, not cosmetic: an unrooted class matches no
 * entry in DETECTOR_CLASSES and would be dropped from an export. The root
 * itself is not offered in the UI; its children are.
 *
 * A **nested object is a subtype**; any other value is a property of the
 * class it sits under (`width_mm` is the one such property today). That
 * is what tells a subtype from a property with no reserved key names.
 */
export const DETECTOR_VOCABULARY = { "stock": { "loco": { "steam": {}, "diesel": {}, "electric": {} } } } as const;
