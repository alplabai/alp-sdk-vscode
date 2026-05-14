# ALP SDK VS Code Extension Plan

Last revised: 2026-05-14

## 1. Purpose

This plan defines how the ALP SDK VS Code extension evolves from a
thin wrapper around `board.yaml` tooling into a complete product
surface with:

- a polished VS Code user interface
- real LSP-backed editing assistance
- project and source-code generation
- explicit debugging and troubleshooting capabilities
- a first-class CLI workflow for terminal-focused users
- documentation that supports both GUI and CLI users without drift

The plan is intentionally product-oriented. It does not only list
features; it also defines the architectural rules needed to keep the
extension maintainable as the feature surface grows.

## 2. Product Goals

The extension should support three distinct user modes with one shared
core:

1. **Editor-first users** who want an intuitive VS Code experience for
   creating and maintaining ALP SDK projects.
2. **Power users** who prefer direct YAML editing, LSP feedback, and
   command palette workflows.
3. **CLI-first users** who want the same validation, generation, and
   scaffolding features from the terminal and in CI.

The end state is a workflow where users can:

- create a new project from templates
- configure hardware and software features through either UI or YAML
- receive precise diagnostics and quick fixes while editing
- inspect effective configuration, generation decisions, and
   environment state when something goes wrong
- generate all derived artifacts predictably
- scaffold source code and starter project structures
- run the same operations from the CLI in local development or CI

## 3. Non-Negotiable Principles

The roadmap below assumes five rules:

1. **One core, many surfaces.** The UI, LSP, and CLI must use the same
   validation, preset-resolution, and generation logic.
2. **No duplicate business logic in the extension host.** If a rule is
   needed by both editor and CLI, it belongs in a shared core package.
3. **Deterministic outputs.** The same input must always produce the
   same generated files.
4. **Power users stay first-class.** The GUI is additive, not a
   replacement for text editing and terminal workflows.
5. **Product quality matters.** The UI should feel native to VS Code,
   polished, and intentional, not like a generic generated web form.
6. **Debuggability is a product feature.** Users must be able to see
   why validation, generation, scaffolding, and environment discovery
   behaved the way they did.

## 4. Target Architecture

The feature set should converge on four layers:

### 4.1 Shared Core

Owns:

- `board.yaml` loading and effective config resolution
- preset catalogue discovery
- schema and semantic validation
- generation of derived outputs
- project and source scaffolding
- explanation and fix suggestions for diagnostics

### 4.2 Language Server

Owns:

- diagnostics
- completion
- hover
- code actions / quick fixes
- effective-config preview commands
- navigation to presets, schema sections, and generated outputs

Does not own:

- debug-session launch or attach orchestration
- flashing or probe control
- `launch.json` mutation as a side effect of editing
- environment doctor execution as the primary workflow surface
- support-bundle export as the primary workflow surface

### 4.3 VS Code UI

Owns:

- new project wizard
- persistent configurator panel
- preview / diff views
- guided generation and scaffolding flows
- status indicators and command entry points

### 4.4 CLI

Owns:

- validation
- generation
- project initialization
- scaffolding
- doctor / environment checks
- machine-readable output for CI

The CLI contract should be explicit and stable because it is the
automation surface for terminal users and CI.

### 4.5 Debug and Troubleshooting Surface

Owns:

- effective-config inspection
- generation-decision traces
- environment and dependency snapshots
- exportable debug bundles for issue reports
- guided troubleshooting entry points from UI and CLI

The key architectural requirement is that layers 4.2, 4.3, and 4.4 do
not implement domain rules independently.

### 4.6 Debug Ownership Contract (UI / CLI / LSP)

The ownership model for debug-related capabilities is strict:

| Capability | VS Code UI | CLI | LSP |
| ---------- | ---------- | --- | --- |
| Start/attach debug session | Primary | Secondary (headless preparation only) | No |
| Draft or update `launch.json` | Primary | Secondary (export/dry-run helpers) | No |
| Doctor/preflight execution | Entry and guided rendering | Primary automation surface | Explain-only references |
| Inspect and trace output | Interactive preview and summaries | Primary text/JSON surface | Inline explain/peek |
| Hover/completion/quick fix | No | No | Primary |
| Support-bundle export | Guided UX | Primary automation surface | No |

