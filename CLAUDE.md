# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Computer vision suite for model railroaders: camera-based track occupancy detection using CNN image classification. Monorepo at https://github.com/iot49/rails49.git; UI served at https://rails49.org/ui.

**Safety note (from README):** the classifier does sometimes miss rolling stock or report phantom trains. Nothing here should be presented as a safety interlock.

**`SPEC.md` at the root is the requirements document for the whole project** — the `.r49` v4 format, the occupancy output contract, labeling UX, training-data derivation, and the reasoning behind each. It describes the **target**, and parts of it are still unbuilt. Where SPEC and the code disagree, that is the migration, not a bug to fix. This file describes what exists and how to build it; SPEC describes what it is for.

**SPEC § Format is now implemented.** The manifest is **v4** — cars as two-point spans with provenance, sensors per layout, multi-point calibration, `labeled_complete` per image — and `@occupancy/r49` reads and writes nothing else. What remains ahead of the code: **most of the v4 editor** — the calibration-point tool landed in #28, its drag in #30 and the right-click context menu in #29, but car and sensor authoring, the tool palette and the completeness affordance have not — and **the detector** (nothing trains, exports, or runs YOLO yet; `detector.*` in `config.yaml` is values only). See `ui/CLAUDE.md` for the editor's reduced state.

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
| Typecheck one package | `pnpm --filter dataset typecheck` |
| Python lint/format/types | `cd classifier/resnet && uv run ruff check . && uv run black --check . && uv run pyright` |
| Install pre-push hook (runs `bin/test.sh`) | `bin/install-hooks.sh` |

The UI dev server serves over HTTPS by default because `getUserMedia` requires a secure context — a phone on the LAN needs the HTTPS URL. It also sets COOP/COEP headers, required for ONNX Runtime's threaded WASM.

## Architecture

### The pipeline

The whole system is one data path; each directory is a stage in it.

```
.r49 archives (dataset/r49/)      v4: layout photos, calibration, zero labels
        │  ✗ PARKED — no derivation runs today (see below)
        ▼
dataset/data/                     136×136 crops, deterministic 80/20 split, data.csv
        │  classifier/resnet/TRAIN.ipynb   (Fastai ResNet-18 → ONNX → ORT)
        ▼
classifier/resnet/models/         model_int8.ort + config.json  (NOT in git)
        │
        └─▶ ui/       BrowserClassifier, onnxruntime-web   ← fetched at runtime
```

### The six archives

