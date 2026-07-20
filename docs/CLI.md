# ALP CLI Contract

Last revised: 2026-07-20

This document defines the intended contract for the ALP command-line
surface.

> **Implementation note.** The CLI is the standalone native Rust binary `tan`,
> developed and released from
> [`alplabai/tan-cli`](https://github.com/alplabai/tan-cli); the former in-repo
> `alp` (`cli-rs`) binary and the TypeScript implementation (`packages/alp-cli`)
> have been retired. `tan` is feature-complete — all commands below are held
> compatible with this envelope contract by the conformance harness in the
> `tan-cli` repo. `tan` is distributed as a raw per-target binary
> (`tan-<triple>[.exe]`) published as a GitHub release asset (tag `v<version>`);
> the extension downloads and shells it.

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

- `tan validate`
- `tan generate`
- `tan init`
- `tan examples`
- `tan scaffold`
- `tan completion`
- `tan inspect`
- `tan trace`
- `tan doctor`
- `tan support-bundle`
- `tan debug-config`
- `tan pinmux`

### 2.1 Relation to the SDK's `west alp-*` commands (two doors, one engine)

The SDK registers its own west-extension commands (`west alp-build`, `alp-image`,
`alp-flash`, `alp-clean`, `alp-renode`, and on newer SDKs `alp-emit`, `alp-size`).
The name parity with this CLI is deliberate and is NOT a competing
implementation:

- **`tan X` is the portable counterpart of `west alp-X`.** For the overlapping
  verbs (`build`/`image`/`flash`/`clean`/`renode`) the native CLI shells out to
  the west command verbatim — orchestration logic lives in exactly one place,
  the SDK's `alp_orchestrate` package. Inside a west workspace both doors work
  and drive the same engine; the native door adds the JSON envelope, stable
  exit codes, and works without the user knowing west.
- **CLI-only verbs** (`validate`, `generate`, `init`, `scaffold`, `doctor`,
  `diff`, `presets`, `inspect`, `trace`, `debug-config`, `support-bundle`,
  `sdk`, `explain`, `completion`, `bootstrap`) have no west counterpart — they
  are the schema/generate/inspect surface the IDE consumes via the envelope.
- **West-only commands** (`alp-emit`, `alp-size`) are SDK-side inspectors; the
  CLI consumes the same `--emit` seam internally (ADR-0014) instead of
  wrapping `alp-emit`.

Where a CLI verb re-implements domain logic natively (e.g. `validate
--offline`, `diff`, the loader/context readers) instead of shelling out, that
Rust↔Python parity surface is gated by the conformance harness in the `tan-cli`
repo — drift there is a test failure, not a runtime surprise.

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

### 4.1 `tan validate`

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

### 4.2 `tan generate`

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

### 4.3 `tan init`

Purpose:

- initialize a new ALP project from a supported template

Required behavior:

- support non-interactive template selection
- copy an existing SDK example verbatim via `--from-example`
- emit the planned project tree before write when requested
- make overwrite policy explicit

Suggested flags:

- `--template <name>`
- `--from-example <category/name>` (mutually exclusive with `--template`)
- `--name <project-name>`
- `--destination <path>`
- `--preview`
- `--force`

`tan examples` lists the SDK's ready-made example projects
(`{ id, sourceDir, title, description }`) discovered under
`<sdk>/examples/<category>/<name>/` (directories carrying a `board.yaml`); an
unresolved SDK root yields an empty `examples` list rather than an error.
`tan init --from-example <sourceDir>` then copies one verbatim into the
destination — the example ships its own `board.yaml`, so `--som`/`--cores` do not
apply. Errors: unknown/empty example → exit 2 (`init.example-not-found` /
`init.invalid-example`); unresolved SDK → exit 2 (`init.sdk-root-unresolved`);
unreadable files → exit 1 (`init.example-unreadable`).

### 4.4 `tan scaffold`

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

### 4.5 `tan inspect`

Purpose:

- show the effective resolved config and debug-relevant derived values

Required behavior:

- expose resolved values and preset origins
- support focused inspection of a field path
- support text and JSON output

Suggested flags:

- `--path <field-path>`
- `--show-origin`

### 4.6 `tan trace`

Purpose:

- explain why generation or resolution decisions were made

Required behavior:

- show the decision path for a field, output, or compatibility check
- support trace records in JSON
- support narrowed scopes

Suggested flags:

- `--path <field-path>`
- `--target <generation-target>`

### 4.7 `tan doctor`

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

### 4.8 `tan support-bundle`

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

### 4.9 `tan debug-config`

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

### 4.10 `tan completion`

Purpose:

- emit shell completion scripts for supported shells

Required behavior:

- generate completion scripts for bash, zsh, and fish
- return deterministic scripts for CI and local shell setup

Suggested flags:

- `--shell <bash|zsh|fish>`

### 4.11 `tan pinmux`

Purpose:

- surface the E1M pinmux capability table (E1M pad → silicon function) for a SoM
  family, as the single source the extension/LSP consume instead of reading
  `metadata/pinmux/<family>.yaml` directly

Required behavior:

- resolve the family from `--family <stem>` or by mapping `--sku <sku>`
  (`E1M-AEN*` → `aen`, `E1M-V2N*` → `v2n`, `E1M-V2M*` → `v2n-m1`,
  `E1M-NX9*` → `imx93`)
- read `<sdk>/metadata/pinmux/<family>.yaml` and emit its pads (`e1mPad`,
  `e1mFunction`, `owner`, `siliconPeripheral`, `siliconPad`) in the envelope
  `data`, matching the extension's `PinmuxTable`
- fail soft (exit 0 + a warning issue) when the SDK root is unresolved, the SKU
  has no known family, or the family has no generated table — pads is then empty

Suggested flags:

- `--sku <sku>`
- `--family <stem>`

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

- `tan inspect` -> `DebugInspectReport`
- `tan trace` -> `DebugGenerationTraceReport`
- `tan doctor` -> `DoctorReport` and optional `DebugPreflightReport`
- `tan support-bundle` -> `DebugSupportBundlePayload`
- `tan generate` -> generation summary shaped from loader batch
  (`written`, `failed`) with deterministic ordering
- `tan examples` -> `{ examples: [{ id, sourceDir, title, description }] }`
  (empty when no SDK root resolves)

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

For ready-to-copy CI pipelines using `tan validate`, `tan generate`,
and `tan doctor`, see [CI_EXAMPLES.md](CI_EXAMPLES.md).
