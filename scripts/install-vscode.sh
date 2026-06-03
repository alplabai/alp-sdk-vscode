#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

CODE_BIN="code"
SKIP_COMPILE=0
SKIP_PACKAGE=0
DRY_RUN=0
VSIX_PATH=""

usage() {
  cat <<'EOF'
Build, package, and install ALP SDK extension into VS Code.

Usage:
  ./scripts/install-vscode.sh [options]

Options:
  --code-bin <cmd>   VS Code CLI command (default: code)
  --vsix <path>      Install this VSIX path (skips auto path resolution)
  --skip-compile     Skip pnpm run compile
  --skip-package     Skip VSIX packaging step
  --dry-run          Print planned commands without executing
  -h, --help         Show this help

Examples:
  ./scripts/install-vscode.sh
  ./scripts/install-vscode.sh --code-bin code-insiders
  ./scripts/install-vscode.sh --skip-package --vsix ./alp-sdk-0.3.0.vsix
EOF
}

run_cmd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[dry-run] $*"
    return 0
  fi
  "$@"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --code-bin)
      [[ $# -ge 2 ]] || { echo "Missing value for --code-bin" >&2; exit 1; }
      CODE_BIN="$2"
      shift 2
      ;;
    --vsix)
      [[ $# -ge 2 ]] || { echo "Missing value for --vsix" >&2; exit 1; }
      VSIX_PATH="$2"
      shift 2
      ;;
    --skip-compile)
      SKIP_COMPILE=1
      shift
      ;;
    --skip-package)
      SKIP_PACKAGE=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "$SKIP_PACKAGE" -eq 1 && -z "$VSIX_PATH" ]]; then
  echo "--skip-package requires --vsix <path> for installation." >&2
  exit 1
fi

cd "$REPO_ROOT"

if [[ ! -f package.json ]]; then
  echo "package.json not found in repo root: $REPO_ROOT" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node is required but not found on PATH." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required but not found on PATH." >&2
  exit 1
fi

if ! command -v "$CODE_BIN" >/dev/null 2>&1; then
  echo "VS Code CLI '$CODE_BIN' not found on PATH." >&2
  echo "Tip: In VS Code, run 'Shell Command: Install \"code\" command in PATH'." >&2
  exit 1
fi

EXT_NAME="$(node -p "require('./package.json').name")"
EXT_VERSION="$(node -p "require('./package.json').version")"
EXT_PUBLISHER="$(node -p "require('./package.json').publisher")"
EXT_ID="${EXT_PUBLISHER}.${EXT_NAME}"

if [[ -z "$VSIX_PATH" ]]; then
  VSIX_PATH="$REPO_ROOT/${EXT_NAME}-${EXT_VERSION}.vsix"
fi

if [[ "$SKIP_COMPILE" -eq 0 ]]; then
  run_cmd pnpm run compile
else
  echo "Skipping compile step (--skip-compile)."
fi

if [[ "$SKIP_PACKAGE" -eq 0 ]]; then
  run_cmd pnpm exec vsce package --no-dependencies --out "$VSIX_PATH"
else
  echo "Skipping package step (--skip-package)."
fi

if [[ "$DRY_RUN" -eq 0 && ! -f "$VSIX_PATH" ]]; then
  echo "VSIX file was not found: $VSIX_PATH" >&2
  exit 1
fi

run_cmd "$CODE_BIN" --install-extension "$VSIX_PATH" --force

# Sync runtime node_modules (pnpm workspace: vsce --no-dependencies skips them)
run_cmd bash "${SCRIPT_DIR}/sync-deps-to-installed.sh"

echo "Installed extension: $EXT_ID"
echo "VSIX: $VSIX_PATH"
echo "If needed, run 'Developer: Reload Window' in VS Code."
