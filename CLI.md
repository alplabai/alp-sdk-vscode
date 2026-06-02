# ALP CLI Contract

Last revised: 2026-05-14

This document defines the intended contract for the ALP command-line
surface.

> **Implementation note (migration in progress).** The CLI is moving from the
> TypeScript implementation (`packages/alp-cli`) to a native Rust binary
> (`cli-rs/`, the `alp` binary). The Rust binary is feature-complete — all
> commands below are ported and held byte-for-byte compatible with this contract
> by the `cli-rs/contract` harness. This document is the single contract for both
> implementations; the published `alp-sdk` npm package flips to the native binary
> at cutover.

The goal is not to mirror the VS Code extension command-for-command.
The goal is to provide a stable, scriptable, headless interface over
the same shared core used by UI and LSP surfaces.

## 1. CLI Principles

The CLI must follow these rules:

1. One command surface for local terminals and CI.
2. Human-readable output by default.
3. Machine-readable output when explicitly requested.
4. Stable exit-code behavior.
5. No hidden interactivity in CI-oriented flows.
6. No business logic divergence from the shared core.

## 2. Command Families

The CLI should expose these top-level command families:

- `alp validate`
- `alp generate`
- `alp init`
- `alp scaffold`
- `alp completion`
- `alp inspect`
- `alp trace`
- `alp doctor`
- `alp support-bundle`
- `alp debug-config`

## 3. Global Behavior

### 3.1 Common flags

All commands should support a shared baseline of flags where relevant:

- `--project <path>`
- `--board-yaml <path>`
- `--sdk-root <path>`
- `--format text|json`
- `--verbose`
- `--quiet`
- `--no-color`
- `--non-interactive`
- `--ci`

### 3.2 Output policy

- default output is concise text for humans
- `--format json` emits stable machine-readable output
- diagnostics, trace records, and doctor results must have stable field
  names
- JSON output should avoid prose-only strings when structured fields
  are possible

Normative rules:

- CLI JSON output MUST write exactly one JSON document to stdout.
- Human-readable logs and progress text MUST go to stderr.
- Each command MUST set `command`, `ok`, `exitCode`, `data`, and
  `issues` in JSON mode.

### 3.3 Exit-code policy

- `0`: success
- `1`: command or environment failure
- `2`: validation failure or incompatible configuration
- `3`: generation or scaffolding write failure
- `4`: doctor/preflight failure
- `5`: internal or unexpected error

## 4. Command Contracts

### 4.1 `alp validate`

Purpose:

- validate schema and semantic rules for the active project

Required behavior:

- validate the resolved project config
- emit structured issues with severity
- support `--format json`
- avoid writing files

Suggested flags:

- `--strict`
- `--warnings-as-errors`

### 4.2 `alp generate`

Purpose:

- generate derived artifacts from the active config

Required behavior:

- support target selection
- preview before write when requested
- report written versus unchanged artifacts
- support deterministic output ordering

Suggested flags:

- `--target <name>`
- `--all`
- `--preview`
- `--write`
- `--output-dir <path>`

### 4.3 `alp init`

Purpose:

- initialize a new ALP project from a supported template

Required behavior:

- support non-interactive template selection
- emit the planned project tree before write when requested
- make overwrite policy explicit

Suggested flags:

- `--template <name>`
- `--name <project-name>`
- `--destination <path>`
- `--preview`
- `--force`

### 4.4 `alp scaffold`

Purpose:

- add starter files or modules to an existing project

Required behavior:

- support module/template selection
- show affected files before write when requested
- report conflicts clearly

Suggested flags:

- `--template <name>`
- `--preview`
- `--force`

### 4.5 `alp inspect`

Purpose:

- show the effective resolved config and debug-relevant derived values

Required behavior:

- expose resolved values and preset origins
- support focused inspection of a field path
- support text and JSON output

Suggested flags:

- `--path <field-path>`
- `--show-origin`

### 4.6 `alp trace`

Purpose:

- explain why generation or resolution decisions were made

Required behavior:

- show the decision path for a field, output, or compatibility check
- support trace records in JSON
- support narrowed scopes

Suggested flags:

- `--path <field-path>`
- `--target <generation-target>`

