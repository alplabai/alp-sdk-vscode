# ALP CLI Contract

Last revised: 2026-07-20

This document defines the intended contract for the ALP command-line
surface.

> **Implementation note.** The CLI is the standalone `tan` binary — from
> v0.5.0 a PyInstaller freeze of the Python port; earlier releases were a Rust
> binary (tan-cli#269 removed `Cargo.toml`) —
> developed and released from
> [`alplabai/tan-cli`](https://github.com/alplabai/tan-cli); the former in-repo
> `alp` (`cli-rs`) binary and the TypeScript implementation (`packages/alp-cli`)
> have been retired. This document is the envelope contract this repo depends
> on. It describes the INTENDED surface: `tan` is not feature-complete at the
> pinned `SUPPORTED_CLI_VERSION` 0.6.0 (`src/alpCli/service.ts`), and three
> parts of it are declared by that binary but refuse when you run them — the
> second note below names all three.
> `tan` is published as a GitHub release asset for each target (tag
> `v<version>`) under one of two NAMES, not one: `tan-<triple>[.exe]` through
> v0.5.0-rc4, holding a raw binary, or `tan-<triple>.zip` (win32) /
> `tan-<triple>.tar.gz` (elsewhere) from the archive freeze (tan-cli#349) on,
> holding a onedir tree instead. The extension resolves which name a given
> release actually published from that release's own `checksums.txt` — never
> from the version — downloads it, unpacks an archive before running it, and
> shells the resulting binary either way.

> **The three gaps at 0.6.0.** Twelve of `build`'s options — `--all`,
> `--ci`, `--manifest`, `--manifest-from`, `--no-auto-bootstrap`, `--no-color`,
> `--non-interactive`, `--plan`, `--pristine`, `--quiet`, `--target`,
> `--verbose` — are accepted by the parser and then refused. Each exits 1 with
> `cli.command-deferred` and a message naming the flag it was given:
> "`tan build --plan` is deferred and not available in this build (see
> https://github.com/alplabai/tan-cli/issues/427)." (tan-cli#427). Second,
> `sdk install` and `sdk switch` are real subcommands that exit 1 with
> `sdk.not-ported`: "`sdk install` is not available in this build of tan. It
> writes the active-SDK pointer and reconciles the west workspace manifest, and
> a partial implementation would report success while `west` kept resolving the
> old SDK." (tan-cli#305, CLOSED/COMPLETED — the refusal
> outlived the issue that tracked it, so the number dates the gap rather than
> promising a fix) — which is why the extension installs and switches
> SDKs itself rather than shelling those two. Third, `model` implements exactly
> one subcommand, `build`; every other subcommand §2.3 and §4.12 describe exits
> 1 with `model.unknown-subcommand`: "Unknown model subcommand: check.
> Available: build." (tan-cli#674). Every other command family listed in §2
> exists and runs at this pin.

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
- `tan bootstrap`
- `tan build`
- `tan image`
- `tan flash`
- `tan clean`
- `tan run`
- `tan sdk`
- `tan diff`
- `tan presets`
- `tan explain`
- `tan size`
- `tan model` (subcommands: `build`, `list`, `info`, `doctor`, `check`, `zoo`,
  `add`, `prep`, `run`, `ab` — see §2.3; at 0.6.0 only `build` is
  implemented, tan-cli#674)

`tan renode` was on this list until tan v0.6.0, which removed the verb, its
modules and all 27 published `renode.*` issue codes (tan-cli#848). The
extension's Renode command went with it (#584).

The extension shells seventeen of these: `bootstrap`, `build`, `clean`,
`debug-config`, `doctor`, `examples`, `explain`, `flash`, `generate`, `image`,
`init`, `model`, `presets`, `run`, `sdk`, `size`, and `validate` —
from call sites spread across `src/` (`src/west.ts`, `src/bootstrap.ts`,
`src/loader.ts`, `src/ideHub/buildPlanPanel.ts`,
`src/ideHub/newProjectFlowPanel.ts`, `src/debug/service.ts`,
`src/models/panel.ts` and others). Sixteen of the eighteen are measured rather
than maintained: `scripts/tan-surface/extract.mjs` enumerates the invocations in
`src/` and `test/tan.surfaceContract.test.js` checks each against the pinned
tan's own `--help`. The two the extractor cannot resolve statically are counted
here by hand — `init`, whose argv is assembled by `planInitArgv`
(`packages/alp-core/src/project/initArgv.ts`), and `debug-config`, assembled by
`debugConfigArgs` (`src/debug/service.ts`).

Of the `model` family the extension shells exactly one argv — `["model",
"build"]` (`src/models/panel.ts`) — because `build` is the only subcommand this
pin implements. The Models panel is therefore a GUI over that one command plus
the envelope it returns: a per-model NPU-COVERAGE BADGE per SoM backend
(`full-eligible` / `partial` / `cpu-only` / `undetermined`, before build —
eligibility unless a real compile proves placement), and a Build action that
builds EVERY model in `board.yaml` at once, since `tan model` has no `--model`
option to select one with (tan-cli#674). PREP MODEL (pick model + calibration
folder → quantize → accuracy report), RUN MODEL / A-B COMPARE (host reference
run) and the MODEL ZOO GALLERY (browse "runs on your SoM" + one-click Add) are
INTENDED, not shipped: they need `model prep`, `model run`, `model ab` and
`model zoo`, and none of those exist at 0.6.0 (tan-cli#674). When Run and
A-B do arrive, the honest caveat still holds — they are a host reference, not
target-SoM performance.

The panel's surface is deliberately hidden on this branch. `alp.openModelsPanel`
and `alp.buildModel` are still registered, but both carry `"when": "false"` in
`package.json`'s `contributes.menus.commandPalette`, and the `alp-ide` Activity
Bar container contributes exactly one view — `alp-ide.hub`, "Alp IDE" — with no
Models entry in it. Re-exposing the surface once tan's model command set is
ready is tracked as #524.

### 2.1 Relation to the SDK's `west alp-*` commands (two doors, one engine)

The SDK registers its own west-extension commands (`west alp-build`, `alp-image`,
`alp-flash`, `alp-clean`, `alp-renode`, and on newer SDKs `alp-emit`, `alp-size`).
The name parity with this CLI is deliberate and is NOT a competing
implementation:

- **`tan X` is the portable counterpart of `west alp-X`.** For the overlapping
  verbs (`build`/`image`/`flash`/`clean`) `tan` drives the per-core
  dispatch itself rather than shelling out to `west alp-X` verbatim (see §6a
  of `EXTENSION_CLI_INTEGRATION.md`) — orchestration logic still has one
  source of truth, the SDK's `alp_orchestrate` package, which `tan` consumes
  via `--emit build-plan` instead of wrapping the west command. Inside a west
  workspace both doors still work and reach the same planner; the native door
  adds the JSON envelope, stable exit codes, and works without the user
  knowing west.
- **CLI-only verbs** (`validate`, `generate`, `init`, `scaffold`, `doctor`,
  `diff`, `presets`, `inspect`, `trace`, `debug-config`, `support-bundle`,
  `sdk`, `explain`, `completion`, `bootstrap`, `size`) have no west
  counterpart — they are the schema/generate/inspect surface the IDE consumes
  via the envelope. (`size` is native to `tan`, not a wrap of a west command —
  see the row below.)
- **West-only commands** (`alp-emit`) are SDK-side inspectors; the CLI
  consumes the same `--emit` seam internally (ADR-0014) instead of wrapping
  `alp-emit`. `alp-size` is no longer west-only: `tan` has its own native
  `size` command.

Where a CLI verb re-implements domain logic natively (e.g. `validate
--offline`, `diff`, the loader/context readers) instead of shelling out, that
parity surface is `tan-cli`'s own concern to test, under its own gates. This
repo does not gate it;
what it depends on is the envelope contract in this document.

### 2.2 `tan run` — native_sim versus hardware

`tan run` exists as its own top-level command. The extension's native_sim Run
action invokes it with no flags — plain `tan run`, never `--flash` — for the
no-flash, host-simulation path. Programming real hardware is a separate action
entirely: the extension's Flash action invokes `tan flash`, not `tan run
--flash`. (`src/west.ts` in the extension is the caller of record for both.)

### 2.3 `tan model` — model lifecycle family

`tan model <cmd>` mirrors the SDK-native `alp model <cmd>` verbatim (same
subcommands, same flags). `alp model` is the SDK-native command surface; `tan
model` is the thin envelope wrapper emitting `{command, ok, exitCode, project,
data, issues}`.

At the pinned 0.6.0 the only subcommand implemented is `build`; every other
entry below is the intended contract and exits 1 with `model.unknown-subcommand`
("Unknown model subcommand: check. Available: build.") until tan-cli#674 lands.
Subcommands:

- `build` — compile `board.yaml` `models:` → `.alpmodel`. The pinned tan builds
  every declared model; there is no per-model selection, and no `--model`
  option to ask for one.
- `list` / `info` / `doctor` — list; decode; report toolchains.
- `check --board board.yaml [--exact] [--format text|json]` — static
  NPU-eligibility screen, OFFLINE, no toolchain. Per SoM-backend `npuCoverage`
  of `full-eligible` | `partial` | `cpu-only` | `undetermined` at
  `basis: "static-screen"`, plus a MAC-weighted upper bound
  (`computeOnNpuPctMax`), `uncostedCpuOpCount`, per-op verdicts, and caveats as
  prose in `notes`. A static positive is ELIGIBILITY, not a guarantee — the
  model runs either way, an unsupported operator falls back to the CPU
  silently. `undetermined` is absent data, never "will not run". `--exact`
  runs the real `vela` for Ethos-U and upgrades the report to
  `basis: "compiled"` with the measured placement (`npuPlacementPctReal`);
  only `basis: "compiled"` or `basis: "bench"` may be read as proven.
- `zoo [--sku <SKU> | --board board.yaml] [--format]` — browse curated
  model-zoo entries (`metadata/model_zoo/<id>.yaml`), each marked `runs_here`
  for the SoM (via `validated_soms`). Link + fetch + layer, no weight
  redistribution.
- `add <zoo-id> [--board board.yaml] [--name NAME] [--models-dir DIR]` — fetch
  the source (URL sha256-verified, or bundled), append `{name, source}` to
  `board.yaml` `models:`. Non-destructive (duplicate name errors).
- `prep <model.onnx|.tflite> --calibration <dir> [--out] [--per-channel]
  [--min-samples N]` — LICENSE-FREE INT8 quantize (onnxruntime QDQ) +
  fp32-vs-int8 ACCURACY report. `.tflite` is converted to ONNX first via
  tf2onnx. Extras: `model-prep` (onnxruntime/onnx/numpy/sympy), `model-convert`
  (tf2onnx/tensorflow-cpu) for `.tflite` input.
- `run <model.onnx> [--input FILE.npy] [--expected LABEL] [--runs N]` — HOST
  reference run (backend `cpu-host`): functional + host-latency + accuracy. NOT
  the target SoM's performance; `peak_sram_kib`/`power_mj` are null on host
  (on-device values are HW-gated).
- `ab <a.onnx> <b.onnx> [--input] [--runs]` — A/B two models on the same input
  (host reference): latency + size delta.

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
  family as an envelope command

  > **Not the extension's source today.** `src/pinmux/loader.ts` reads
  > `metadata/pinmux/<family>.yaml` with `fs` directly and nothing in this repo
  > spawns `tan pinmux` — measured against the pinned binary, not aspirational.
  > The extension's own family mapping (`SKU_PINMUX_FAMILY`) agrees with tan's
  > (below), so the two do not currently disagree, but they are two
  > independent implementations of the same mapping, not one shared source.

Required behavior:

- resolve the family from `--family <stem>` or by mapping `--sku <sku>`
  (`E1M-AEN*` → `aen`, `E1M-V2N*` → `v2n`, `E1M-V2M*` → `v2n` — V2M is the
  same PCB/E1M edge as V2N, so it shares the v2n capability table —
  `E1M-NX9*` → `imx93`)
- read `<sdk>/metadata/pinmux/<family>.yaml` and emit its pads (`e1mPad`,
  `e1mFunction`, `owner`, `siliconPeripheral`, `siliconPad`) in the envelope
  `data`, matching the extension's `PinmuxTable`
- fail soft (exit 0 + a warning issue, `pinmux.sdk-root-unresolved` /
  `pinmux.unknown-sku` / `pinmux.table-not-found`) when the SDK root is
  unresolved, the SKU has no known family, or the family has no
  `metadata/pinmux/<family>.yaml` file at all
- but fail HARD (exit 2, `ok: false`, `pinmux.table-empty`, severity `error`)
  when that file exists and parses to zero pads with a resolved
  `e1m_pad`/`e1m_function` — measured: this is the state of `v2n.yaml` today
  (207 of 207 pads still `TBD`), so all four V2N/V2M SKUs hit this branch, not
  the soft one, against the shipping SDK

Suggested flags:

- `--sku <sku>`
- `--family <stem>`

### 4.12 `tan model` (envelope subcommands)

`tan model` mirrors the SDK-native `alp model` (see §2.3). `build`, `list`,
`info`, and `doctor` follow the standard envelope with no special payload. The
value-add subcommands below each emit the standard envelope; their payloads live
under `data`, warnings/errors under `issues`.

Of everything in this section only `build` is implemented at the pinned
0.6.0 — `check`, `zoo`, `add`, `prep`, `run` and `ab` (and `list`, `info`
and `doctor`) exit 1 with `model.unknown-subcommand` — measured for every form,
including one carrying a flag `tan model` really has (`tan model check --board
board.yaml` refuses identically). The subcommand is rejected before any flag is
read, so the Flags: blocks below describe arguments nothing parses yet. Some of
those names ARE real options of `tan model` itself — `--board`, `--format` and
`--out` are three — so they must not be read as a list of flags that do not
exist. `tan model`'s own options are `--board`, `--board-yaml`, `--format`,
`--help`, `--metadata-root`, `--out`, `--project` and `--sdk-root`, plus tan's
global options. The contract below is what the family is meant to
be; tan-cli#674 is the gap.

#### `tan model check`

Purpose:

- static, OFFLINE screen of how much of a model can target a SoM's NPU
  backends, before any compile (no toolchain required)

Required behavior:

- screen every model declared in `board.yaml`'s `models:` against the backends
  the board's `som.sku` actually declares
- emit, per SoM backend, an `npuCoverage` of `full-eligible` | `partial` |
  `cpu-only` | `undetermined`, a `basis` of `static-screen` | `compiled` |
  `bench`, a `confidence` of `screening` | `certain`, the MAC-weighted upper
  bound `computeOnNpuPctMax`, `uncostedCpuOpCount`, per-op
  `{op,status,reason,macs}` verdicts, and `notes`
- keep positives at ELIGIBILITY on a static basis — the model runs either way,
  an operator the NPU cannot take falls back to the CPU silently rather than
  failing
- report absent data as `undetermined`, never as a negative verdict
- present a result as proven only at `basis: "compiled"` or `basis: "bench"`;
  `npuCoverage: "fits"` is reserved for those and carries the measured
  `npuPlacementPctReal`

Flags:

- `--board board.yaml`
- `--exact`
- `--format text|json`

#### `tan model zoo`

Purpose:

- browse curated model-zoo entries and mark which run on the target SoM

Required behavior:

- read `metadata/model_zoo/<id>.yaml` entries and mark each `runs_here` for the
  SoM (via `validated_soms`)
- resolve the SoM from `--sku <SKU>` or `--board board.yaml`
- link + fetch + layer only — no weight redistribution

Flags:

- `--sku <SKU>`
- `--board board.yaml`
- `--format`

#### `tan model add`

Purpose:

- add a zoo entry's model to the project's `board.yaml`

Required behavior:

- fetch the source (URL sha256-verified, or bundled)
- append `{name, source}` to `board.yaml` `models:` — non-destructive (a
  duplicate name errors)

Flags:

- `--board board.yaml`
- `--name NAME`
- `--models-dir DIR`

#### `tan model prep`

Purpose:

- LICENSE-FREE INT8 quantization with an accuracy report

Required behavior:

- quantize `<model.onnx|.tflite>` to INT8 (onnxruntime QDQ) against
  `--calibration <dir>`
- emit an fp32-vs-int8 ACCURACY report (top1 agreement %, mean cosine, max-abs-err,
  verdict `good` | `degraded` + guidance)
- convert `.tflite` input to ONNX first via tf2onnx

Flags:

- `--calibration <dir>`
- `--out`
- `--per-channel`
- `--min-samples N`

Extras: `model-prep` (onnxruntime/onnx/numpy/sympy); `model-convert`
(tf2onnx/tensorflow-cpu) for `.tflite` input.

#### `tan model run`

Purpose:

- HOST reference run of `<model.onnx>` — functional + host-latency + accuracy

Required behavior:

- run on backend `cpu-host`
- report functional output, host latency, and accuracy (against `--expected LABEL`
  when given)
- leave `peak_sram_kib`/`power_mj` null on host — these are HW-gated on-device
  values, NOT the target SoM's performance

Flags:

- `--input FILE.npy`
- `--expected LABEL`
- `--runs N`

#### `tan model ab`

Purpose:

- A/B two models (`<a.onnx> <b.onnx>`) on the same input (host reference)

Required behavior:

- run both on the same input and report latency + size delta
- host reference only — not target-SoM performance

Flags:

- `--input`
- `--runs`

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
- `tan doctor` -> `data.checks[]` / `data.summary`, rendered through the
  shared envelope types (`DoctorCheckEnvelope` / `DoctorEnvelopeData`,
  `packages/alp-core/src/cli/doctorEnvelope.ts`) verbatim — no allowlist, no
  recomputed counts, an `unknown` status renders as itself (#376; the
  in-process `DoctorReport` / `buildDoctorReport` this replaced is deleted).
  `DebugPreflightReport` (host readiness — extension presence, backend on
  PATH, build artefact, native-host platform gate) stays a SEPARATE,
  in-process report; `tan doctor` never carries it.
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
