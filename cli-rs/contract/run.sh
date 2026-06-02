#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# Contract harness for the Rust alp CLI migration.
#
# Validate fixtures (fixtures/validate/*):
#   1. Rust `alp validate --format json` matches expected stdout + exit code.
#   2. TS `validateBoardYamlLocally` emits the same contract envelope.
#
# Generate fixtures (fixtures/generate/*):
#   Each fixture directory contains:
#     args.txt    — CLI flags (one line, space-separated, relative to cli-rs/)
#     expected.json — golden stdout
#     expected.exit — golden exit code

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CLI_RS_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd -- "$CLI_RS_DIR/.." && pwd)"
FIXTURE_ROOT="$SCRIPT_DIR/fixtures/validate"
RUST_BIN="$CLI_RS_DIR/target/debug/alp"

bless=0
rust_only=0

for arg in "$@"; do
  case "$arg" in
    --bless) bless=1 ;;
    --rust-only) rust_only=1 ;;
    *)
      echo "unknown argument: $arg" >&2
      exit 64
      ;;
  esac
done

cargo build --manifest-path "$CLI_RS_DIR/Cargo.toml" --quiet

if [[ "$rust_only" -eq 0 ]]; then
  (cd "$REPO_ROOT" && pnpm --filter @alp-sdk/core compile >/dev/null)
fi

failures=0

run_and_compare() {
  local engine="$1"
  local case_name="$2"
  local board_rel="$3"
  local expected_json="$4"
  local expected_exit="$5"
  local actual_json
  local actual_stderr
  local actual_exit

  actual_json="$(mktemp)"
  actual_stderr="$(mktemp)"

  set +e
  if [[ "$engine" == "rust" ]]; then
    # These fixtures pin the OFFLINE structural validator (TS-vs-Rust parity);
    # the spawn path is covered by fixtures/validate-full/*.
    (cd "$CLI_RS_DIR" && "$RUST_BIN" validate --offline --board-yaml "$board_rel" --format json >"$actual_json" 2>"$actual_stderr")
  else
    (cd "$CLI_RS_DIR" && node "$SCRIPT_DIR/offline-validate-ts.mjs" "$board_rel" >"$actual_json" 2>"$actual_stderr")
  fi
  actual_exit=$?
  set -e

  if [[ "$bless" -eq 1 && "$engine" == "rust" ]]; then
    cp "$actual_json" "$expected_json"
    printf "%s\n" "$actual_exit" >"$expected_exit"
  fi

  if ! diff -u "$expected_json" "$actual_json"; then
    echo "contract mismatch: $engine/$case_name stdout" >&2
    failures=$((failures + 1))
  fi

  local wanted_exit
  wanted_exit="$(tr -d '[:space:]' <"$expected_exit")"
  if [[ "$actual_exit" != "$wanted_exit" ]]; then
    echo "contract mismatch: $engine/$case_name exit code: got $actual_exit, expected $wanted_exit" >&2
    failures=$((failures + 1))
  fi

  if [[ -s "$actual_stderr" ]]; then
    echo "unexpected stderr: $engine/$case_name" >&2
    cat "$actual_stderr" >&2
    failures=$((failures + 1))
  fi

  rm -f "$actual_json" "$actual_stderr"
}

