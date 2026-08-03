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

# 3. The ONNX Runtime WASM binary must ship from origin: `_headers` sets
#    Cross-Origin-Embedder-Policy: require-corp on /ui/ so the app is
#    crossOriginIsolated and ORT can use more than one thread (#15), and a
#    cross-origin CDN would fail that check. Only the plain build is copied
#    (see ui/ortAssets.ts) — the jsep one is over Cloudflare's limit.
ORT_WASM="ort-wasm-simd-threaded.wasm"
if [ ! -f "$DEPLOY_DIR/ui/ort/$ORT_WASM" ]; then
  echo "❌ Error: $ORT_WASM is missing from the bundle; the app would not run."
  exit 1
fi

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
