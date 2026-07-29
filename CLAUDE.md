# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Computer vision suite for model railroaders: camera-based track occupancy detection using CNN image classification. Monorepo at https://github.com/iot49/rails49.git; UI served at https://rails49.org/ui.

**Safety note (from README):** the classifier does sometimes miss rolling stock or report phantom trains. Nothing here should be presented as a safety interlock.

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
| Regenerate `config.json` | `pnpm config:generate` (or `bin/generate_config.py`) |
| Deploy to Cloudflare Pages | `bin/deploy.sh` |
| Rebuild training dataset | `pnpm --filter dataset prep` |
| Python lint/format/types | `cd classifier/resnet && uv run ruff check . && uv run black --check . && uv run pyright` |
| Install pre-push hook (runs `bin/test.sh`) | `bin/install-hooks.sh` |

The UI dev server serves over HTTPS by default because `getUserMedia` requires a secure context — a phone on the LAN needs the HTTPS URL. It also sets COOP/COEP headers, required for ONNX Runtime's threaded WASM.

## Architecture

### The pipeline

The whole system is one data path; each directory is a stage in it.

```
.r49 archives (dataset/r49/)      layout photos + marker labels, zipped
        │  pnpm --filter dataset prep      (dataset/src/data_prep.ts)
        ▼
dataset/data/                     136×136 crops, deterministic 80/20 split, data.csv
        │  classifier/resnet/TRAIN.ipynb   (Fastai ResNet-18 → ONNX → ORT)
        ▼
classifier/resnet/models/         model_int8.ort + config.json  (NOT in git)
        │
        ├─▶ ui/       BrowserClassifier, onnxruntime-web   ← fetched at runtime
        └─▶ dataset/  NodeClassifier, onnxruntime-node
```

`config.yaml` is the single source for parameters that must agree across stages (labels, `crop_size`, normalization mean/std, training hyperparameters, scale→ratio table). `config.json` is generated from it and is **gitignored** — never edit it directly, and expect it to be absent on a fresh clone until `pnpm config:generate` runs.

`pnpm --filter dataset online-diagnostics` re-classifies every marker in `dataset/r49/` with the exported model and writes a confusion matrix to `classifier/resnet/results/`.

### Workspace packages

`pnpm-workspace.yaml` covers `lib/*`, `ui`, `dataset`. The `lib/*` packages are consumed **as TypeScript source** — nothing under `lib/` is built or published.

* `@occupancy/r49` — `.r49` archive parser/serializer (zip of `manifest.json` + images), zod-validated v3 manifest schema, scale geometry (`getGauge`, `getDPT`)
* `@occupancy/uid` — Snowflake-style id generator
* `@occupancy/classifier` — ONNX Runtime classifier; **three entry points**, and the split is load-bearing: `.` exports only `ClassifierConfig`, `./browser` exports `BrowserClassifier`, `./node` exports `NodeClassifier`. This is what keeps `onnxruntime-node` and `sharp` out of the browser bundle. Shared preprocessing math lives in the unexported `BaseClassifier`.

**Read `lib/CLAUDE.md` before touching anything under `lib/`.** Each package's `src/index.ts` is its interface (explicit exports only, no implementation, no `export *`), TSDoc goes on the declaration rather than the re-export line, and the root `tsconfig.json` deliberately has no `paths` block so `package.json` `"exports"` is the one boundary that binds identically at typecheck and at bundle time.

### UI (`ui/`)

Lit + Shoelace + Vite. Per-component contracts are documented at length in `ui/README.md`; the load-bearing points:

* All custom elements are prefixed `rr-` (railroad). Non-element modules use plain camelCase filenames (`marker.ts`, `capture.ts`).
* `rr-viewer` is shared by both the editor and live views — same component, `src` (image) in one, `stream` (video) in the other. Its `<img>`/`<video>` use `object-fit: contain` matched to the SVG's `preserveAspectRatio="xMidYMid meet"`, so the SVG viewBox maps 1:1 to image pixel coordinates and marker placement is identical in both modes.
* `marker.ts` is a module, not a custom element, because custom elements break the SVG namespace inside `<svg>`. Its three exports (`renderMarker`, `markerDefs`, `markerStyles`) must be used together.
* The app is entirely client-side: layouts are opened and saved as `.r49` files through the file picker, and inference runs in the browser via ONNX Runtime's WASM backend. There is no backend — don't reintroduce one without discussion.
* `__RAILS_DOMAIN__` is injected at build time by `ui/vite.config.ts`, read from `config.json` (falling back to `config.yaml`, then `rails49.org`). It is used only to recognize the deployed site, which switches the ORT WASM assets over to the jsDelivr CDN because `bin/deploy.sh` strips them from the bundle.
* Vite copies `classifier/resnet/models/*.{ort,json}` into the bundle **only if that directory exists**, so builds succeed without a local model.

### Model files and releases

The model files are gitignored; only `classifier/resnet/models/version.txt` is tracked. Publishing a retrained model means bumping `version.txt`, creating a matching GitHub Release, and uploading `model_int8.ort` + `config.json` as assets. `bin/test.sh` downloads them from that release when `CI=true`; locally it warns and skips the classification regression test instead.

**`model_int8.ort` (11 MB) is the model that ships, not `model.ort` (45 MB)** — Cloudflare Pages rejects files over 25 MiB. The quantized model scores 99.58% on the regression set against the full model's 99.69%, i.e. one extra error out of 963; the test gate is 99.5%, so there is under one sample of headroom. Retraining that regresses even slightly will fail CI.

Which model ships is named in four places, and they must agree: the static-copy target in `ui/vite.config.ts`, the `_classifier.load()` calls in `rr-live-view.ts` and `rr-editor-view.ts`, `MODEL_FILE` in `bin/test.sh`, and the path in `lib/classifier/tests/regression.test.ts`.

`bin/deploy.sh` still strips `*.wasm` (26 MB, also over the limit) — those load from the jsDelivr CDN in production, selected by the `wasmPaths` branch in the two view components. The script now aborts if anything in the deploy directory still exceeds 25 MiB.

`bin/test.sh` also skips the Python checks when `uv sync` cannot resolve the environment (recent `onnxruntime` wheels have no macOS x86_64 build); every other Python failure is fatal.

### Deploy

`bin/deploy.sh` regenerates `config.json`, builds the UI, rsyncs `ui/dist/` into `rails49.org/ui/` (gitignored), strips the large assets, and pushes `rails49.org/` to the Cloudflare Pages project `rails49-org` via `wrangler`. Credentials come from the environment or 1Password (`op://track-occupancy/Cloudflare Pages/…`).

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `iot49/rails49`, driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, used verbatim as label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Contributing

AGPL-3.0 licensed (`LICENSE`). There is no CLA and no contributor gate on pull requests — contributions are taken under the project's own terms.

The project is AGPL-3.0 because the detector is derived from Ultralytics YOLO, which is AGPL-3.0; trained weights inherit those terms, and a client-side web app distributes them to every visitor. See issue #10 for the full reasoning. Dependency licences (MIT, BSD, Apache-2.0) are all one-way compatible into AGPL-3.0.

## 🛠 Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Deep Learning** | [Fastai](https://docs.fast.ai/), [PyTorch](https://pytorch.org/), [ONNX Runtime](https://onnxruntime.ai/) — `classifier/resnet/` |
| **Frontend** | [Lit](https://lit.dev/), [Shoelace](https://shoelace.style/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/) |
| **Tooling** | [pnpm](https://pnpm.io/), [uv](https://github.com/astral-sh/uv), [Vitest](https://vitest.dev/) |
