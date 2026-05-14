<!-- markdownlint-disable MD036 -->

# GitHub Backlog

Last revised: 2026-05-13

This document converts the roadmap in [PLAN.md](PLAN.md) into a
GitHub-friendly backlog format.

It is designed for three practical uses:

1. Create milestone issues directly from the epic sections.
2. Create implementation issues directly from the task sections.
3. Track initial delivery progress through the Phase 1 backlog at the
   bottom of the file.

## 1. Suggested GitHub Setup

Before opening issues, create the following labels.

### Type labels

- `type:epic`
- `type:task`
- `type:subtask`
- `type:docs`
- `type:design`
- `type:tech-debt`

### Area labels

- `area:core`
- `area:lsp`
- `area:ui`
- `area:cli`
- `area:debug`
- `area:docs`
- `area:build`
- `area:testing`

### Priority labels

- `priority:p0`
- `priority:p1`
- `priority:p2`

### Status labels

- `status:ready`
- `status:blocked`
- `status:in-progress`
- `status:needs-design`

## 2. Suggested Milestones

- `M1 — Product Contract`
- `M2 — Shared Core`
- `M3 — LSP Baseline`
- `M4 — UX MVP`
- `M5 — CLI Baseline`
- `M6 — Scaffolding`
- `M7 — Docs and Hardening`

## 3. Epic Issues

Each section below is intended to map to one GitHub issue.

---

## Epic 1

**Title**

`Epic: Define product contract and first-class workflows`

**Labels**

- `type:epic`
- `area:docs`
- `priority:p0`
- `status:ready`

**Milestone**

- `M1 — Product Contract`

**Body**

```md
## Summary

Define the product contract for the ALP SDK VS Code extension so the
team is aligned on user segments, first-class workflows, and the
boundary between shared core, LSP, UI, and CLI.

## Outcome

The team agrees on who the product serves, which workflows are
first-class, and which features belong to UI, LSP, CLI, or shared
core.

## Tasks

- [ ] Define the primary user segments.
- [ ] Document the end-to-end journey for creating a new project.
- [ ] Document the journey for editing an existing `board.yaml`
      project.
- [ ] Document the journey for generating outputs before build.
- [ ] Document the journey for scaffolding starter source code.
- [ ] Document the CLI-first journey for CI and headless use.
- [ ] Publish a capability matrix for UI, LSP, CLI, and shared core.
- [ ] List explicitly unsupported or deferred features.
- [ ] Define the initial project-template shortlist.
- [ ] Define ownership rules for generated files versus user-owned
      files.
- [ ] Define acceptance criteria for the configurator MVP.
- [ ] Define acceptance criteria for the first LSP milestone.
- [ ] Define acceptance criteria for the CLI baseline.
- [ ] Define documentation expectations per surface.

## Exit Criteria

- [ ] The team can answer "which surface owns this feature?" without
      ambiguity.
- [ ] Initial project templates are agreed and documented.
- [ ] Generated-file ownership policy is agreed and documented.
```

---

## Epic 2

**Title**

`Epic: Extract a shared core for validation, generation, and scaffolding`

**Labels**

- `type:epic`
- `area:core`
- `priority:p0`
- `status:ready`

**Milestone**

- `M2 — Shared Core`

**Body**

```md
## Summary

Build a shared core so UI, LSP, and CLI all depend on one domain engine
for config resolution, validation, generation, and future scaffolding.

## Outcome

UI, LSP, and CLI all consume one deterministic domain engine.

## Tasks

- [ ] Define `ProjectConfig` and `EffectiveProjectConfig` types.
- [ ] Define `PresetCatalogue` and preset-origin metadata types.
- [ ] Define `ValidationIssue`, severity, and fix-suggestion models.
- [ ] Define `GenerationTarget` and `GeneratedArtifact` models.
- [ ] Define `ScaffoldTemplate` and template-parameter models.
- [ ] Move schema validation behind a stable API.
- [ ] Move semantic validation behind the same API.
- [ ] Add preset-resolution and inheritance handling.
- [ ] Add compatibility checks for unsupported combinations.
- [ ] Add structured error and warning output.
- [ ] Normalize generation entry points for all targets.
- [ ] Implement preview support before writing files.
- [ ] Implement deterministic artifact ordering and formatting.
- [ ] Add golden tests for generated outputs.
- [ ] Define stable generation contracts for CLI and UI callers.
- [ ] Define a template manifest format.
- [ ] Define template parameter resolution rules.
- [ ] Define overwrite policy for generated starter files.
- [ ] Add preview support for scaffolded project trees.

## Exit Criteria

- [ ] UI, LSP, and CLI can call the same validation and generation APIs.
- [ ] Generated outputs are deterministic.
- [ ] Core behavior is covered by golden tests.
```