Routing rules:

- Debug launch and attach orchestration must stay in UI or CLI entry
   points.
- LSP must not mutate launch artifacts or run debug side-effect
   workflows.
- Shared debug models and serializers remain the single source of truth
   for all three surfaces.

Contract references:

- `DEBUG.md` defines the operational debug ownership matrix and LSP
   non-goals.
- `CLI.md` defines automation contract details for command behavior,
   JSON envelopes, and exit codes.

## 5. Phase Plan

## Phase 0 — Scope, Audience, and Contract

**Goal:** freeze what the product is, who it serves, and where each
capability belongs.

### Phase 0 Tasks

1. Define the primary user segments:
   - firmware engineer
   - board bring-up engineer
   - CLI-first build engineer
   - new-project onboarding user
2. Write the critical user journeys end-to-end:
   - create a new project
   - edit an existing `board.yaml`
   - validate before build
   - generate derived files
   - scaffold starter source files
   - debug validation, generation, and environment failures
3. Publish a capability matrix for UI, LSP, and CLI.
4. Define what remains out of scope for the first delivery wave.
5. Decide the first supported project templates.
6. Define output ownership rules:
   - user-owned files
   - generated files
   - generated-but-editable starter files
7. Define the first debug surfaces and which ones ship in the initial
   milestone:
   - inspect effective config
   - inspect generation trace
   - export debug bundle
   - environment doctor report

### Phase 0 Deliverables

- product requirements summary
- user journey map
- capability matrix
- initial template list

### Phase 0 Exit Criteria

- the team can answer "which surface owns this feature?" without
  ambiguity

## Phase 1 — Shared Core Extraction

**Goal:** move validation, generation, and future scaffolding logic
into a shared, testable core.

### Phase 1 Tasks

1. Define shared domain types:
   - `ProjectConfig`
   - `EffectiveProjectConfig`
   - `PresetCatalogue`
   - `ValidationIssue`
   - `GenerationTarget`
   - `ScaffoldTemplate`
2. Extract schema validation into the shared core.
3. Extract semantic validation into the shared core.
4. Extract preset resolution and inheritance into the shared core.
5. Extract all generation outputs behind a common API.
6. Define a fix-suggestion model for diagnostics.
7. Define a preview model for generated artifacts.
8. Add golden tests for resolved config and generated outputs.
9. Define versioning rules for generated output compatibility.
10. Define shared debug-artifact models for traces, inspect output, and
   support bundles.

### Phase 1 Deliverables

- shared core module/package
- deterministic generation API
- validation API
- golden-test suite

### Phase 1 Exit Criteria

- UI, LSP, and CLI can all call the same validation and generation
  entry points

## Phase 2 — LSP Foundation

**Goal:** replace file-save-triggered command execution with real
language tooling for `board.yaml` and related project files.

### Phase 2 Tasks

1. Introduce an LSP server using the VS Code language server stack.
2. Implement incremental document parsing and in-memory analysis.
3. Move diagnostics from ad-hoc process execution to the LSP.
4. Add completion for:
   - SKUs
   - carriers
   - libraries
   - inference backends
   - IoT feature flags
   - known scaffold templates
5. Add hover information with:
   - field description
   - default/inherited values
   - preset origin
   - compatibility notes
6. Add code actions for common errors:
   - insert missing required blocks
   - replace invalid enum values
   - suggest valid presets
   - remove deprecated fields
7. Add document symbols and outline support.
8. Add "preview effective config" command support through the LSP.
9. Add navigation from field references to preset definitions where
   practical.
10. Add "why did this resolve this way?" inspection support for active
   fields and effective values.
11. Add performance instrumentation and target latency budgets.

### Phase 2 Deliverables

- working language server
- diagnostics, completion, and hover
- first quick-fix set
- first inspect/debug commands
- LSP test harness

### Phase 2 Exit Criteria

