#!/bin/bash
# Installs the git pre-push hook so that bin/test.sh runs before every push.
set -e

cd "$(dirname "$0")/.."
HOOK=".git/hooks/pre-push"

cat > "$HOOK" << 'EOF'
#!/bin/bash
set -e
echo "🔒 Running pre-push checks (bin/test.sh)..."
"$(git rev-parse --show-toplevel)/bin/test.sh"
EOF

chmod +x "$HOOK"
echo "✅ Pre-push hook installed at $HOOK"
