# Developer Guidelines - rails49

Computer vision suite for model railroaders: camera-based track occupancy detection using CNN image classification.

## Organization

* Github monorepo at https://github.com/iot49/rails49.git
* UI served at https://rails49.org/ui
* Folder structure:
    * `ui/` : frontend webapp
    * `lib/` : shared TS libraries (r49 format parser, uid generator, ONNX Runtime classifier) — see `lib/CLAUDE.md`
    * `dataset/` : training/validation data and data-prep scripts (r49 layout files, `data_prep.ts`)
    * `classifier/resnet/` : Fastai/PyTorch training (uv project) and ONNX export, see notebooks `TRAIN.ipynb`, `TEST-CNN.ipynb`
    * `rails49.org/` : built static site deployed to production
    * `bin/` : dev/deploy scripts, see Commands below
    * `config.yaml` : source config; `config.json` is generated from it — do not edit `config.json` directly

## Commands

* `bin/generate_config.py` : regenerate `config.json` from `config.yaml`
* `bin/test.sh` : run tests; in CI, downloads `model.ort`/`config.json` from the `rails49` GitHub releases if missing locally
* `bin/deploy.sh` : regenerate config and deploy to Cloudflare Pages (pulls `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` from 1Password if not already set)

## Contributing

* Contributions require signing the CLA (`CLA.md`), enforced via a GitHub Action on PRs

## 🛠 Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Deep Learning** | [Fastai](https://docs.fast.ai/), [PyTorch](https://pytorch.org/), [ONNX Runtime](https://onnxruntime.ai/) — `classifier/resnet/` |
| **Frontend** | [Lit](https://lit.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/) |
| **Tooling** | [pnpm](https://pnpm.io/), [uv](https://github.com/astral-sh/uv) |