- a user can edit `board.yaml` with precise, field-level feedback
  without manually running validation commands

## Phase 3 — VS Code UX Redesign

**Goal:** build a polished, native-feeling VS Code experience for both
new and experienced users.

### Phase 3 Tasks

1. Redesign the configurator into a multi-section experience with clear
   progression:
   - Project
   - Hardware
   - Features
   - Generation
   - Source Templates
   - Validation
2. Introduce a **new project wizard** for first-time project creation.
3. Keep the **persistent configurator** for existing projects.
4. Add **basic vs advanced** modes to reduce noise for new users.
5. Add **live preview** for:
   - effective `board.yaml`
   - generated outputs
   - planned source tree
6. Add an **apply with preview/diff** flow before files are written.
7. Add a **validation summary panel** with errors, warnings, and
   suggestions separated clearly.
8. Add contextual help and inline explanations.
9. Add a **debug/troubleshooting panel** for effective config,
   generation trace, and environment status.
10. Improve status bar and command discoverability.
11. Ensure keyboard-first interaction and accessibility.

### Phase 3 Deliverables

- redesigned configurator
- new project wizard
- preview/diff flow
- validation summary view
- debug/troubleshooting view

### Phase 3 Exit Criteria

- a new user can create or update a project entirely through VS Code
  without losing visibility into the underlying generated files

## Phase 4 — Project and Source Scaffolding

**Goal:** allow users to generate working starter projects and source
files, not only derived config fragments.

### Phase 4 Tasks

1. Define a scaffold/template manifest format.
2. Implement project initialization for common entry points:
   - minimal ALP app
   - sensor app
   - IoT app
   - edge AI app
   - board diagnostics app
3. Generate baseline project files such as:
   - `board.yaml`
   - `CMakeLists.txt`
   - `prj.conf`
   - `src/main.c`
   - optional module files
4. Add conditional file emission based on selected features.
5. Define overwrite and regeneration policy.
6. Add partial scaffolding so users can generate only a feature module
   or sample file into an existing project.
7. Add preview support for project tree and file contents.
8. Add explanation support for generated source files.

### Phase 4 Deliverables

- scaffold engine
- starter template library
- preview/apply workflow for source generation
- overwrite policy documentation

### Phase 4 Exit Criteria

- users can create a credible starter project without manually copying
  examples from the repo

## Phase 5 — CLI Product Surface

**Goal:** deliver full terminal and CI support for users who do not
want to depend on the VS Code UI.

### Planned Command Family

- `alp init`
- `alp validate`
- `alp generate`
- `alp scaffold`
- `alp explain`
- `alp doctor`
- `alp presets`
- `alp diff`
- `alp inspect`
- `alp trace`
- `alp support-bundle`

### Phase 5 Tasks

1. Define CLI command structure and help conventions.
2. Implement `alp validate` with human-readable and JSON output.
3. Implement `alp generate` with single-target and `--all` flows.
4. Implement `alp init` with interactive and non-interactive modes.
5. Implement `alp scaffold` for project and partial-template output.
6. Implement `alp doctor` for environment and dependency checks.
7. Implement `alp explain` for diagnostics and compatibility issues.
8. Implement `alp inspect` for effective config and resolved values.
9. Implement `alp trace` for generation and decision tracing.
10. Implement `alp support-bundle` for issue-report export.
11. Add shell completion for supported shells.
12. Define stable exit-code behavior for CI.
13. Add integration tests for the CLI command family.

### Phase 5 Deliverables

- CLI entry point
- CI-friendly JSON output mode
- documented exit codes
- shell completion support
- debug and inspect command set

### Phase 5 Exit Criteria

- a CLI-first user can complete the same major workflows as a VS Code
  user

## Phase 6 — Documentation System

**Goal:** provide clear, parallel documentation for GUI and CLI users
without duplicating or contradicting the product behavior.

### Phase 6 Tasks

1. Reorganize documentation around tasks rather than internal modules.
2. Write separate but aligned guides for:
   - VS Code workflow
   - CLI workflow
   - LSP/editor features
   - project scaffolding
   - generation outputs
