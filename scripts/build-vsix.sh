#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# Check for Node.js
if ! command -v node &>/dev/null; then
    echo "Error: Node.js is required. Install from https://nodejs.org/" >&2
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Build with esbuild
echo "Building extension..."
if [ "${1:-}" = "--production" ]; then
    node esbuild.config.mjs --production
else
    node esbuild.config.mjs
fi

# Package VSIX
echo "Packaging VSIX..."
npx vsce package

VSIX=$(ls -t "$PROJECT_ROOT"/*.vsix 2>/dev/null | head -1)
if [ -n "$VSIX" ]; then
    echo "VSIX created: $VSIX"
fi
