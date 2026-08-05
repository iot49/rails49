# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Computer vision suite for model railroaders: camera-based track occupancy detection using CNN image classification. Monorepo at https://github.com/iot49/rails49.git; UI served at https://rails49.org/ui.

**Safety note (from README):** the classifier does sometimes miss rolling stock or report phantom trains. Nothing here should be presented as a safety interlock.

**`SPEC.md` at the root is the requirements document for the whole project** — the `.r49` v4 format, the occupancy output contract, labeling UX, training-data derivation, and the reasoning behind each. It describes the **target**, and parts of it are still unbuilt. Where SPEC and the code disagree, that is the migration, not a bug to fix. This file describes what exists and how to build it; SPEC describes what it is for.

**SPEC § Format is now implemented.** The manifest is **v4** — cars as two-point spans with provenance, sensors per layout, multi-point calibration, `labeled_complete` per image — and `@occupancy/r49` reads and writes nothing else. Every authoring surface the v4 editor asks for is built, but the editor is not finished — see `ui/CLAUDE.md` for its state, GitHub Issues for what is open, and `SPEC.md` § In scope for the still-unresolved proposal interaction. The detector path is now wired end to end: the dataset export and the training/export path run (`dataset/src/yolo_export.ts`, then `detector/`), and **`rr-live-view` loads the detector, draws L0 boxes and reports L1 per sensor** (#85) — the CNN is retained and retrainable but nothing loads it. What is still missing is archive diagnostics in the UI (#87).

**Camera-drift detection is built** (map #89): `@occupancy/drift` measures how far the camera has moved from the pose an archive's images were shot in, the live view **refuses to classify** past `layout.max_drift_px` with a visible override (#94), and the editor **warns without blocking** on a freshly added image (#95). Validation is entirely synthetic — the fixtures were all shot on a tripod, so `tools/drift-bench` warps them — and the recovery flow after a refusal is deliberately unspecified until real usage exists.

## Commands

Run from the repo root unless noted. pnpm workspace + `uv` for Python.

| Task | Command |
| :--- | :--- |
| Full check (typecheck + TS tests + Python lint) | `bin/test.sh` |
| Typecheck all packages | `pnpm typecheck` |
| All TS tests | `pnpm test` |
| Tests for one package | `pnpm --filter @occupancy/r49 test` |
| A single test file | `pnpm --filter @occupancy/ui test tests/marker.test.ts` |
| Watch mode (ui) | `pnpm --filter @occupancy/ui test:watch` |
| UI dev server | `pnpm --filter @occupancy/ui dev` (HTTPS via self-signed cert; `dev:http` for plain HTTP) |
| Build UI | `pnpm build` |
| Regenerate `config.json` **and `lib/config`** | `pnpm config:generate` (or `bin/generate_config.py`) |
| Deploy to Cloudflare Pages | `bin/deploy.sh` |
| Python lint/format/types | `cd <classifier/resnet\|detector> && uv run ruff check . && uv run black --check . && uv run pyright` |
| Derive the detector dataset | `pnpm --filter dataset run export:yolo` (reads `dataset/r49/`, writes `dataset/yolo/`) |
| Score the drift check on the fixtures | `pnpm --filter @occupancy/drift-bench bench` (needs `iot49/r49` cloned at `../r49`; ~10 min for 736 cases) |
| Fine-tune + export the detector | `cd detector && uv run python train.py && uv run python export_onnx.py` |
| Install pre-push hook (runs `bin/test.sh`) | `bin/install-hooks.sh` |

The UI dev server serves over HTTPS by default because `getUserMedia` requires a secure context — a phone on the LAN needs the HTTPS URL. It also sets COOP/COEP headers, required for ONNX Runtime's threaded WASM.

## Architecture

### The pipeline

The whole system is one data path; each directory is a stage in it.

Two branches share one corpus: the **detector** path runs, the **classifier**
path is parked at its first arrow.

The archives feed a third consumer that trains nothing: `lib/drift` derives
reference spectra from the images at load time and both UI surfaces gate on them
(#89). It is off the training path entirely — no model, no export, no artifact.

```
.r49 archives (iot49/r49)         v4: layout photos, calibration, labels
        │
        ├── lib/drift/                   ✓ RUNS  createDriftCheck(images)
        │       │                        block phase correlation, nothing stored
        │       ├─▶ ui/rr-live-view       refuse to classify + override   ✓ #94
        │       ├─▶ ui/rr-editor-view     warn, never block               ✓ #95
        │       └─▶ tools/drift-bench     736 synthetic cases, AUC 1.000
        │
        ├── dataset/src/yolo_export.ts   ✓ RUNS  (labeled_complete gate, OBB spans)
        │       ▼
        │   dataset/yolo/                Ultralytics OBB layout, 80/20 by image
        │       │  detector/train.py       (YOLO26n-OBB fine-tune from DOTA)
        │       ▼
        │   detector/runs/.../best.pt
        │       │  detector/export_onnx.py (ONNX → static INT8 → .ort)
        │       ▼
        │   detector/models/             detector_int8.ort  (NOT in git, NOT released)
        │       │
        │       └─▶ lib/detector/         loadDetector → L0 → occupancy() → L1
        │               │
        │               └─▶ ui/           rr-live-view: dashed L0 boxes, sensors
        │                                 coloured occupied/clear/unknown  ✓ #85
        │
        └── ✗ PARKED — no crop derivation runs today (see below)
                ▼
            dataset/data/                144×144 crops, 80/20 split, data.csv
                │  classifier/resnet/TRAIN.ipynb   (Fastai ResNet-18 → ONNX → ORT)
                ▼
            classifier/resnet/models/    model_int8.ort + config.json  (NOT in git)
                │
                └─▶ ✗ nothing loads it — retained and retrainable (#7, #85)
```

### The archives live in another repository

**There are no `.r49` files in this repo any more** (#63). The corpus is
[`iot49/r49`](https://github.com/iot49/r49): submissions arrive there by pull request under CC BY 4.0, and its CI checks them out of a `rails49` checkout at `main` and runs `tools/r49-validate` from it. See issue #54 for the whole design.

> ⚠️ **This repository must stay public, or the corpus's CI breaks.** Its workflow does `actions/checkout` on `iot49/rails49`, and `GITHUB_TOKEN` is scoped to the repository running the workflow — a public repo's token 404s on a private one. No token fixes it either: every contributor submission is a **fork** pull request, and GitHub passes no secrets to those, so a PAT would work for the maintainer's own branches and fail for every real contributor. This was found the hard way in #74, and it is invisible from inside this repo — nothing here goes red.

The six archives this repo used to carry moved to that repo's `fixtures/` tree — 46 images, real calibration, **zero labels**, DPT 18.0–19.1. They were converted from v3 once, in place, by a throwaway script deleted with the conversion (#22); all 1195 v3 point markers were **dropped, not promoted**, because a point carries neither extent nor orientation and any promotion would be fabricated geometry entering the corpus. Both the originals and the converted copies stay recoverable from this repo's git history — the deletion reclaims no weight, since every version is already in `.git`.

> They are **fixtures, not training data**, which is why they sit outside `archives/` over there. Below `layout.min_dpt`, zero labels: no number derived from them predicts model accuracy. Training will use the corpus's real submissions.

The conversion's regression guard is **retired** (#67) — its job ended with the conversion, and its zero-labels assertions blocked the relabeling the six exist for. What stands in its place is a different kind of test: `lib/r49/tests/fixtures/format-v4.r49`, a tiny **frozen** archive written once and never regenerated, which catches the writer-and-parser-drifting-together failure a symmetric round-trip test structurally cannot see. Do not regenerate it — if it fails to load, that is a v4 break needing a version bump.

**The classifier's first arrow does not run; the detector's does.** `dataset/src/yolo_export.ts` derives the Ultralytics OBB dataset straight from the archives — `labeled_complete` is its one hard gate, and everything else that could drop a car (an unmapped class, an uncalibrated archive, a zero-length span) is fatal instead. See `dataset/README.md` and `SPEC.md` § YOLO annotations. Nothing trains from its output yet.

`dataset/src/data_prep.ts` and `dataset/src/online_diagnostics.ts` are **parked stubs** that print their reason and exit non-zero — they derived crops and scored a confusion matrix from v3 point markers, which v4 does not store. Deriving from car spans alone gives every crop the same tag, so the vocabulary collapses to one degenerate class with no negatives. See `SPEC.md` § v4 cannot produce a trainable CNN dataset (issues #8, #18). The documented route back is sampling background crops as verified negatives — an experiment, dormant while the ResNet is. **Do not revive them by inventing a substitute vocabulary or synthesising negatives.**

### `config.yaml` is authored; everything else is generated

`config.yaml` is the single source for parameters that must agree across stages (`crop_size`, normalization mean/std, training hyperparameters, layout and detector constants, scale→ratio table). `pnpm config:generate` emits **two** derived representations from it:

| Output | Tracked? | Consumed by |
| :--- | :--- | :--- |
| `config.json` | **gitignored** — absent on a fresh clone until you generate | the model export |
| `lib/config/src/` | **committed** | `@occupancy/r49`, and TypeScript generally |

`lib/config` is committed precisely so a fresh clone typechecks before anyone runs a generator. **Never hand-edit either output** — edit `config.yaml` and regenerate. `bin/test.sh` regenerates `lib/config` into a temp tree and diffs, so editing `config.yaml` without regenerating fails the full check with the command to run rather than surfacing at runtime.

`@occupancy/r49` derives `STANDARD_GAUGE`, the scale→ratio table, and its scale enum from `lib/config` rather than declaring any of them. That is the point of the package: those constants used to exist in both `config.yaml` and `manifest.schema.ts` with nothing checking that they matched. Python keeps reading `config.yaml` directly and does not consume `lib/config`.

> ⚠️ **`detector.classes` is append-only.** A list position *is* a YOLO class index, so reordering or deleting an entry invalidates trained weights while the file still validates — the one config edit that can break a model with nothing noticing. The generator preserves its order exactly and must keep doing so.

`classifier.labels` is **deleted, not corrected**: it named a four-tag CNN vocabulary v4 cannot produce, and nothing could verify it (`TRAIN.ipynb` takes its labels from the dataset vocab). The generator fails loudly if the key reappears.

### Workspace packages

`pnpm-workspace.yaml` covers `lib/*`, `ui`, `dataset`. The `lib/*` packages are consumed **as TypeScript source** — nothing under `lib/` is built or published.

* `@occupancy/r49` — `.r49` archive parser/serializer (zip of `manifest.json` + images), zod-validated **v4-only** manifest schema, scale geometry (`getDPT`, and `getDPTResidual` — the same least-squares fit's disagreement, in image pixels, which is what makes a mis-typed world coordinate visible instead of silently absorbed into the scale). Loading a v3 archive fails on the version number alone: there is no compatibility shim, because a point marker carries neither extent nor orientation and so cannot be migrated. Its gauge, scale ratios and scale enum come from `@occupancy/config`.
* `@occupancy/drift` — camera-drift detection (#89). `createDriftCheck(refs)` → `check(frame)` → `{ displacementPx, refIndex }` in the reference images' pixels. Block-wise phase correlation with a hand-rolled FFT, dependency-free, one entry point: it runs identically in the browser and in Node because `tools/drift-bench` scores **it** rather than a copy — 736 synthetic cases, AUC 1.000, every legitimate case exactly 0. **It measures and decides nothing**: the verdict is `layout.max_drift_px` in `config.yaml`, because the live view refuses to classify on it (with an override) and the editor warns without blocking. Correction — homography fitting, fiducials — is out of scope by decision (#12).
* `@occupancy/config` — **generated** from `config.yaml`, committed. Layout and detector constants.
* `@occupancy/uid` — Snowflake-style id generator
* `@occupancy/classifier` — ONNX Runtime classifier; **three entry points**, and the split is load-bearing: `.` exports only `ClassifierConfig`, `./browser` exports `BrowserClassifier`, `./node` exports `NodeClassifier`. This is what keeps `onnxruntime-node` and `sharp` out of the browser bundle. Shared preprocessing math lives in the unexported `BaseClassifier`. **Nothing loads it any more** (#7, #85) — `ui` does not even depend on it — but it stays retrainable and revivable.
* `@occupancy/detector` — the detector runtime and, despite the name, **the car-box package**. `.` is pure: `Detection`, the total `occupancy()` (L1), and the span→box geometry — `carWidthPx` and `spanToPolygon` live here rather than in `dataset` so the width constant that biases boxes toward `occupied` has one home, and so the browser can reach it (`dataset/src/obb.ts` imports `node:crypto` at module top). `./browser` carries the ORT session behind `loadDetector`, a factory so that an unloaded detector is unrepresentable. The letterbox and the `[1, 300, 7]` decode sit in pure modules, tested against synthetic tensors — **no test needs a model file**. The decode also **suppresses duplicate boxes** (#107): `end2end`'s `TopK` selects the top 300 slots but suppresses nothing, so the head emits up to four boxes per car — measured at fp32 and INT8 alike, so quantization is not the cause. `overlap.ts` holds the rotated-box IoU that does it, exported because `ui/src/diagnostics.ts` matches predictions to labels with the same arithmetic.

**Read `lib/CLAUDE.md` before touching anything under `lib/`.** Each package's `src/index.ts` is its interface (explicit exports only, no implementation, no `export *`), TSDoc goes on the declaration rather than the re-export line, and the root `tsconfig.json` deliberately has no `paths` block so `package.json` `"exports"` is the one boundary that binds identically at typecheck and at bundle time.

### UI (`ui/`)

Lit + Shoelace + Vite. Per-component contracts are documented at length in `ui/README.md`; the load-bearing points:

* All custom elements are prefixed `rr-` (railroad). Non-element modules use plain camelCase filenames (`carMarker.ts`, `capture.ts`).
* `rr-viewer` is shared by both the editor and live views — same component, `src` (image) in one, `stream` (video) in the other. Its media element and SVG overlay resolve to **one box** by construction (#41), so a marker lands on the pixel it names in either mode. It **reports pointer gestures but authors nothing**: typed `rr-pointer-*` events carry image-pixel coordinates, deciding what a gesture means is `rr-editor-view`'s job, and the arithmetic lives in the pure `ui/src/geometry.ts`. The editor's authoring surfaces — calibration points, sensors, car chaining with shared coupler handles, reclassify, the completeness affordance — and their invariants are documented in `ui/CLAUDE.md`.
* `carMarker.ts`, `sensorMarker.ts` and `calibrationMarker.ts` are modules, not custom elements, because custom elements break the SVG namespace inside `<svg>`. Each one's renderer and styles must be used together. `carMarker.ts` draws both the authored car and the detector's L0 box — a detection is the same object seen from the other side, so it shares the ink and the winding rule (#85).
* **Camera drift gates both views, asymmetrically** (#89). `ui/src/driftSession.ts` is the one place that holds a canvas for it — `openDriftCheck(archive)`, `grabPlane(source, w, h)` — because `@occupancy/drift` takes a `GrayPlane` rather than an `ImageData` so Node can call it too. In the **live view** a measurement past `layout.max_drift_px` withholds L1 (every sensor `unknown` / `drift`) while **L0 keeps running**: the boxes are true of the frame they were computed in, and what a moved camera invalidates is their mapping onto sensors authored in the archive's frame — so sensor diamonds sitting off the track beside correct boxes is the statement of *why*. Occupancy is machine-consumable, so refusal is the honest response where a banner is not; the banner carries the number and the "classify anyway" override, which exists because the check's false-positive rate is young. In the **editor** an added image that disagrees earns a persistent warning bar and **nothing is blocked** — the `MIN_DPT` precedent. Drift is sampled every few seconds, never per frame, and sampling continues *while* refusing: putting the camera back is the fix, and a gate that stopped measuring could not see it happen.
* The app is entirely client-side: layouts are opened and saved as `.r49` files through the file picker, and inference runs in the browser via ONNX Runtime's WASM backend. There is no backend — don't reintroduce one without discussion.
* **The ORT runtime ships from origin, and every stage of the build depends on that** (#15). `rails49.org/_headers` cross-origin-isolates `/ui/` so ORT gets more than one WASM thread; `require-corp` then forbids the cross-origin CDN the runtime used to come from. It fits under Cloudflare's 25 MiB limit only because the app imports `onnxruntime-web/wasm` rather than the package root, which would pull the 25.02 MiB jsep (WebGPU/WebNN) binary the `executionProviders: ['wasm']` sessions never use. `ui/ortAssets.ts` names the binary, its Emscripten glue and the copy targets; `bin/deploy.sh` repeats the filename because a shell script cannot import it, and `ui/tests/ortAssets.test.ts` is what keeps the two from drifting.
* Vite copies `detector/models/detector_int8.ort` into the bundle **only if that directory exists**, so builds succeed without a local model — the live view then shows a no-model banner and reports every sensor `unknown`. The filename comes from `ui/modelAssets.ts`, never a literal.

### Model files and releases

The model files are gitignored; only the two `models/version.txt` files are tracked. Publishing a retrained model means bumping `version.txt`, creating a matching GitHub Release, and uploading `model_int8.ort` + `config.json` as assets. **`bin/test.sh` does not download them and asserts no accuracy figure** — it runs identically on a clean clone with no model present.

**The detector's `version.txt` says `unreleased`, and the tracer's model must not change that.** It is trained on 46 fixture images below `layout.min_dpt` against a six-image validation split; it exists to prove the pipeline runs, and nothing measures it. Publishing it would ship a model nothing has evaluated, and there is no gate that would catch you — see below.

> **There is no automated model gate.** The marker-driven regression test and its 99.5% threshold were retired with the v4 conversion (issue #17), because v4 deletes the point markers they iterated and the number was a reproducibility check, never a generalization estimate. Nothing currently checks that a model rebuild matches the published one. A real held-out protocol waits on a fresh higher-DPT corpus — see `SPEC.md` § Accuracy. Do not plug the gap with a substitute gate.

**The model that ships is `detector/models/detector_int8.ort` (3.4 MiB)**, and it is the only one — Cloudflare Pages rejects files over 25 MiB, and the CNN's `model_int8.ort` is no longer copied because nothing loads it.

Which model ships is named **once**, in `ui/modelAssets.ts`: `ui/vite.config.ts` and `rr-live-view.ts` both import it, and `ui/tests/modelAssets.test.ts` fails if either writes the filename itself. They used to be two literals, and the gap between a build-time copy target and a run-time fetch is invisible to both the typechecker and the build. The editor loads no model at all (#19).

`bin/deploy.sh` strips nothing any more: it checks that `ort-wasm-simd-threaded.wasm` is present — the app cannot run without it, and it can no longer be fetched from a CDN — and aborts if anything in the deploy directory exceeds 25 MiB. `ui/vite.config.ts`'s `dropUnfetchableOrtWasm` deletes the second, hashed copy of that binary Rollup emits for the case where nothing sets `ort.env.wasm.wasmPaths`; the two places that do set it are pinned by `ui/tests/ortAssets.test.ts`.

`bin/test.sh` loops over the two Python projects and skips each **independently** when `uv sync` cannot resolve it; every other Python failure is fatal. The per-project skip matters because they pin torch in opposite directions on purpose — `classifier/resnet` tracks current, `detector` pins 2.2.2 for macOS x86_64 — so on the 2017 laptop the resnet checks skip while the detector's run, and on Apple silicon it will be the other way round. A shared skip would silently drop the checks for whichever project does work.

### Deploy

`bin/deploy.sh` regenerates `config.json`, builds the UI, rsyncs `ui/dist/` into `rails49.org/ui/` (gitignored), checks the bundle against Cloudflare's limits, and pushes `rails49.org/` — including the tracked `_headers` — to the Cloudflare Pages project `rails49-org` via `wrangler`. Credentials come from the environment or 1Password (`op://track-occupancy/Cloudflare Pages/…`).

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `iot49/rails49`, driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, used verbatim as label strings. See `docs/agents/triage-labels.md`.

### Domain docs

One document — `SPEC.md` at the repo root — plus the wayfinder maps on GitHub Issues as the decision record. **No `CONTEXT.md` and no `docs/adr/`**, by decision (#9). See `docs/agents/domain.md`.

## Contributing

AGPL-3.0 licensed (`LICENSE`). There is no CLA and no contributor gate on pull requests — contributions are taken under the project's own terms.

The project is AGPL-3.0 because the detector is derived from Ultralytics YOLO, which is AGPL-3.0; trained weights inherit those terms, and a client-side web app distributes them to every visitor. See issue #10 for the full reasoning. Dependency licences (MIT, BSD, Apache-2.0) are all one-way compatible into AGPL-3.0.

## 🛠 Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Deep Learning** | [Fastai](https://docs.fast.ai/), [PyTorch](https://pytorch.org/), [ONNX Runtime](https://onnxruntime.ai/) — `classifier/resnet/`; [Ultralytics](https://docs.ultralytics.com/) YOLO26n-OBB — `detector/` |
| **Frontend** | [Lit](https://lit.dev/), [Shoelace](https://shoelace.style/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/) |
| **Tooling** | [pnpm](https://pnpm.io/), [uv](https://github.com/astral-sh/uv), [Vitest](https://vitest.dev/) |
