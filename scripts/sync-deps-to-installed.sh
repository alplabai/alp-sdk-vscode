#!/usr/bin/env bash
# Sync runtime node_modules to the installed VS Code extension.
# Run this after re-installing the VSIX to ensure deps are present.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Resolve the installed extension dir from package.json's version — VS Code folders
# the extension under the LOWERCASE publisher (alplabai.alp-sdk-<version>), even
# though the manifest publisher is the canonical AlpLabAI. Fall back to the newest
# installed alp-sdk dir if that exact version is not present.
# Read the version via a RELATIVE require from inside $ROOT: under Git Bash on
# Windows, node.exe cannot resolve an MSYS absolute path ("/c/Users/...") passed
# into require(), but `cd "$ROOT"` puts node's cwd at the real Windows directory
# so "./package.json" resolves everywhere. (`set -e` + the old absolute path was
# the "Cannot find module '/c/.../package.json'" install failure on Windows.)
VERSION="$(cd "$ROOT" && node -p "require('./package.json').version")"
EXT_DIR=~/.vscode/extensions/alplabai.alp-sdk-$VERSION
if [ ! -d "$EXT_DIR" ]; then
  EXT_DIR=$(ls -d ~/.vscode/extensions/alplabai.alp-sdk-* 2>/dev/null | sort -V | tail -1)
fi
SRC="$ROOT/node_modules"
PNPM="$SRC/.pnpm"
DEST="$EXT_DIR/node_modules"

if [ ! -d "$EXT_DIR" ]; then
  echo "Extension not installed at $EXT_DIR" >&2
  exit 1
fi

mkdir -p "$DEST"

# NOTE: `cp -rL` (dereference), not `cp -r`. In a pnpm workspace the direct deps
# under node_modules/ are SYMLINKS into the .pnpm store; a plain `cp -r` tries to
# recreate the symlink at the destination and fails ("cannot create symbolic
# link"), which under `set -e` aborts the sync and leaves js-yaml /
# vscode-languageclient / vscode-languageserver missing from the installed
# extension. `-L` copies the real package files. pnpm keeps each package's own
# deps as store siblings (not nested), so this stays flat — no deep store walk.
copy_pkg() {
  local name=$1
  if [ -d "$SRC/$name" ]; then
    rm -rf "$DEST/$name"
    cp -rL "$SRC/$name" "$DEST/$name"
    echo "✓ $name"
  else
    # Try pnpm virtual store
    local dir
    # `|| true`: under `set -euo pipefail` a grep no-match (or head closing the
    # pipe early) exits non-zero and would abort the whole sync; the `[ -n ]`
    # test below is the intended not-found handler.
    dir=$(find "$PNPM" -maxdepth 3 -name "$name" -type d 2>/dev/null | grep "node_modules/$name$" | head -1 || true)
    if [ -n "$dir" ]; then
      rm -rf "$DEST/$name"
      cp -rL "$dir" "$DEST/$name"
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
    cp -rL "$PNPM/vscode-languageserver-protocol@3.17.5/node_modules/$dep" "$DEST/$dep"
    echo "✓ $dep (protocol bundle)"
  done
fi

# `|| true` on each of the three greps below for the same reason as copy_pkg's:
# under `set -euo pipefail` a grep no-match aborts the whole script. pnpm 11 no
# longer materializes semver@*/minimatch@*/brace-expansion* dirs in .pnpm, so all
# three miss — the sync completed but exited 1, which under install-vscode.sh's
# own `set -e` swallowed the final "Installed extension:" confirmation.
SEMVER_DIR=$(ls "$PNPM" 2>/dev/null | grep "^semver@7" | head -1 || true)
if [ -n "$SEMVER_DIR" ] && [ ! -d "$DEST/semver" ]; then
  cp -rL "$PNPM/$SEMVER_DIR/node_modules/semver" "$DEST/semver"
  echo "✓ semver (pnpm)"
fi

MINIMATCH_DIR=$(ls "$PNPM" 2>/dev/null | grep "^minimatch@5" | head -1 || true)
if [ -n "$MINIMATCH_DIR" ] && [ ! -d "$DEST/minimatch" ]; then
  cp -rL "$PNPM/$MINIMATCH_DIR/node_modules/minimatch" "$DEST/minimatch"
  echo "✓ minimatch (pnpm)"
fi

BRACE_DIR=$(ls "$PNPM" 2>/dev/null | grep "^brace-expansion" | head -1 || true)
if [ -n "$BRACE_DIR" ] && [ ! -d "$DEST/brace-expansion" ]; then
  cp -rL "$PNPM/$BRACE_DIR/node_modules/brace-expansion" "$DEST/brace-expansion"
  echo "✓ brace-expansion (pnpm)"
fi

echo ""
echo "Deps synced to $DEST"
ls "$DEST"
