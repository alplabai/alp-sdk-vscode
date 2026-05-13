# ALP SDK VS Code Extension Architecture Rules

Last revised: 2026-05-14

This document is the implementation contract for extension structure and
layering.

## 1. Layer Contract

### 1.1 Manifest Layer

Owner: `package.json`

Responsibilities:

- extension identity, engine compatibility, and contribution points
- activation events and command declarations
- extension settings declarations

Rules:

- runtime behavior must not be implemented in manifest fields
- command behavior must be implemented in source files, never in scripts

### 1.2 Surface Layer (Extension Host Orchestration)

Owners:

- `src/extension.ts`
- top-level command and UI files (for example `src/loader.ts`,
  `src/debug.ts`, `src/west.ts`, `src/configuratorPanel.ts`,
  `src/statusBar.ts`, `src/diagnostics.ts`)

Responsibilities:

- register commands, subscriptions, and UI entry points
- collect inputs from user interactions
- call service and adapter modules
- map domain outcomes to UX messages

Rules:

- no domain rule implementation in surface files
- no duplicate validation/generation/debug logic
- orchestration only

### 1.3 Service Layer (Pure Domain Logic)

Owners:

- `src/*/service.ts`
- pure helper modules such as `src/debug/launchJsonCore.ts`

Responsibilities:

- deterministic domain decisions
- validation outcome classification
- plan generation and output shaping

Rules:

- no `vscode` imports
- no `fs`, `child_process`, or terminal calls
- deterministic inputs and outputs only

### 1.4 Adapter Layer (Runtime Boundary)

Owners:

- `src/*/vscodeAdapter.ts`
- `src/*/adapterCore.ts` when seam extraction is needed

Responsibilities:

- VS Code API access
- filesystem and process interaction
- thin conversion between runtime outputs and model types

Rules:

- adapters may call services, never the reverse
- adapter cores stay pure and testable
- runtime wrappers stay thin

### 1.5 Model Layer

Owners:

- `src/*/models.ts`

Responsibilities:

- shared type contracts for each slice
- explicit request/result model shapes

Rules:

- no runtime behavior in models
- keep contracts stable and explicit

### 1.6 LSP Split

Owners:

- `src/lsp/client.ts` (extension host client)
- `src/lsp/server.ts` (language server process)

Responsibilities:

- client: lifecycle wiring, process startup, synchronization config
- server: language analysis capabilities

Rules:

- server logic must not depend on extension host UI code
- diagnostics/completion/hover ownership belongs to LSP as migration
  proceeds

## 2. Dependency Direction

Allowed direction:

`surface -> service`
`surface -> adapter`
`adapter -> service`
`service -> models`

Forbidden direction:

- `service -> adapter`
- `service -> vscode`
- `models -> runtime APIs`
- cross-slice copy-paste of domain rules

## 3. Workspace and Path Resolution

`src/project/service.ts` is the single source of truth for:

- workspace root
- sdk root
- board yaml path
- west cwd
- python binary

Rules:

- if sdk root is ambiguous across workspace folders, require
  `alpSdk.path`
- do not reimplement root resolution in other slices

## 4. Validation and Debug Ownership

- Validation planning and outcome analysis belong to
  `src/validation/service.ts`
- Loader and diagnostics surfaces must call validation service instead
  of duplicating classification logic
- Debug launch drafting belongs to `src/debug/service.ts`
- Launch JSON merge/write planning belongs to
  `src/debug/launchJsonCore.ts`

## 5. Testing Rules

### 5.1 Service Tests

- test pure domain behavior directly from compiled outputs

### 5.2 Adapter-Core Tests

- test seam functions with injected dependencies
- avoid requiring VS Code runtime for unit tests

### 5.3 Runtime Wrapper Tests

- keep minimal and focused unless behavior requires integration coverage

## 6. Change Checklist (Required)

Before merging architecture-sensitive changes, verify:

- no business logic was added to surface files
- no runtime imports were added to service modules
- no duplicated domain rule was introduced across slices
- `npm test` passes
- docs are updated if ownership/responsibility changed