---

## Epic 3

**Title**

`Epic: Ship LSP-native editing for board.yaml`

**Labels**

- `type:epic`
- `area:lsp`
- `priority:p0`
- `status:ready`

**Milestone**

- `M3 — LSP Baseline`

**Body**

```md
## Summary

Introduce a language server so `board.yaml` editing becomes LSP-native
instead of command-triggered.

## Outcome

`board.yaml` editing becomes LSP-native rather than command-triggered.

## Tasks

- [x] Add the language server and client wiring.
- [x] Implement document lifecycle handling.
- [x] Add incremental analysis and caching.
- [x] Add tracing and debugging hooks.
- [x] Port diagnostics from extension-host execution to the LSP.
- [x] Attach diagnostics to precise fields where possible.
- [x] Distinguish errors, warnings, and suggestions.
- [x] Add effective-config and preset-origin context to diagnostic
      messages.
- [x] Add completion for known enums and presets.
- [x] Add hover for field semantics and inherited defaults.
- [x] Add document symbols and outline support.
- [x] Add quick fixes for common issues.
- [x] Add command-backed effective-config preview.

## Exit Criteria

- [x] Users receive field-level diagnostics without manually running
      validation commands.
- [x] Completion and hover cover the core `board.yaml` authoring flow.
```

---

## Epic 4

**Title**

`Epic: Redesign the VS Code UX for guided project creation and editing`

**Labels**

- `type:epic`
- `area:ui`
- `priority:p1`
- `status:ready`

**Milestone**

- `M4 — UX MVP`

**Body**

```md
## Summary

Redesign the configurator and onboarding flows so the extension feels
like a polished VS Code product rather than a thin wrapper panel.

## Outcome

The extension feels like a polished VS Code product and not just a
thin wrapper panel.

## Tasks

- [x] Redesign the configurator into logical sections.
- [x] Add basic and advanced modes.
- [x] Improve field grouping and visual hierarchy.
- [x] Add inline help and contextual explanations.
- [x] Preserve compatibility with hand-edited YAML.
- [x] Add a first-run project creation wizard.
- [x] Let the wizard choose template, hardware, and feature set.
- [x] Show generated files before write.
- [x] Create the initial workspace layout and starter files.
- [x] Show effective config preview.
- [x] Show generated output preview.
- [x] Show scaffolded project tree preview.
- [x] Add write confirmation for changed files.
- [x] Add validation summary view before apply.

## Exit Criteria

- [x] A new user can create or update a project entirely through VS
      Code.
- [x] The UI provides preview and validation before write.
```

---

## Epic 5

**Title**

`Epic: Add project and source scaffolding`

**Labels**

- `type:epic`
- `area:core`
- `area:ui`
- `priority:p1`
- `status:ready`

**Milestone**

- `M6 — Scaffolding`

**Body**

```md
## Summary

Allow users to generate complete starter projects and feature modules
from curated templates.

## Outcome

Users can generate complete starter projects and feature modules from
curated templates.

## Tasks

- [x] Add a minimal ALP app template.
- [x] Add a sensor-oriented template.
- [x] Add an IoT template.
- [x] Add an edge-AI template.
- [x] Add a board-diagnostics template.
- [x] Add module-level source generation into existing projects.
- [x] Allow template parameters to resolve from current config.
- [x] Avoid overwriting user-modified files silently.
- [x] Add explanation support for generated starter code.

## Exit Criteria

- [x] Users can create a credible starter project without manually
      copying repo examples.
- [x] Partial scaffolding works for existing projects.
```

---

## Epic 6

**Title**

`Epic: Ship a first-class CLI workflow`

**Labels**

- `type:epic`
- `area:cli`
- `priority:p1`
- `status:ready`

**Milestone**

- `M5 — CLI Baseline`

**Body**

