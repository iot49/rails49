# 🧠 CNN Track Occupancy Classifier

This directory contains the machine learning pipeline for training, validating, and testing the track occupancy classifier.

## 🚀 Machine Learning Pipeline

The track occupancy detection workflow is modular and spans multiple directories in this repository. Follow the steps below in order:

### 1. Data Preparation
Before training, you must extract training image crops from `.r49` railroad layout archives.
* **Location**: [dataset/](../dataset)
* **Action**: Run `pnpm run prep` in the dataset folder to scan the `.r49` layout files, extract 136x136 image crops, and split them deterministically (80/20) into a training/validation database in `db/`.
* **Documentation**: See the [Dataset Preparation Guide](../dataset/README.md) for more details.

### 2. Model Training & Export
Train the model and export it to cross-platform runtime formats.
* **Notebook**: [TRAIN.ipynb](TRAIN.ipynb)
* **Action**: Run all cells in `TRAIN.ipynb` to train a ResNet-18 model on the prepared dataset, evaluate its metrics, and export the trained model into optimized ONNX/ORT formats (`model.ort` and `config.json`) saved in the [models/](models) folder.

### 3. Model Deployment
Deploy the new models to both backend services and frontend browser clients.
* **Action**: Run the root deployment script `./deploy.sh` to sync the updated workspace to the edge server.
* **Backend Detector**: The TS detector service mounts the [models/](models) directory persistently to run real-time server-side ONNX classification. See the [Track Occupancy Detector Guide](../server/track-occupancy/README.md) for details.
* **Frontend Web UI**: The frontend build process automatically copies the contents of [models/](models) to the web bundle to support client-side ONNX runtime execution in the browser. See the [Web UI Guide](../ui/README.md) for details.

### 3a. Publishing Model Releases
Because model files exceed GitHub's file size limit, they are not checked into Git. Instead, they are synced from GitHub Releases:
1. When you retrain the model and export new `model.ort` and `config.json` to `cnn/models/`, update [cnn/models/version.txt](models/version.txt) with a new version tag (e.g., `v1.0.1`).
2. Create a GitHub Release matching that version tag (e.g., `v1.0.1`).
3. Upload `model.ort` and `config.json` as assets to that GitHub Release.
4. Run `./deploy.sh`. The deployment script will read the local `version.txt` and download those assets directly to the server.

> **⚠️ TODO:** Automate this process using a script (e.g., using `gh` CLI) to automatically package, version, tag, and upload the models.

### 4. Remote Diagnostic Verification
Validate the performance and accuracy of the deployed model against live benchmarks.
* **Notebook**: [TEST-CNN.ipynb](TEST-CNN.ipynb)
* **Action**: Run the cells in `TEST-CNN.ipynb` to trigger a remote diagnostic test via the edge server's test endpoint (`https://ui.${RAILS_DOMAIN}/api/test-cnn`) and inspect the classification accuracy, confusion matrices, and filters of the active production model.

---

## 📂 Folder Contents

* **[models/](models)**: Output directory for PyTorch (`.pth`), ONNX (`.onnx`), and Web-Optimized (`.ort`) models, along with their label mappings (`config.json`).
* **[src/](src)**: Python source code, utility classes, and custom helper methods used within the notebooks.
* **[pyproject.toml](pyproject.toml)**: Dependency specification for `uv` (FastAI, PyTorch, ONNX runtime, etc.).

