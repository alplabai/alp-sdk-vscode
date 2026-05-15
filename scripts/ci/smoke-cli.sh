#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

CLI_PKG_JSON="$ROOT_DIR/packages/alp-cli/package.json"
PACKAGE_NAME="$(node -p "require('$CLI_PKG_JSON').name")"
BIN_COMMAND="$(node -p "Object.keys(require('$CLI_PKG_JSON').bin || {})[0] || ''")"

if [[ -z "$BIN_COMMAND" ]]; then
  echo "No CLI binary command found in package.json bin map." >&2
  exit 1
fi

if [[ $# -gt 0 ]]; then
  PACKAGE_TGZ="$1"
else
  mkdir -p dist
  PACKAGE_FILE="$(npm pack --workspace packages/alp-cli --pack-destination "$ROOT_DIR/dist" --json | node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(data[0].filename);")"
  PACKAGE_TGZ="dist/$PACKAGE_FILE"
fi

if [[ ! -f "$PACKAGE_TGZ" ]]; then
  echo "Package tarball not found: $PACKAGE_TGZ" >&2
  exit 1
fi

PACKAGE_TGZ="$(cd "$(dirname "$PACKAGE_TGZ")" && pwd)/$(basename "$PACKAGE_TGZ")"
PACKAGE_SOURCE="file:$PACKAGE_TGZ"

echo "Smoke package: $PACKAGE_NAME"
echo "Smoke bin: $BIN_COMMAND"
echo "Smoke tarball: $PACKAGE_TGZ"

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
  npm uninstall -g "$PACKAGE_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "::group::Global install smoke"
npm install -g "$PACKAGE_SOURCE"

if ! command -v "$BIN_COMMAND" >/dev/null 2>&1; then
  echo "Expected global command '$BIN_COMMAND' was not installed." >&2
  exit 1
fi

"$BIN_COMMAND" --help 2>&1 | tee "$TMP_DIR/help-global.txt"
grep -Eqi "ALP CLI|Usage: alp|Commands:" "$TMP_DIR/help-global.txt"
echo "::endgroup::"

echo "::group::npx smoke"
npx --yes "$PACKAGE_SOURCE" --help 2>&1 | tee "$TMP_DIR/help-npx.txt"
grep -Eqi "ALP CLI|Usage: alp|Commands:" "$TMP_DIR/help-npx.txt"
echo "::endgroup::"

echo "CLI smoke checks passed."