```md
## Summary

Deliver the same validation, generation, and project-setup workflows
through a stable CLI for terminal and CI users.

## Outcome

The same workflows are available from the terminal and in CI.

## Tasks

- [x] Introduce a stable CLI entry point.
- [x] Add shared argument parsing conventions.
- [x] Add machine-readable JSON output mode.
- [x] Define stable exit-code behavior.
- [x] Implement `alp validate`.
- [x] Implement `alp generate`.
- [x] Implement `alp init`.
- [x] Implement `alp doctor`.
- [ ] Implement `alp explain`.
- [x] Implement `alp scaffold`.
- [x] Implement `alp presets`.
- [ ] Implement `alp diff`.
- [ ] Add shell completion support.
- [ ] Add CI integration examples.

## Exit Criteria

- [ ] A CLI-first user can complete the same major workflows as a VS
      Code user.
- [ ] Commands support both human-readable and CI-friendly output.
```

---

## Epic 7

**Title**

`Epic: Rebuild documentation around workflows, not internals`

**Labels**

- `type:epic`
- `area:docs`
- `priority:p1`
- `status:ready`

**Milestone**

- `M7 — Docs and Hardening`

**Body**

```md
## Summary

Provide task-oriented documentation for GUI users, power users, and
CLI users without allowing drift between documented and implemented
behavior.

## Outcome

Both VS Code users and CLI users get task-oriented, accurate
documentation.

## Tasks

- [ ] Add VS Code getting-started documentation.
- [ ] Add CLI getting-started documentation.
- [ ] Add LSP/editor feature documentation.
- [ ] Add generation-output documentation.
- [ ] Add source-scaffolding documentation.
- [ ] Add validation troubleshooting.
- [ ] Add generation-conflict troubleshooting.
- [ ] Add environment and toolchain troubleshooting.
- [ ] Add common task recipes for GUI and CLI.
- [ ] Add CI usage examples.

## Exit Criteria

- [ ] New users can choose GUI or CLI quickly and reach a working
      project.
- [ ] Documentation matches implemented behavior closely enough to
      avoid routine drift.
```

---

## Epic 8

**Title**

`Epic: Harden testing, compatibility, and release engineering`

**Labels**

- `type:epic`
- `area:testing`
- `priority:p1`
- `status:ready`

**Milestone**

- `M7 — Docs and Hardening`

**Body**

```md
## Summary

Add the test matrix, compatibility policy, and release gates needed to
scale the product without drift between UI, LSP, CLI, and docs.

## Outcome

The product can scale without drift between surfaces.

## Tasks

- [ ] Add unit tests for the shared core.
- [ ] Add golden tests for generation outputs.
- [ ] Add language-server tests.
- [ ] Add webview smoke tests.
- [ ] Add CLI integration tests.
- [ ] Define compatibility rules for schema changes.
- [ ] Define compatibility rules for generation targets.
- [ ] Define compatibility rules for CLI flags and JSON output.
- [ ] Define release gates and checklists.
- [ ] Add performance budgets and regression checks.

## Exit Criteria

- [ ] Release gates exist for core, LSP, UI, CLI, and docs.
- [ ] Compatibility guarantees are documented.
- [ ] Regression coverage exists for all major surfaces.
```

---

## Epic 9

**Title**

`Epic: Add explicit debugging, inspection, and supportability workflows`

**Labels**

- `type:epic`
- `area:debug`
- `priority:p1`
- `status:ready`

**Milestone**

- `M5 — CLI Baseline`

**Body**

```md
## Summary

Make debugging and troubleshooting an explicit product capability across
UI, LSP, and CLI rather than leaving it implicit in diagnostics and
docs.

## Outcome

Users can inspect effective config, understand generation decisions,
capture environment state, and export support bundles when something
goes wrong.

## Tasks

- [ ] Add an effective-config inspection model to the shared core.
- [ ] Add generation-decision tracing to the shared core.
- [ ] Add a VS Code troubleshooting/debug panel.
- [ ] Add `alp inspect` for effective config and resolved values.
- [ ] Add `alp trace` for generation and decision tracing.
- [ ] Add `alp support-bundle` for issue-report export.
- [ ] Add documentation for inspect, trace, and support-bundle flows.
- [ ] Add tests for inspect output, trace output, and bundle export.

## Exit Criteria

- [ ] A user can understand why a value resolved the way it did.
- [ ] A user can export enough debugging context for a useful issue
      report.
- [ ] Debug surfaces exist in both VS Code and CLI workflows.
```

