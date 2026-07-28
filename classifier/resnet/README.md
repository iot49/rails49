# 🧠 CNN Track Occupancy Classifier

This directory contains the machine learning pipeline for training, validating, and testing the track occupancy classifier.

## 🚀 Machine Learning Pipeline

The track occupancy detection workflow is modular and spans multiple directories in this repository. Follow the steps below in order:

### 1. Data Preparation
Before training, you must extract training image crops from `.r49` railroad layout archives.
* **Location**: [dataset/](../dataset)
* **Action**: Run `pnpm run prep` in the dataset folder to scan the `.r49` layout files, extract 136x136 image crops, and split them deterministically (80/20) into a training/validation database in `dataset/data/`.
* **Documentation**: See the [Dataset Preparation Guide](../dataset/README.md) for more details.

### 2. Model Training & Export
Train the model and export it to cross-platform runtime formats.
* **Notebook**: [TRAIN.ipynb](TRAIN.ipynb)
* **Action**: Run all cells in `TRAIN.ipynb` to train a ResNet-18 model on the prepared dataset, evaluate its metrics, and export the trained model into optimized ONNX/ORT formats saved in the [models/](models) folder — full precision (`model.ort`, ~45 MB) and quantized (`model_int8.ort`, ~11 MB), plus `config.json`.

### 3. Model Deployment
**`model_int8.ort` is the model that ships.** Cloudflare Pages rejects files over 25 MiB, which the full-precision `model.ort` exceeds. The quantized model fits, and costs about one additional misclassification across the regression set (99.58% vs 99.69%). If you change which model ships, update all four of: `ui/vite.config.ts` (the static-copy target), the `_classifier.load()` calls in `rr-live-view.ts` and `rr-editor-view.ts`, `MODEL_FILE` in `bin/test.sh`, and the path in `lib/classifier/tests/regression.test.ts`.

* **Frontend Web UI**: The build copies `model_int8.ort` and `config.json` into the web bundle for client-side ONNX runtime execution. See the [Web UI Guide](../ui/README.md) for details.
* **Action**: Run `bin/deploy.sh` from the repository root to build the UI and publish it to Cloudflare Pages. It aborts if any file would exceed the 25 MiB limit.

### 3a. Publishing Model Releases
Because model files exceed GitHub's file size limit, they are not checked into Git. Instead, they are synced from GitHub Releases:
1. When you retrain the model and export new models to [models/](models), update [models/version.txt](models/version.txt) with a new version tag (e.g., `v1.0.1`).
2. Create a GitHub Release matching that version tag (e.g., `v1.0.1`).
3. Upload `model_int8.ort` and `config.json` as assets to that GitHub Release.

`bin/test.sh` reads `version.txt` and downloads those assets when running in CI, so the classification regression test always runs against the released model.

> **⚠️ TODO:** Automate this process using a script (e.g., using `gh` CLI) to automatically package, version, tag, and upload the models.

### 4. Diagnostic Verification
Validate the accuracy of the exported model against the full set of labelled archives.
* **Script**: [dataset/src/online_diagnostics.ts](../../dataset/src/online_diagnostics.ts)
* **Action**: Run `pnpm --filter dataset online-diagnostics` to classify every marker in `dataset/r49/` with the exported model and print a confusion matrix.

---

## 📂 Folder Contents

* **[models/](models)**: Output directory for PyTorch (`.pth`), ONNX (`.onnx`), and Web-Optimized (`.ort`) models, along with their label mappings (`config.json`).
* **[src/](src)**: Python source code, utility classes, and custom helper methods used within the notebooks.
* **[pyproject.toml](pyproject.toml)**: Dependency specification for `uv` (FastAI, PyTorch, ONNX runtime, etc.).