3. Add task-based walkthroughs for common jobs.
4. Add command reference documentation for the CLI.
5. Add troubleshooting for:
   - validation errors
   - generation conflicts
   - environment problems
   - preset discovery problems
6. Add dedicated debugging documentation for:
   - inspect output
   - trace output
   - support-bundle collection
   - issue-report workflow
7. Add "recipes" for common scenarios.
8. Add drift checks where practical so documented command examples do
   not silently rot.

### Phase 6 Deliverables

- task-based docs set
- CLI reference
- VS Code usage guide
- troubleshooting matrix

### Phase 6 Exit Criteria

- new users can choose GUI or CLI quickly and follow a clear path to a
  working project

## Phase 7 — Quality, Compatibility, and Release Readiness

**Goal:** make the combined UI/LSP/CLI surface reliable enough to ship
and evolve without regressions.

### Phase 7 Tasks

1. Define the full test matrix:
   - unit tests
   - golden output tests
   - LSP tests
   - UI smoke tests
   - CLI integration tests
2. Define backward-compatibility rules for:
   - schema support
   - generation targets
   - scaffold templates
   - CLI flags and JSON output
3. Define performance budgets for:
   - completion latency
   - validation latency
   - generation time
4. Add release gates and checklists.
5. Add basic instrumentation and debugging support.
6. Define upgrade guidance when schema or template behavior changes.
7. Add supportability checks for exported traces and debug bundles.

### Phase 7 Deliverables

- release checklist
- compatibility policy
- test strategy document
- performance budget
- supportability/debugging contract

### Phase 7 Exit Criteria

- new releases can expand features without producing drift between the
  UI, LSP, CLI, and documentation surfaces

## 6. Cross-Functional Workstreams

The roadmap above should be executed through three continuous
workstreams rather than a single serial implementation stream.

### Workstream A — Core Platform

Owns:

- domain model
- validation
- generation
- scaffolding
- compatibility policy

### Workstream B — Editor Experience

Owns:

- LSP
- configurator UI
- wizard flows
- preview/diff views
- command palette integration

### Workstream C — CLI and Documentation

Owns:

- CLI design and implementation
- task-oriented documentation
- examples and recipes
- CI integration guidance

## 7. Recommended Delivery Order

The implementation order should be:

1. Phase 0 — scope and contracts
2. Phase 1 — shared core extraction
3. Phase 2 — LSP foundation
4. Phase 3 — VS Code UX redesign (MVP)
5. Phase 5 — CLI foundation
6. Phase 4 — project/source scaffolding
7. Phase 6 — expanded docs
8. Phase 7 — release hardening

This sequence minimizes rework. If the team builds the UI and CLI
before the shared core exists, the product will accumulate duplicate
logic and drift quickly.

## 8. First 90-Day Execution Slice

### Slice A — Foundation

1. Finalize product scope and template shortlist.
2. Extract validation and generation into a shared core.
3. Stand up the LSP server skeleton.
4. Move diagnostics into the LSP.
5. Add first completions and hover support.
6. Introduce CLI `validate`, `generate`, and `inspect`.

### Slice B — Experience

1. Ship the first redesign of the configurator.
2. Add preview and diff support.
3. Add first quick fixes.
4. Introduce CLI `init`, `doctor`, and `trace`.
5. Ship the first debug/troubleshooting panel in VS Code.
6. Publish the first GUI and CLI usage guides.

### Slice C — Scaffolding and Hardening

1. Ship the scaffold engine and initial templates.
2. Add partial scaffolding into existing projects.
3. Add end-to-end tests for UI, LSP, and CLI.
4. Freeze initial compatibility guarantees.
5. Prepare the first release-ready milestone.

## 9. Success Metrics

The plan should be considered successful when the product can meet the
following conditions:

1. A new user can create a working ALP SDK project in VS Code without
   manually copying an example.
2. A power user can edit `board.yaml` directly with precise LSP
   feedback and quick fixes.
3. A CLI-first user can validate, generate, scaffold, and troubleshoot
   a project without opening the UI.
4. The same project definition produces the same outputs whether the
   user works through UI, LSP-assisted editing, or CLI.