shopt -s nullglob
for case_dir in "$FIXTURE_ROOT"/*; do
  [[ -d "$case_dir" ]] || continue
  case_name="$(basename "$case_dir")"
  board_rel="contract/fixtures/validate/$case_name/board.yaml"
  expected_json="$case_dir/expected.json"
  expected_exit="$case_dir/expected.exit"

  run_and_compare rust "$case_name" "$board_rel" "$expected_json" "$expected_exit"

  if [[ "$rust_only" -eq 0 ]]; then
    run_and_compare ts "$case_name" "$board_rel" "$expected_json" "$expected_exit"
  fi
done

GEN_FIXTURE_ROOT="$SCRIPT_DIR/fixtures/generate"

run_generate_fixture() {
  local case_name="$1"
  local case_dir="$GEN_FIXTURE_ROOT/$case_name"
  local args_file="$case_dir/args.txt"
  local expected_json="$case_dir/expected.json"
  local expected_exit="$case_dir/expected.exit"

  [[ -f "$args_file" ]] || { echo "generate/$case_name: missing args.txt" >&2; failures=$((failures + 1)); return; }

  local extra_args
  extra_args="$(tr -d '\n' <"$args_file")"

  local actual_json actual_stderr actual_exit
  actual_json="$(mktemp)"
  actual_stderr="$(mktemp)"

  set +e
  # shellcheck disable=SC2086
  (cd "$CLI_RS_DIR" && "$RUST_BIN" generate $extra_args --format json >"$actual_json" 2>"$actual_stderr")
  actual_exit=$?
  set -e

  if [[ "$bless" -eq 1 ]]; then
    cp "$actual_json" "$expected_json"
    printf "%s\n" "$actual_exit" >"$expected_exit"
  fi

  if ! diff -u "$expected_json" "$actual_json"; then
    echo "contract mismatch: generate/$case_name stdout" >&2
    failures=$((failures + 1))
  fi

  local wanted_exit
  wanted_exit="$(tr -d '[:space:]' <"$expected_exit")"
  if [[ "$actual_exit" != "$wanted_exit" ]]; then
    echo "contract mismatch: generate/$case_name exit code: got $actual_exit, expected $wanted_exit" >&2
    failures=$((failures + 1))
  fi

  if [[ -s "$actual_stderr" ]]; then
    echo "unexpected stderr: generate/$case_name" >&2
    cat "$actual_stderr" >&2
    failures=$((failures + 1))
  fi

  rm -f "$actual_json" "$actual_stderr"
}

for case_dir in "$GEN_FIXTURE_ROOT"/*; do
  [[ -d "$case_dir" ]] || continue
  run_generate_fixture "$(basename "$case_dir")"
done

# ── Full-validate fixtures (fixtures/validate-full/*) ───────────────────────
# The real `alp validate` spawns <sdk>/scripts/validate_board_yaml.py. Each
# fixture ships a hermetic Python stub (canned stderr + exit code) so the spawn
# + classify + parse + envelope path is exercised deterministically without
# PyYAML or a real SDK. Rust-only golden (like generate); absolute path
# prefixes are normalized so goldens are machine-independent.
VALIDATE_FULL_ROOT="$SCRIPT_DIR/fixtures/validate-full"

normalize_paths() {
  sed "s|${CLI_RS_DIR}/||g"
}

run_validate_full_fixture() {
  local case_name="$1"
  local case_dir="$VALIDATE_FULL_ROOT/$case_name"
  local args_file="$case_dir/args.txt"
  local expected_json="$case_dir/expected.json"
  local expected_exit="$case_dir/expected.exit"

  [[ -f "$args_file" ]] || { echo "validate-full/$case_name: missing args.txt" >&2; failures=$((failures + 1)); return; }

  local extra_args
  extra_args="$(tr -d '\n' <"$args_file")"

  local actual_raw actual_json actual_stderr actual_exit
  actual_raw="$(mktemp)"
  actual_json="$(mktemp)"
  actual_stderr="$(mktemp)"

  set +e
  # shellcheck disable=SC2086
  (cd "$CLI_RS_DIR" && "$RUST_BIN" validate $extra_args --format json) >"$actual_raw" 2>"$actual_stderr"
  actual_exit=$?
  set -e
  normalize_paths <"$actual_raw" >"$actual_json"

  if [[ "$bless" -eq 1 ]]; then
    cp "$actual_json" "$expected_json"
    printf "%s\n" "$actual_exit" >"$expected_exit"
  fi

  if ! diff -u "$expected_json" "$actual_json"; then
    echo "contract mismatch: validate-full/$case_name stdout" >&2
    failures=$((failures + 1))
  fi

  local wanted_exit
  wanted_exit="$(tr -d '[:space:]' <"$expected_exit")"
  if [[ "$actual_exit" != "$wanted_exit" ]]; then
    echo "contract mismatch: validate-full/$case_name exit code: got $actual_exit, expected $wanted_exit" >&2
    failures=$((failures + 1))
  fi

  if [[ -s "$actual_stderr" ]]; then
    echo "unexpected stderr: validate-full/$case_name" >&2
    cat "$actual_stderr" >&2
    failures=$((failures + 1))
  fi

  rm -f "$actual_raw" "$actual_json" "$actual_stderr"
}

for case_dir in "$VALIDATE_FULL_ROOT"/*; do
  [[ -d "$case_dir" ]] || continue
  run_validate_full_fixture "$(basename "$case_dir")"
done

# ── Generic offline-command fixtures (fixtures/<command>/<case>/*) ───────────
# For deterministic, offline commands (completion, diff, presets): run the Rust
# binary with the fixture args and compare the path-normalized envelope against
# a Rust golden. Each fixture dir holds args.txt + expected.json + expected.exit.
run_command_fixture() {
  local subcommand="$1"
  local case_dir="$2"
  local case_name
  case_name="$(basename "$case_dir")"
  local args_file="$case_dir/args.txt"
  local expected_json="$case_dir/expected.json"
  local expected_exit="$case_dir/expected.exit"

  [[ -f "$args_file" ]] || { echo "$subcommand/$case_name: missing args.txt" >&2; failures=$((failures + 1)); return; }

  local extra_args
  extra_args="$(tr -d '\n' <"$args_file")"

  local raw json stderr code
  raw="$(mktemp)"
  json="$(mktemp)"
  stderr="$(mktemp)"

  set +e
  # SOURCE_DATE_EPOCH pins generatedAt for commands that timestamp output
  # (inspect/trace); harmless for the others.
  # shellcheck disable=SC2086
  (cd "$CLI_RS_DIR" && SOURCE_DATE_EPOCH=0 "$RUST_BIN" "$subcommand" $extra_args --format json) >"$raw" 2>"$stderr"
  code=$?
  set -e
  normalize_paths <"$raw" >"$json"

  if [[ "$bless" -eq 1 ]]; then
    cp "$json" "$expected_json"
    printf "%s\n" "$code" >"$expected_exit"
  fi

  if ! diff -u "$expected_json" "$json"; then
    echo "contract mismatch: $subcommand/$case_name stdout" >&2
    failures=$((failures + 1))
  fi

  local wanted_exit
  wanted_exit="$(tr -d '[:space:]' <"$expected_exit")"
  if [[ "$code" != "$wanted_exit" ]]; then
    echo "contract mismatch: $subcommand/$case_name exit code: got $code, expected $wanted_exit" >&2
    failures=$((failures + 1))
  fi

  if [[ -s "$stderr" ]]; then
    echo "unexpected stderr: $subcommand/$case_name" >&2
    cat "$stderr" >&2
    failures=$((failures + 1))
  fi

  rm -f "$raw" "$json" "$stderr"
}

for command_name in completion diff presets explain inspect trace debug-config support-bundle sdk; do
  command_root="$SCRIPT_DIR/fixtures/$command_name"
  [[ -d "$command_root" ]] || continue
  for case_dir in "$command_root"/*; do
    [[ -d "$case_dir" ]] || continue
    run_command_fixture "$command_name" "$case_dir"
  done
done

if [[ "$failures" -ne 0 ]]; then
  echo "contract harness failed with $failures mismatch(es)" >&2
  exit 1
fi

echo "contract harness passed"