## 4. Phase 1 Backlog Issues

These issues are the most actionable items for the first implementation
wave and map closely to the current repository layout.

---

## Issue P1-1

**Title**

`Task: Normalize SDK root, project root, and west working-directory resolution`

**Labels**

- `type:task`
- `area:core`
- `area:build`
- `priority:p0`
- `status:ready`

**Milestone**

- `M2 — Shared Core`

**Body**

```md
## Summary

Normalize path resolution so the extension works cleanly with:

- the current split-repo + submodule layout
- standalone consumer workspaces
- explicit `alpSdk.path` overrides

## Target Areas

- `src/util.ts`
- `src/loader.ts`
- `src/west.ts`

## Tasks

- [x] Distinguish SDK root, project root, and west working directory.
- [x] Support the current split-repo + submodule layout.
- [x] Support standalone consumer workspaces.
- [x] Add explicit failure messaging for ambiguous workspace layouts.
- [x] Add unit-testable path-resolution helpers.

## Acceptance Criteria

- [x] The extension resolves roots correctly in both the extension repo
      and a consumer app workspace.
- [x] Errors are actionable when the workspace layout is ambiguous.
```

---

## Issue P1-2

**Title**

`Task: Introduce the language-server skeleton`

**Labels**

- `type:task`
- `area:lsp`
- `priority:p0`
- `status:ready`

**Milestone**

- `M3 — LSP Baseline`

**Body**

```md
## Summary

Add the first language-server/client structure so diagnostics and later
editor features can move out of extension-host command execution.

## Target Areas

- `package.json`
- `src/extension.ts`
- new `src/lsp/` or equivalent

## Tasks

- [x] Add the language-client dependency.
- [x] Add the language-server dependency.
- [x] Create server bootstrap files.
- [x] Wire activation and shutdown through the extension entry point.
- [x] Add basic tracing and debugging hooks.

## Acceptance Criteria

- [x] The extension starts and stops the language server reliably.
- [x] The project builds cleanly with the new LSP packages.
```

---

## Issue P1-3

**Title**

`Task: Port board.yaml diagnostics to the LSP baseline`

**Labels**

- `type:task`
- `area:lsp`
- `priority:p0`
- `status:ready`

**Milestone**

- `M3 — LSP Baseline`

**Body**

```md
## Summary

Move diagnostics from file-open/save command execution into the
language-server baseline while preserving current validation behavior.

## Target Areas

- `src/diagnostics.ts`
- new server diagnostics module

## Tasks

- [x] Move validation triggers from extension-host events into the LSP.
- [x] Preserve current validator behavior as baseline compatibility.
- [x] Improve diagnostic ranges beyond the current line-1 fallback where
      practical.
- [x] Keep Problems panel behavior stable during transition.

## Subtask Log

- [x] Record and close migration improvement subtask: keep current
      fallback range behavior stable while tracking richer range mapping
      as follow-up work.

## Acceptance Criteria

- [x] Users receive equivalent or better diagnostics through the LSP.
- [x] Diagnostics still appear reliably in the Problems panel.
```

---

## Issue P1-4

**Title**

`Task: Reconcile west command behavior with the canonical ALP workflow`

**Labels**

- `type:task`
- `area:build`
- `area:ui`
- `priority:p0`
- `status:ready`

**Milestone**

- `M4 — UX MVP`

**Body**

```md
## Summary

Align extension build commands with the documented ALP workflow,
including the relationship between `west build` and `west alp-build`.

## Target Areas

- `src/west.ts`
- `README.md`
- command titles in `package.json`

## Tasks

- [x] Decide whether the extension should expose `west build`,
      `west alp-build`, or both. (Decision: canonical extension flow is
      `west build` with explicit pre-build validation + generation.)
- [x] Ensure validation and generation happen in the expected order.
- [x] Update command descriptions to match actual behavior.
- [x] Update documentation to match shipped behavior.

## Acceptance Criteria

- [x] Extension build commands match the intended canonical workflow.
- [x] Documentation no longer overstates or misstates build behavior.
```

---

## Issue P1-5

**Title**

`Task: Reconcile generation-target support with documented behavior`

**Labels**

- `type:task`
- `area:core`
- `area:docs`
- `priority:p0`
- `status:ready`

