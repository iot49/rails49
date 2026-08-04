// GENERATED FILE — DO NOT EDIT.
//
// Source: config.yaml (the single authored home for these values).
// Regenerate with: pnpm config:generate
//
// Hand edits are lost on the next run, and bin/test.sh fails the build when
// this file disagrees with config.yaml.

// Public interface of @occupancy/config.
//
// This file is the package's interface — the only surface consumers may
// rely on. Per-symbol documentation lives on the declarations in
// ./generated.ts, because TypeScript discards doc comments written on
// re-export statements.

//── Layout geometry ─────────────────────────────────────────────────────────
// The constants that must agree across every stage of the pipeline.
export {
  STANDARD_GAUGE,
  STANDARD_WIDTH,
  MIN_DPT,
  SCALE_TO_RATIO,
  SCALES,
  type Scale,
} from './generated.ts';

//── Detector ────────────────────────────────────────────────────────────────
// The dataset exporter reads the class list and the split ratio.
// @occupancy/detector reads all three of the input resolution (checked
// against the loaded graph, which cannot disagree with itself), the class
// list (indexed by the tensor's class field) and the confidence threshold
// (applied during decoding — a fixed 300-slot buffer is mostly padding, so
// there is no un-thresholded L0 to hand anyone).
export {
  DETECTOR_INPUT,
  DETECTOR_CONFIDENCE_THRESHOLD,
  DETECTOR_VAL_SPLIT,
  DETECTOR_CLASSES,
  DETECTOR_VOCABULARY,
} from './generated.ts';

// Withheld: everything under `classifier` and `cnn` in config.yaml. The
// classifier reads its own config.json at runtime and the CNN training
// hyperparameters are Python's; neither needs a TypeScript binding, and
// exporting them would invite a second consumer for values that have one.

// Withheld: `global.rails_domain`. Nothing in TypeScript consumes it any
// more — the UI used to inject it as __RAILS_DOMAIN__ to recognize the
// deployed site and send ORT's WASM to a CDN, which serving the runtime
// from origin removed (#15). It stays in config.yaml as the project's
// domain of record; give it a binding again only when something reads it.