### 4.7 `alp doctor`

Purpose:

- validate environment and debug preflight conditions

Required behavior:

- verify tool availability
- verify project/build artifacts where relevant
- verify debug backend prerequisites when requested
- emit actionable failure messages

Suggested flags:

- `--profile <debug-profile-id>`
- `--debug`
- `--ci`

### 4.8 `alp support-bundle`

Purpose:

- export a sanitized bundle for support and issue filing

Required behavior:

- include inspect output, doctor results, tool versions, and selected
  profile metadata
- avoid exporting secrets by default
- produce a deterministic archive layout

Suggested flags:

- `--output <path>`
- `--include-trace`
- `--include-doctor`

### 4.9 `alp debug-config`

Purpose:

- resolve and emit debug configuration artifacts for supported targets

Required behavior:

- resolve a named debug profile
- emit either a preview or a writeable debug config artifact
- support Zephyr, baremetal, Yocto userspace, and native-host target
  classes as they become available

Suggested flags:

- `--profile <id>`
- `--write-launch-json`
- `--output <path>`

### 4.10 `alp completion`

Purpose:

- emit shell completion scripts for supported shells

Required behavior:

- generate completion scripts for bash, zsh, and fish
- return deterministic scripts for CI and local shell setup

Suggested flags:

- `--shell <bash|zsh|fish>`

## 5. JSON Contract Shape

The CLI should return a stable top-level envelope for JSON output.

```json
{
  "command": "validate",
  "ok": true,
  "exitCode": 0,
  "project": {
    "root": "/path/to/project",
    "boardYaml": "/path/to/project/board.yaml"
  },
  "data": {},
  "issues": []
}
```

Rules:

- `ok` is the fast-path success flag
- `exitCode` mirrors process exit behavior
- `issues` is always present, even if empty
- command-specific payload lives under `data`

### 5.1 Envelope versioning

- `schemaVersion` should be included for command-specific payloads when
  shared-core models already define a version.
- Existing `schemaVersion: "1"` payloads from shared-core debug models
  must be preserved without field renames.

### 5.2 Command payload map

The following command payloads map to shared-core contracts:

- `alp inspect` -> `DebugInspectReport`
- `alp trace` -> `DebugGenerationTraceReport`
- `alp doctor` -> `DoctorReport` and optional `DebugPreflightReport`
- `alp support-bundle` -> `DebugSupportBundlePayload`
- `alp generate` -> generation summary shaped from loader batch
  (`written`, `failed`) with deterministic ordering

## 6. Non-Interactive Requirements

The CLI must support CI and automation cleanly.

That means:

- no prompt-based flows unless explicitly requested
- failures must be actionable without opening VS Code
- `--format json` must not mix structured output with unrelated prose
- command success must not depend on terminal color or TTY detection
- `--non-interactive` and `--ci` must disable prompts and default to
  fail-fast behavior
- commands must return deterministic exit codes regardless of TTY
  availability

## 7. Exit-Code Matrix

Exit code behavior is mandatory and command-independent:

- `0`: success (`ok=true`)
- `1`: command/runtime failure (unexpected process failure)
- `2`: validation/config incompatibility (including schema and semantic
  validation)
- `3`: generation/scaffolding write failure
- `4`: doctor/preflight failure (launch preconditions not met)
- `5`: internal/unexpected error in CLI orchestration or serialization

## 8. Relationship to UI and LSP

The CLI is the automation surface.

- The UI owns guided interaction, previews, and launch actions.
- The LSP owns inline editor intelligence.
- The CLI owns scriptable inspection, validation, trace, doctor, and
  export flows.

If a capability is needed in all three surfaces, the implementation
must live in the shared core and only be presented differently by each
surface.

## 9. Implementation Guardrails

To keep future CLI implementation aligned with this contract:

- command handlers should use shared-core serializer helpers rather than
  ad-hoc JSON builders
- CLI output fields must not rename shared-core model keys
- new command families require contract updates in this file before
  implementation

## 10. CI Integration Examples

For ready-to-copy CI pipelines using `alp validate`, `alp generate`,
and `alp doctor`, see [CI_EXAMPLES.md](CI_EXAMPLES.md).