**Milestone**

- `M2 — Shared Core`

**Body**

```md
## Summary

Reconcile actual supported generation targets with the upstream docs and
establish one central map of generation support.

## Target Areas

- `src/loader.ts`
- `package.json`
- docs references

## Tasks

- [x] Reconcile actual supported emit modes with upstream docs.
- [x] Add a central map for supported generation targets.
- [x] Add preview metadata for each target.
- [x] Add tests for success and failure-path handling.

## Acceptance Criteria

- [x] The extension and docs report the same generation-target surface.
- [x] Generation behavior is driven by one central support map.
```

---

## Issue P1-6

**Title**

`Task: Add a shared inspect and trace model for debugging workflows`

**Labels**

- `type:task`
- `area:debug`
- `area:core`
- `priority:p1`
- `status:ready`

**Milestone**

- `M2 — Shared Core`

**Body**

```md
## Summary

Add the shared core structures needed for explicit debugging features,
starting with effective-config inspection and generation-decision
tracing.

## Target Areas

- new shared core/domain files under `src/`
- `src/loader.ts`
- future LSP and CLI integration points

## Tasks

- [x] Define an inspect-output model for effective config and resolved
      values.
- [x] Define a trace-output model for generation decisions.
- [x] Define a support-bundle payload model for issue reports.
- [x] Add reusable helpers so UI, LSP, and CLI can consume the same
      debug data.
- [x] Add tests for inspect and trace serialization.

## Acceptance Criteria

- [x] Shared debug data models exist and are reusable across surfaces.
- [x] Inspect and trace output can be exposed later without refactoring
      core logic again.
```

---

## Issue P1-7

**Title**

`Task: Define and ship the debug support matrix as a maintained product contract`

**Labels**

- `type:task`
- `area:debug`
- `area:docs`
- `priority:p1`
- `status:ready`

**Milestone**

- `M5 — CLI Baseline`

**Body**

```md
## Summary

Define the supported debug target classes, adapters, probes, and
support levels so the product has a clear and maintainable debug
contract.

## Target Areas

- `DEBUG.md`
- debug-related docs and product references

## Tasks

- [x] Define supported debug target classes.
- [x] Define primary and optional adapters per target class.
- [x] Define first-class versus deferred support levels.
- [x] Document current repo state versus planned product state.
- [x] Keep the matrix aligned with future launch-generation work.

## Acceptance Criteria

- [x] A single maintained support matrix exists for debug workflows.
- [x] The team can answer whether a given toolchain/probe path is
      first-class, optional, or deferred.
```

---

## Issue P1-8

**Title**

`Task: Design and implement generated launch profiles for Zephyr, baremetal, Yocto, and native targets`

**Labels**

- `type:task`
- `area:debug`
- `area:ui`
- `priority:p1`
- `status:ready`

**Milestone**

- `M4 — UX MVP`

**Body**

```md
## Summary

Generate or provide launch configurations for the supported debug
classes instead of requiring users to hand-author every debug profile.

## Target Areas

- future launch-generation module under `src/`
- `package.json`
- `DEBUG.md`

## Tasks

- [x] Define the shared `DebugProfile` model.
- [x] Generate Zephyr + `cortex-debug` + J-Link launch profiles.
- [x] Generate Zephyr + `cortex-debug` + OpenOCD launch profiles.
- [x] Generate baremetal + `cortex-debug` launch profiles.
- [x] Generate Yocto userspace + `cppdbg` + `gdbserver` launch profiles.
- [x] Generate `native_sim` / host + `CodeLLDB` launch profiles.
- [x] Define whether profiles are written to `launch.json` or provided
      dynamically.

## Acceptance Criteria

- [x] The product can generate at least one working Zephyr debug
      profile end-to-end.
- [x] The launch design is documented and reusable for other target
      classes.
```

---

## Issue P1-9

**Title**

`Task: Add debug preflight, doctor, and support-bundle workflows`

**Labels**

- `type:task`
- `area:debug`
- `area:cli`
- `priority:p1`
- `status:ready`

**Milestone**

- `M5 — CLI Baseline`

**Body**

