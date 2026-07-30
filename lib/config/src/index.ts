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
// Values only. Nothing here is wired into a runtime yet.
export {
  DETECTOR_INPUT,
  DETECTOR_CONFIDENCE_THRESHOLD,
  DETECTOR_CLASSES,
  DETECTOR_VOCABULARY,
} from './generated.ts';

// Withheld: everything under `classifier` and `cnn` in config.yaml. The
// classifier reads its own config.json at runtime and the CNN training
// hyperparameters are Python's; neither needs a TypeScript binding, and
// exporting them would invite a second consumer for values that have one.

// Withheld: `global.rails_domain`. ui/vite.config.ts injects it at build
// time as __RAILS_DOMAIN__, reading config.yaml directly — importing it
// here would give that one value two paths into the bundle.
