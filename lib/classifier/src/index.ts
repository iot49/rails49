// Public interface of @occupancy/classifier (root entry point).
//
// This file is the package's interface — the only surface consumers may rely
// on. Anything not exported here is internal and may change without notice.
// Per-symbol documentation lives on the declarations in ./base.ts, because
// TypeScript discards doc comments written on re-export statements.
//
// The classifiers themselves live behind platform-specific entry points, so
// that `onnxruntime-node` and `sharp` never reach a browser bundle:
//
//   import { BrowserClassifier } from '@occupancy/classifier/browser';
//   import { NodeClassifier }    from '@occupancy/classifier/node';

//── Configuration ────────────────────────────────────────────────────────────
// Shape of the model config both classifiers are constructed with. Produced by
// the training pipeline and shipped alongside the model as config.json.
export type { ClassifierConfig } from './base.ts';

// Withheld: `BaseClassifier`. It exists to share preprocessing math between the
// two platform classifiers, and its useful members are `protected` — exporting
// it would publish an abstract class no consumer can instantiate. A third
// platform target would import it from './base.ts' inside this package.