`dataset/r49/` holds six v4 archives — 46 images, real calibration, **zero labels**, ready for hand-relabeling. They were converted from v3 once, in place, by a throwaway script that was deleted with the conversion (#22); the originals stay recoverable from git history. All 1195 v3 point markers were **dropped, not promoted** — a point carries neither extent nor orientation, so any promotion would be fabricated geometry entering the corpus. `lib/r49/tests/fixtures.test.ts` is the regression guard and asserts exactly what the conversion promised, including that each archive still reports the DPT it reported under v3.

> They are **UI fixtures, not training data.** They sit at DPT 18–19, below `layout.min_dpt` of 20, so no number derived from them predicts model accuracy. Training will use fresh, higher-DPT images captured later.

**The first arrow does not currently run.** `dataset/src/data_prep.ts` and `dataset/src/online_diagnostics.ts` are **parked stubs** that print their reason and exit non-zero — they derived crops and scored a confusion matrix from v3 point markers, which v4 does not store. Deriving from car spans alone gives every crop the same tag, so the vocabulary collapses to one degenerate class with no negatives. See `SPEC.md` § v4 cannot produce a trainable CNN dataset (issues #8, #18). The documented route back is sampling background crops as verified negatives — an experiment, dormant while the ResNet is. **Do not revive them by inventing a substitute vocabulary or synthesising negatives.**

### `config.yaml` is authored; everything else is generated

`config.yaml` is the single source for parameters that must agree across stages (`crop_size`, normalization mean/std, training hyperparameters, layout and detector constants, scale→ratio table). `pnpm config:generate` emits **two** derived representations from it:

| Output | Tracked? | Consumed by |
| :--- | :--- | :--- |
| `config.json` | **gitignored** — absent on a fresh clone until you generate | `ui/vite.config.ts` (for `__RAILS_DOMAIN__`), the model export |
| `lib/config/src/` | **committed** | `@occupancy/r49`, and TypeScript generally |

`lib/config` is committed precisely so a fresh clone typechecks before anyone runs a generator. **Never hand-edit either output** — edit `config.yaml` and regenerate. `bin/test.sh` regenerates `lib/config` into a temp tree and diffs, so editing `config.yaml` without regenerating fails the full check with the command to run rather than surfacing at runtime.

`@occupancy/r49` derives `STANDARD_GAUGE`, the scale→ratio table, and its scale enum from `lib/config` rather than declaring any of them. That is the point of the package: those constants used to exist in both `config.yaml` and `manifest.schema.ts` with nothing checking that they matched. Python keeps reading `config.yaml` directly and does not consume `lib/config`.

> ⚠️ **`detector.classes` is append-only.** A list position *is* a YOLO class index, so reordering or deleting an entry invalidates trained weights while the file still validates — the one config edit that can break a model with nothing noticing. The generator preserves its order exactly and must keep doing so.

`classifier.labels` is **deleted, not corrected**: it named a four-tag CNN vocabulary v4 cannot produce, and nothing could verify it (`TRAIN.ipynb` takes its labels from the dataset vocab). The generator fails loudly if the key reappears.

### Workspace packages

`pnpm-workspace.yaml` covers `lib/*`, `ui`, `dataset`. The `lib/*` packages are consumed **as TypeScript source** — nothing under `lib/` is built or published.

* `@occupancy/r49` — `.r49` archive parser/serializer (zip of `manifest.json` + images), zod-validated **v4-only** manifest schema, scale geometry (`getDPT`, and `getDPTResidual` — the same least-squares fit's disagreement, in image pixels, which is what makes a mis-typed world coordinate visible instead of silently absorbed into the scale). Loading a v3 archive fails on the version number alone: there is no compatibility shim, because a point marker carries neither extent nor orientation and so cannot be migrated. Its gauge, scale ratios and scale enum come from `@occupancy/config`.
* `@occupancy/config` — **generated** from `config.yaml`, committed. Layout and detector constants.
* `@occupancy/uid` — Snowflake-style id generator
* `@occupancy/classifier` — ONNX Runtime classifier; **three entry points**, and the split is load-bearing: `.` exports only `ClassifierConfig`, `./browser` exports `BrowserClassifier`, `./node` exports `NodeClassifier`. This is what keeps `onnxruntime-node` and `sharp` out of the browser bundle. Shared preprocessing math lives in the unexported `BaseClassifier`.

**Read `lib/CLAUDE.md` before touching anything under `lib/`.** Each package's `src/index.ts` is its interface (explicit exports only, no implementation, no `export *`), TSDoc goes on the declaration rather than the re-export line, and the root `tsconfig.json` deliberately has no `paths` block so `package.json` `"exports"` is the one boundary that binds identically at typecheck and at bundle time.

### UI (`ui/`)

Lit + Shoelace + Vite. Per-component contracts are documented at length in `ui/README.md`; the load-bearing points:

* All custom elements are prefixed `rr-` (railroad). Non-element modules use plain camelCase filenames (`marker.ts`, `capture.ts`).
* `rr-viewer` is shared by both the editor and live views — same component, `src` (image) in one, `stream` (video) in the other. Its `<img>`/`<video>` use `object-fit: contain` matched to the SVG's `preserveAspectRatio="xMidYMid meet"`, so the SVG viewBox maps 1:1 to image pixel coordinates and marker placement is identical in both modes. It **reports pointer gestures but authors nothing** — the editor was reduced to v4-supportable surfaces in #19, and #27 gave the viewer typed `rr-pointer-*` events carrying image-pixel coordinates plus a pure `ui/src/geometry.ts` (car width from DPT, span→rectangle, hit-testing). #28 gave those events their first consumer: `rr-editor-view` places and edits **calibration points**, the one geometry the editor authors today, #30 made them draggable at one history entry per gesture, and #29 added the state-dependent right-click and the context menu that deletes through it. Cars and sensors are still absent. See `ui/CLAUDE.md`.
* `marker.ts` is a module, not a custom element, because custom elements break the SVG namespace inside `<svg>`. Its three exports (`renderMarker`, `markerDefs`, `markerStyles`) must be used together.
* The app is entirely client-side: layouts are opened and saved as `.r49` files through the file picker, and inference runs in the browser via ONNX Runtime's WASM backend. There is no backend — don't reintroduce one without discussion.
* `__RAILS_DOMAIN__` is injected at build time by `ui/vite.config.ts`, read from `config.json` (falling back to `config.yaml`, then `rails49.org`). It is used only to recognize the deployed site, which switches the ORT WASM assets over to the jsDelivr CDN because `bin/deploy.sh` strips them from the bundle.
* Vite copies `classifier/resnet/models/*.{ort,json}` into the bundle **only if that directory exists**, so builds succeed without a local model.

### Model files and releases

The model files are gitignored; only `classifier/resnet/models/version.txt` is tracked. Publishing a retrained model means bumping `version.txt`, creating a matching GitHub Release, and uploading `model_int8.ort` + `config.json` as assets. **`bin/test.sh` does not download them and asserts no accuracy figure** — it runs identically on a clean clone with no model present.

> **There is no automated model gate.** The marker-driven regression test and its 99.5% threshold were retired with the v4 conversion (issue #17), because v4 deletes the point markers they iterated and the number was a reproducibility check, never a generalization estimate. Nothing currently checks that a model rebuild matches the published one. A real held-out protocol waits on a fresh higher-DPT corpus — see `SPEC.md` § Accuracy. Do not plug the gap with a substitute gate.

**`model_int8.ort` (11 MB) is the model that ships, not `model.ort` (45 MB)** — Cloudflare Pages rejects files over 25 MiB.

Which model ships is named in two places, and they must agree: the static-copy target in `ui/vite.config.ts` and the `_classifier.load()` call in `rr-live-view.ts`. The editor no longer loads a classifier (#19).

`bin/deploy.sh` still strips `*.wasm` (26 MB, also over the limit) — those load from the jsDelivr CDN in production, selected by the `wasmPaths` branch in `rr-live-view.ts`. The script now aborts if anything in the deploy directory still exceeds 25 MiB.

`bin/test.sh` also skips the Python checks when `uv sync` cannot resolve the environment (recent `onnxruntime` wheels have no macOS x86_64 build); every other Python failure is fatal.

### Deploy

`bin/deploy.sh` regenerates `config.json`, builds the UI, rsyncs `ui/dist/` into `rails49.org/ui/` (gitignored), strips the large assets, and pushes `rails49.org/` to the Cloudflare Pages project `rails49-org` via `wrangler`. Credentials come from the environment or 1Password (`op://track-occupancy/Cloudflare Pages/…`).

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
| **Deep Learning** | [Fastai](https://docs.fast.ai/), [PyTorch](https://pytorch.org/), [ONNX Runtime](https://onnxruntime.ai/) — `classifier/resnet/` |
| **Frontend** | [Lit](https://lit.dev/), [Shoelace](https://shoelace.style/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/) |
| **Tooling** | [pnpm](https://pnpm.io/), [uv](https://github.com/astral-sh/uv), [Vitest](https://vitest.dev/) |