5. Documentation matches the implemented behavior closely enough that
   command and workflow drift becomes the exception, not the norm.

## 10. Immediate Next Step

The next concrete action should be to turn **Phase 0** into a short
requirements document and derive a tracked backlog from it. Until that
exists, implementation work will remain vulnerable to feature creep and
surface-level fixes instead of system design.

## 11. Operational Backlog — Epic / Task / Subtask

This section converts the phase plan into a trackable delivery shape.
It is intentionally biased toward implementation sequencing rather than
project-management ceremony.

## Epic 1 — Product Contract and Workflow Definition

**Outcome:** the team agrees on who the product serves, which workflows
are first-class, and which features belong to UI, LSP, CLI, or shared
core.

### Task 1.1 — Define primary user journeys

Subtasks:

1. Document the end-to-end journey for creating a new project.
2. Document the journey for editing an existing `board.yaml` project.
3. Document the journey for generating outputs before build.
4. Document the journey for scaffolding starter source code.
5. Document the CLI-first journey for CI and headless use.

### Task 1.2 — Freeze product boundaries

Subtasks:

1. Publish a capability matrix for UI, LSP, CLI, and shared core.
2. List explicitly unsupported or deferred features.
3. Define the initial project-template shortlist.
4. Define ownership rules for generated files versus user-owned files.

### Task 1.3 — Define acceptance criteria per surface

Subtasks:

1. Define what "good enough" means for the configurator MVP.
2. Define what "good enough" means for the first LSP milestone.
3. Define what "good enough" means for the CLI baseline.
4. Define documentation expectations for each surface.

## Epic 2 — Shared Core Platform

**Outcome:** UI, LSP, and CLI all consume one deterministic domain
engine.

### Task 2.1 — Build the shared domain model

Subtasks:

1. Define `ProjectConfig` and `EffectiveProjectConfig` types.
2. Define `PresetCatalogue` and preset-origin metadata types.
3. Define `ValidationIssue`, severity, and fix-suggestion models.
4. Define `GenerationTarget` and `GeneratedArtifact` models.
5. Define `ScaffoldTemplate` and template-parameter models.

### Task 2.2 — Extract validation into the core

Subtasks:

1. Move schema validation behind a stable API.
2. Move semantic validation behind the same API.
3. Add preset-resolution and inheritance handling.
4. Add compatibility checks for unsupported combinations.
5. Add structured error and warning output.

### Task 2.3 — Extract generation into the core

Subtasks:

1. Normalize generation entry points for all targets.
2. Implement preview support before writing files.
3. Implement deterministic artifact ordering and formatting.
4. Add golden tests for generated outputs.
5. Define stable generation contracts for CLI and UI callers.

### Task 2.4 — Prepare scaffolding support

Subtasks:

1. Define a template manifest format.
2. Define template parameter resolution rules.
3. Define overwrite policy for generated starter files.
4. Add preview support for scaffolded project trees.

## Epic 3 — Language Server

**Outcome:** `board.yaml` editing becomes LSP-native rather than
command-triggered.

### Task 3.1 — Stand up the language server

Subtasks:

1. Add the language server and client wiring.
2. Implement document lifecycle handling.
3. Add incremental analysis and caching.
4. Add tracing and debugging hooks.

### Task 3.2 — Ship diagnostics

Subtasks:

1. Port existing diagnostics from extension-host execution to LSP.
2. Attach diagnostics to precise fields where possible.
3. Distinguish errors, warnings, and suggestions.
4. Add effective-config and preset-origin context to messages.

### Task 3.3 — Ship editor intelligence

Subtasks:

1. Add completion for known enums and presets.
2. Add hover for field semantics and inherited defaults.
3. Add document symbols and outline support.
4. Add quick fixes for common issues.
5. Add command-backed effective-config preview.

## Epic 4 — VS Code UX and Guided Flows

**Outcome:** the extension feels like a polished VS Code product and
not just a thin wrapper panel.

### Task 4.1 — Redesign the configurator

Subtasks:

