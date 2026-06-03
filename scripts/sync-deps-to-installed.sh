#!/usr/bin/env bash
# Sync runtime node_modules to the installed VS Code extension.
# Run this after re-installing the VSIX to ensure deps are present.
set -euo pipefail

EXT_DIR=~/.vscode/extensions/alplabai.alp-sdk-0.3.0
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/node_modules"
PNPM="$SRC/.pnpm"
DEST="$EXT_DIR/node_modules"

if [ ! -d "$EXT_DIR" ]; then
  echo "Extension not installed at $EXT_DIR" >&2
  exit 1
fi

mkdir -p "$DEST"

copy_pkg() {
  local name=$1
  if [ -d "$SRC/$name" ]; then
    rm -rf "$DEST/$name"
    cp -r "$SRC/$name" "$DEST/$name"
    echo "✓ $name"
  else
    # Try pnpm virtual store
    local dir
    dir=$(find "$PNPM" -maxdepth 3 -name "$name" -type d 2>/dev/null | grep "node_modules/$name$" | head -1)
    if [ -n "$dir" ]; then
      rm -rf "$DEST/$name"
      cp -r "$dir" "$DEST/$name"
      echo "✓ $name (pnpm store)"
    else
      echo "✗ NOT FOUND: $name" >&2
    fi
  fi
}

# Direct runtime deps
copy_pkg js-yaml
copy_pkg vscode-languageclient
copy_pkg vscode-languageserver

# Transitive deps
copy_pkg vscode-languageserver-protocol
copy_pkg vscode-languageserver-types
copy_pkg vscode-jsonrpc
copy_pkg semver
copy_pkg minimatch
copy_pkg brace-expansion

# Handle pnpm-specific paths for protocol bundle
if [ -d "$PNPM/vscode-languageserver-protocol@3.17.5/node_modules/vscode-languageserver-protocol" ]; then
  for dep in vscode-languageserver-protocol vscode-languageserver-types vscode-jsonrpc; do
    rm -rf "$DEST/$dep"
    cp -r "$PNPM/vscode-languageserver-protocol@3.17.5/node_modules/$dep" "$DEST/$dep"
    echo "✓ $dep (protocol bundle)"
  done
fi

SEMVER_DIR=$(ls "$PNPM" 2>/dev/null | grep "^semver@7" | head -1)
if [ -n "$SEMVER_DIR" ] && [ ! -d "$DEST/semver" ]; then
  cp -r "$PNPM/$SEMVER_DIR/node_modules/semver" "$DEST/semver"
  echo "✓ semver (pnpm)"
fi

MINIMATCH_DIR=$(ls "$PNPM" 2>/dev/null | grep "^minimatch@5" | head -1)
if [ -n "$MINIMATCH_DIR" ] && [ ! -d "$DEST/minimatch" ]; then
  cp -r "$PNPM/$MINIMATCH_DIR/node_modules/minimatch" "$DEST/minimatch"
  echo "✓ minimatch (pnpm)"
fi

BRACE_DIR=$(ls "$PNPM" 2>/dev/null | grep "^brace-expansion" | head -1)
if [ -n "$BRACE_DIR" ] && [ ! -d "$DEST/brace-expansion" ]; then
  cp -r "$PNPM/$BRACE_DIR/node_modules/brace-expansion" "$DEST/brace-expansion"
  echo "✓ brace-expansion (pnpm)"
fi

echo ""
echo "Deps synced to $DEST"
ls "$DEST"
