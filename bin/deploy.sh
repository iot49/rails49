#!/bin/bash
set -e

# Set working directory to project root (parent of bin/)
cd "$(dirname "$0")/.."

# Build config.json locally
echo "🔧 Generating config.json from config.yaml..."
if [ ! -f "config.yaml" ]; then
  echo "❌ Error: config.yaml not found at project root."
  exit 1
fi
uv run --with pyyaml python3 -c "import yaml, json; json.dump(yaml.safe_load(open('config.yaml')), open('config.json', 'w'), indent=2)"

# Ensure CLOUDFLARE_API_TOKEN is set
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  if command -v op &>/dev/null; then
    echo "🔑 Retrieving Cloudflare credentials dynamically from 1Password..."
    CLOUDFLARE_API_TOKEN=$(op read "op://track-occupancy/Cloudflare Pages/token")
    CLOUDFLARE_ACCOUNT_ID=$(op read "op://track-occupancy/Cloudflare Pages/account_id")
    export CLOUDFLARE_API_TOKEN
    export CLOUDFLARE_ACCOUNT_ID
  fi
fi

if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  echo "❌ Error: CLOUDFLARE_API_TOKEN is not set in the environment and could not be retrieved via 1Password."
  exit 1
fi

PROJECT_NAME="rails49-org"
DEPLOY_DIR="rails49.org"

# 1. Build the Lit UI assets
echo "📦 Building UI..."
pnpm --filter @occupancy/ui build

# 2. Sync built UI assets to the deployment directory under /ui
echo "📁 Syncing UI assets to '$DEPLOY_DIR/ui'..."
mkdir -p "$DEPLOY_DIR/ui"
rsync -a --delete ui/dist/ "$DEPLOY_DIR/ui/"

# 3. Clean up the large ONNX Runtime WASM binaries. They exceed Cloudflare's
#    25 MiB per-file limit and are loaded from the jsDelivr CDN in production
#    instead (see the wasmPaths branch in rr-live-view.ts / rr-editor-view.ts).
#    The quantized model (model_int8.ort, 11 MB) is under the limit and ships.
echo "🧹 Excluding large WASM files to stay under Cloudflare's 25 MiB file size limit..."
find "$DEPLOY_DIR/ui" -name "*.wasm" -delete

# Fail loudly rather than deploying a bundle Cloudflare will reject.
OVERSIZED=$(find "$DEPLOY_DIR" -type f -size +25M)
if [ -n "$OVERSIZED" ]; then
  echo "❌ Error: these files exceed Cloudflare's 25 MiB limit:"
  echo "$OVERSIZED"
  exit 1
fi

# Check if deploy directory exists
if [ ! -d "$DEPLOY_DIR" ]; then
  echo "❌ Error: Deployment directory '$DEPLOY_DIR' not found."
  exit 1
fi

# 4. Attempt to create the project in case it doesn't exist yet
echo "🌐 Ensuring Cloudflare Pages project '$PROJECT_NAME' exists..."
if [ -n "$CLOUDFLARE_ACCOUNT_ID" ]; then
  npx wrangler@3 pages project create "$PROJECT_NAME" --production-branch=main 2>/dev/null || echo "ℹ️  Project creation skipped or already exists."
else
  echo "⚠️  CLOUDFLARE_ACCOUNT_ID is not set. Attempting project creation without account ID..."
  npx wrangler@3 pages project create "$PROJECT_NAME" --production-branch=main 2>/dev/null || echo "ℹ️  Project creation skipped or already exists."
fi

# 2. Deploy the static assets
echo "🚀 Deploying static files from '$DEPLOY_DIR' to Cloudflare Pages..."
npx wrangler@3 pages deploy "$DEPLOY_DIR" --project-name="$PROJECT_NAME" --branch=main

echo "✅ Deployment successful! Your site is live on Cloudflare Pages."
