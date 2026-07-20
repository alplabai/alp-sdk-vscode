#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Gate: assert a packaged .vsix ships only allowlisted TOP-LEVEL paths (#70).
#
# Shared by ci.yml and release-vsix.yml so the allowlist has ONE definition and
# the tag-triggered release VSIX is gated too (#170) — ci.yml runs on branches
# only, so a `v*` tag build would otherwise package + publish with no content
# check. Invoke via `bash scripts/check-vsix-allowlist.sh <file.vsix>`.
#
# Usage: bash scripts/check-vsix-allowlist.sh [path/to/file.vsix]
#        (defaults to alp-sdk.vsix)
set -euo pipefail

VSIX="${1:-alp-sdk.vsix}"

# Fail if anything outside the runtime allowlist enters the VSIX, so local
# tooling/agent artefacts (.agents, .claude, .code-review-graph, .superpowers,
# .scratch, AGENTS.md, ...) or stray files can never leak into the Marketplace
# package. Top-level only, per the acceptance criteria; sub-paths are governed
# by .vscodeignore.
# Lowercase for a case-robust compare: vsce normalises README/LICENSE
# (e.g. LICENSE -> LICENSE.txt) and case can differ across platforms.
top="$(mktemp)"
allow="$(mktemp)"
trap 'rm -f "$top" "$allow"' EXIT

unzip -Z1 "$VSIX" \
  | sed -n 's#^extension/##p' \
  | sed -E 's#/.*##' \
  | grep -v '^$' \
  | tr '[:upper:]' '[:lower:]' \
  | sort -u > "$top"

# `bin` holds the alp CLI bundled into the platform-specific (darwin-arm64)
# VSIX: release-vsix.yml stages it at bin/alp before `vsce package` (#124).
# The universal VSIX ships nothing there. Keep `bin` allowlisted so the
# bundled-CLI package does not trip this very gate.
printf '%s\n' bin license license.txt readme.md media out package.json \
  packages schemas snippets syntaxes \
  | sort -u > "$allow"

unexpected="$(comm -23 "$top" "$allow")"
if [ -n "$unexpected" ]; then
  echo "::error::VSIX contains unexpected top-level paths (see #70):"
  echo "$unexpected"
  exit 1
fi
echo "VSIX top-level contents OK: $(paste -sd' ' "$top")"
