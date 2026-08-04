# @occupancy/drift-bench

Synthetic camera-drift benchmark for [issue #91](https://github.com/iot49/rails49/issues/91),
under [Map: camera-drift detection](https://github.com/iot49/rails49/issues/89).

No real drifted frame exists — the fixture corpus was shot with a static
camera — so drift is synthesized. Each fixture image becomes a set of cases
against its own archive's *other* images as references:

* **must-flag**: the image warped by graded homographies — translation
  (2/5/10/20 px), rotation (0.5/1/2°), scale (±1/2 %), a perspective tilt,
  and a combo (5 px + 0.5° + brightness shift). All magnitudes are in the
  benchmark's working resolution (960-wide frames).
* **must-pass**: the unmodified image against its siblings (legitimate scene
  change: rolling stock moved between frames) and photometric perturbations
  (brighter/darker/contrast/gamma — the room's lighting changed, the camera
  did not).

Every image in every case is cropped by one shared border margin that covers
the largest displacement any grade inflicts, so the invalid border pixels a
synthetic warp drags in never reach a scorer, and pass and flag cases are
treated identically.

A candidate implements `Scorer` (`src/harness.ts`): `(frame, refs) → score`,
higher = more drift, continuous — thresholding is the harness's job. The
report gives per-grade score distributions, AUC against the pass set, and
detection rate at the zero-false-alarm threshold.

## Running

The fixtures live in [iot49/r49](https://github.com/iot49/r49) `fixtures/`;
clone it beside this repo (`../r49`), or point `--fixtures` at it.

```bash
pnpm --filter @occupancy/drift-bench bench
pnpm --filter @occupancy/drift-bench bench -- --scorer zmad --archive lighting --json report.json
```

Built-in scorers are the naive pixel baselines `mad` and `zmad`
(`src/baseline.ts`). They exist to prove the harness and to set the bar a
structural candidate has to beat — the prototype ticket
([#92](https://github.com/iot49/rails49/issues/92)) brings its own.