1. Split the configurator into logical sections.
2. Add basic and advanced modes.
3. Improve field grouping and visual hierarchy.
4. Add inline help and contextual explanations.
5. Preserve compatibility with hand-edited YAML.

### Task 4.2 — Add new-project onboarding

Subtasks:

1. Add a first-run project creation wizard.
2. Let the wizard choose template, hardware, and feature set.
3. Show generated files before write.
4. Create the initial workspace layout and starter files.

### Task 4.3 — Add preview and diff experiences

Subtasks:

1. Show effective config preview.
2. Show generated output preview.
3. Show scaffolded project tree preview.
4. Add write confirmation for changed files.
5. Add validation summary view before apply.

## Epic 5 — Project and Source Scaffolding

**Outcome:** users can generate complete starter projects and feature
modules from curated templates.

### Task 5.1 — Build project templates

Subtasks:

1. Add a minimal ALP app template.
2. Add a sensor-oriented template.
3. Add an IoT template.
4. Add an edge-AI template.
5. Add a board-diagnostics template.

### Task 5.2 — Build partial scaffolding

Subtasks:

1. Add module-level source generation into existing projects.
2. Allow template parameters to be resolved from current config.
3. Avoid overwriting user-modified files silently.
4. Add explanation support for generated starter code.

## Epic 6 — CLI Product Surface

**Outcome:** the same workflows are available from the terminal and in
CI.

### Task 6.1 — Build the CLI command foundation

Subtasks:

1. Introduce a stable CLI entry point.
2. Add shared argument parsing conventions.
3. Add machine-readable JSON output mode.
4. Define stable exit-code behavior.

### Task 6.2 — Ship baseline commands

Subtasks:

1. Implement `alp validate`.
2. Implement `alp generate`.
3. Implement `alp init`.
4. Implement `alp doctor`.
5. Implement `alp explain`.

### Task 6.3 — Ship advanced commands

Subtasks:

1. Implement `alp scaffold`.
2. Implement `alp presets`.
3. Implement `alp diff`.
4. Add shell completion support.
5. Add CI integration examples.

## Epic 7 — Documentation and Recipes

**Outcome:** both VS Code users and CLI users get task-oriented,
accurate documentation.

### Task 7.1 — Reorganize docs by workflow

Subtasks:

1. Add VS Code getting-started documentation.
2. Add CLI getting-started documentation.
3. Add LSP/editor feature documentation.
4. Add generation-output documentation.
5. Add source-scaffolding documentation.

### Task 7.2 — Add troubleshooting and recipes

Subtasks:

1. Add validation troubleshooting.
2. Add generation-conflict troubleshooting.
3. Add environment and toolchain troubleshooting.
4. Add common task recipes for GUI and CLI.
5. Add CI usage examples.

## Epic 8 — Quality and Release Engineering

**Outcome:** the product can scale without drift between surfaces.

### Task 8.1 — Build the automated test matrix

Subtasks:

1. Add unit tests for the shared core.
2. Add golden tests for generation outputs.
3. Add language-server tests.
4. Add webview smoke tests.
5. Add CLI integration tests.

### Task 8.2 — Define release contracts

Subtasks:

1. Define compatibility rules for schema changes.
2. Define compatibility rules for generation targets.
3. Define compatibility rules for CLI flags and JSON output.
4. Define release gates and checklists.
5. Add performance budgets and regression checks.

## 12. Initial Backlog — Phase 1, Repo-Shaped

This backlog translates the first implementation wave into concrete
work aligned with the current repository layout.

## Backlog Group A — Shared Core Extraction

### Task A1 — Create a shared core module

Target areas:

- `src/` new shared domain files
- `src/loader.ts`
- `src/diagnostics.ts`
- `src/configuratorPanel.ts`

Subtasks:

1. Add shared config and validation types under `src/`.
2. Move process-result parsing into reusable helpers.
3. Define a single artifact-generation result model.
4. Add unit-testable interfaces for validation and generation.

### Task A2 — Normalize SDK root and project root resolution

Target areas:

- `src/util.ts`
- `src/loader.ts`
- `src/west.ts`

