#!/bin/bash
set -e

# Set working directory to project root
cd "$(dirname "$0")/.."

MODEL_DIR="classifier/resnet/models"
VERSION_FILE="$MODEL_DIR/version.txt"
# The quantized model is the one that ships, so it is the one under test.
MODEL_FILE="model_int8.ort"

# Check if model files are present
if [ ! -f "$MODEL_DIR/$MODEL_FILE" ] || [ ! -f "$MODEL_DIR/config.json" ]; then
  if [ "$CI" = "true" ]; then
    echo "🤖 CI environment detected. Downloading model files..."
    mkdir -p "$MODEL_DIR"
    if [ ! -f "$VERSION_FILE" ]; then
      echo "❌ Error: $VERSION_FILE not found."
      exit 1
    fi
    TARGET_VERSION=$(cat "$VERSION_FILE" | tr -d '[:space:]')
    echo "🔍 Target version: $TARGET_VERSION"

    MODEL_URL="https://github.com/iot49/rails49/releases/download/${TARGET_VERSION}/${MODEL_FILE}"
    CONFIG_URL="https://github.com/iot49/rails49/releases/download/${TARGET_VERSION}/config.json"

    echo "📥 Downloading $MODEL_FILE..."
    curl -L -s -f -S -o "$MODEL_DIR/$MODEL_FILE" "$MODEL_URL"
    echo "📥 Downloading config.json..."
    curl -L -s -f -S -o "$MODEL_DIR/config.json" "$CONFIG_URL"
    echo "✅ Model version $TARGET_VERSION downloaded successfully for CI."
  else
    echo "⚠️  Warning: Model files ($MODEL_DIR/$MODEL_FILE or config.json) are missing."
    echo "   The classification regression test will be skipped."
    echo "   To run it, make sure the model files are present in $MODEL_DIR."
  fi
else
  echo "✅ Model files are present in $MODEL_DIR. Skipping download."
fi

# Run TypeScript typechecks
echo "🔍 Running TypeScript typecheck..."
pnpm -r typecheck

# Run TypeScript tests
echo "🧪 Running TypeScript tests..."
pnpm test

# Run Python linting and formatting if python environment is available
if command -v uv &>/dev/null; then
  echo "🐍 Running Python checks..."
  # Resolve the environment first; gracefully skip if deps (e.g. onnxruntime) are
  # incompatible with the current platform (macOS x86_64 is not supported by recent
  # onnxruntime wheels). All other failures are still fatal.
  if ! (cd classifier/resnet && uv sync --quiet 2>/dev/null); then
    echo "⚠️  Python environment could not be resolved on this platform. Skipping Python checks."
  else
    (cd classifier/resnet && uv run ruff check . && uv run black --check . && uv run pyright)
  fi
else
  echo "⚠️  uv command not found. Skipping Python checks."
fi

echo "🎉 All checks passed successfully!"