```md
## Summary

Add productized debug troubleshooting so failed launch attempts become
actionable instead of opaque.

## Target Areas

- future debug-preflight module under `src/`
- future CLI doctor/inspect/trace commands
- `DEBUG.md`

## Tasks

- [x] Define debug preflight checks for each target class.
- [x] Validate ELF/build artifact presence before launch.
- [x] Validate debugger extension/tool availability before launch.
- [x] Validate probe/server configuration before launch.
- [x] Add a debug-doctor report flow.
- [x] Add support-bundle export for issue reports.
- [x] Add documentation for debug failure analysis.

## Acceptance Criteria

- [x] The product can fail fast with actionable debug preflight output.
- [x] Users can export enough context for a useful debug issue report.
```

---

## Issue P1-10

**Title**

`Task: Define and enforce the ALP CLI contract for local and CI use`

**Labels**

- `type:task`
- `area:cli`
- `area:docs`
- `priority:p1`
- `status:ready`

**Milestone**

- `M5 — CLI Baseline`

**Body**

```md
## Summary

Turn the planned CLI into a stable contract with explicit command
families, JSON output rules, and exit-code behavior.

## Target Areas

- `CLI.md`
- future CLI entrypoint and command modules
- shared core serialization helpers

## Tasks

- [x] Define the supported top-level command families.
- [x] Define global flags and formatting behavior.
- [x] Define stable JSON output envelopes.
- [x] Define exit-code behavior for validation, doctor, and generation
      failures.
- [x] Define non-interactive requirements for CI.
- [x] Keep CLI behavior aligned with shared-core models.

## Acceptance Criteria

- [x] The team has a stable CLI contract to implement against.
- [x] CI-oriented workflows do not depend on ad-hoc terminal behavior.
```

---

## Issue P1-11

**Title**

`Task: Enforce debug ownership boundaries between UI, CLI, and LSP`

**Labels**

- `type:task`
- `area:debug`
- `area:lsp`
- `priority:p1`
- `status:ready`

**Milestone**

- `M3 — LSP Baseline`

**Body**

```md
## Summary

Prevent feature drift by making the boundaries between UI, CLI, and LSP
explicit for debug-related capabilities.

## Target Areas

- `DEBUG.md`
- `PLAN.md`
- future UI/LSP/CLI implementation points

## Tasks

- [x] Define which surface owns launch and attach flows.
- [x] Define which surface owns inspect, trace, and doctor flows.
- [x] Define which surface owns inline explainability and quick fixes.
- [x] Define explicit LSP non-goals for debug orchestration.
- [x] Prevent duplicate implementation of domain rules across surfaces.

## Acceptance Criteria

- [x] The team can answer where each debug capability belongs without
      ambiguity.
- [x] LSP, UI, and CLI responsibilities are documented and non-
      overlapping.
```

---

## Issue P1-12

**Title**

`Task: Ship the first VS Code debug command surface for inspect, doctor, and profile drafting`

**Labels**

- `type:task`
- `area:debug`
- `area:ui`
- `priority:p1`
- `status:ready`

**Milestone**

- `M4 — UX MVP`

**Body**

```md
## Summary

Add the first concrete VS Code debug commands so users can inspect
project state, run debug doctor checks, and draft launch profiles
without hand-authoring everything.

## Target Areas

- `package.json`
- `src/extension.ts`
- new debug command module under `src/`

## Tasks

- [x] Add `Alp: Inspect project state`.
- [x] Add `Alp: Debug doctor`.
- [x] Add `Alp: Configure debug profile`.
- [x] Surface results in an inspectable form inside VS Code.
- [x] Keep the command implementations aligned with the shared debug
      model as it evolves.

## Acceptance Criteria

- [x] Users can inspect current workspace/debug inputs without leaving
      VS Code.
- [x] Users can draft a launch profile for the supported target classes.
```

## 5. Recommended First Sprint

If the team wants the highest-leverage first sprint, create and work
these issues first:

1. `Task: Normalize SDK root, project root, and west working-directory resolution`
2. `Task: Introduce the language-server skeleton`
3. `Task: Port board.yaml diagnostics to the LSP baseline`
4. `Task: Reconcile west command behavior with the canonical ALP workflow`
5. `Task: Reconcile generation-target support with documented behavior`
6. `Task: Add a shared inspect and trace model for debugging workflows`
7. `Task: Define and ship the debug support matrix as a maintained product contract`

These issues reduce the biggest current sources of drift before the
larger configurator redesign and scaffolding work begins.