Subtasks:

1. Support the current split-repo + submodule layout cleanly.
2. Support standalone consumer workspaces cleanly.
3. Distinguish SDK root, project root, and west working directory.
4. Add explicit failure messaging for ambiguous workspace layouts.

### Task A3 — Normalize generation workflows

Target areas:

- `src/loader.ts`
- `package.json`
- docs references

Subtasks:

1. Reconcile actual supported emit modes with upstream docs.
2. Add a central map for supported generation targets.
3. Add preview metadata for each target.
4. Add tests for success and failure-path handling.

## Backlog Group B — LSP Baseline

### Task B1 — Introduce language-server packages and structure

Target areas:

- `package.json`
- `src/extension.ts`
- new `src/lsp/` or equivalent

Subtasks:

1. Add the language-client dependency.
2. Add the language-server dependency.
3. Create server bootstrap files.
4. Wire activation and shutdown through the extension entry point.

### Task B2 — Port diagnostics to LSP

Target areas:

- `src/diagnostics.ts`
- new server diagnostics module

Subtasks:

1. Move validation triggers from file-open/save handlers to the LSP.
2. Preserve current validator behavior as baseline compatibility.
3. Improve diagnostic ranges beyond line-1 fallback where practical.
4. Keep Problems panel behavior stable during the transition.

### Task B3 — Add first completions and hover

Target areas:

- new server completion module
- new server hover module
- schema/catalogue integration points

Subtasks:

1. Complete SKUs and carriers from the preset catalogue.
2. Complete enums for known fields.
3. Show hover text for field meaning and defaults.
4. Show preset-origin context where available.

## Backlog Group C — Configurator MVP Improvement

### Task C1 — Expand the configurator data model

Target areas:

- `src/configuratorPanel.ts`
- `media/configurator.js`
- `media/configurator.css`

Subtasks:

1. Align the UI model with more of the real `board.yaml` surface.
2. Add support for fields currently omitted from the GUI.
3. Reduce hardcoded catalog values where schema-derived values are
   possible.
4. Preserve hand-edited YAML semantics on save.

### Task C2 — Add preview and validation summary

Target areas:

- `src/configuratorPanel.ts`
- `media/configurator.js`

Subtasks:

1. Show a preview of the effective config before save.
2. Show validation status inside the configurator.
3. Highlight blocking issues before generation.
4. Add clear success/failure feedback after write.

## Backlog Group D — West and Workflow Alignment

### Task D1 — Align build commands with canonical ALP workflow

Target areas:

- `src/west.ts`
- `README.md`
- command titles in `package.json`

Subtasks:

1. Reconcile `west build` behavior with documented `west alp-build`
   workflow.
2. Decide whether to expose both paths or one canonical path.
3. Ensure generated artifacts and validation happen in the expected
   order.
4. Update command descriptions to match actual behavior.

### Task D2 — Improve environment checks

Target areas:

- `src/bootstrap.ts`
- `src/west.ts`

Subtasks:

1. Check for `west` availability before issuing commands.
2. Check for Python availability before validation/generation.
3. Improve host-specific messaging for missing prerequisites.
4. Prepare shared checks for future CLI reuse.

## Backlog Group E — Documentation Alignment

### Task E1 — Reconcile docs with actual extension behavior

Target areas:

- `README.md`
- future VS Code usage docs
- command descriptions

Subtasks:

1. Update documentation that overstates current capabilities.
2. Align documented emit-mode counts with implemented support.
3. Align build-flow documentation with real command behavior.
4. Add a clear distinction between current state and planned state.

## 13. Recommended First Sprint

If the team wants the highest leverage first sprint, it should focus on
the following items only:

1. Task A2 — normalize SDK/project root resolution.
2. Task B1 — introduce the LSP skeleton.
3. Task B2 — port diagnostics into the LSP baseline.
4. Task D1 — reconcile `west` workflow behavior.
5. Task E1 — reconcile docs with actual shipped behavior.

This sprint does not try to solve the full UI problem. It reduces the
current sources of drift first, then creates a stable platform for the
larger UX and scaffolding work.
