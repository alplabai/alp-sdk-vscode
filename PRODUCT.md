# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary — and only confirmed — audience is an **external customer firmware
developer who has bought an E1M module and is installing the Alp SDK for the
first time.** They have no cross-toolchain on the machine, have never seen a
`board.yaml`, and do not know the `tan` CLI surface. They are in VS Code, with
the module physically in front of them, and their job is: scaffold a project,
configure it for their exact SoM, build it, and flash it.

Alp Lab's own firmware team also uses the extension, but was *not* confirmed as
a design audience during init. Future work must not trade away the first-run
experience for internal-bench convenience without asking.

## Product Purpose

**Alp IDE** (`AlpLabAI.alp-sdk`, VS Code `^1.85.0`, Apache-2.0) is the IDE half
of the Alp SDK toolchain. It gives Alp SDK projects first-class VS Code support:
schema-aware `board.yaml` editing through an LSP, generation of Zephyr conf /
DTS overlay / CMake args / Yocto conf, per-OS dependency bootstrap, project
scaffolding, SDK release management, and `build` / `flash` / `run` workflows —
all driven by the standalone `tan` CLI rather than reimplemented.

Success is measured four ways, all confirmed:

1. **Time to first working build + flash** — from zero install to a flashed
   module, and the drop-off rate along that path.
2. **Daily loop efficiency** — an experienced user completes
   build / flash / debug / monitor without dropping to a terminal.
3. **Never producing a wrong hardware configuration** — `board.yaml` validation
   and write gates must prevent flashing the wrong module or committing an
   off-rail configuration.
4. **Supporting E1M module adoption** — the IDE is how the E1M SoM family is
   evaluated; tooling quality is part of the purchase decision.

## Positioning

Four mechanisms a neighboring embedded extension could not truthfully copy:

- **The CLI is the source of truth, and the IDE is the orchestration seam.**
  `docs/EXTENSION_CLI_INTEGRATION.md` defines three invocation modes (envelope,
  terminal, channel); command *behavior* lives in `tan`, never duplicated in
  TypeScript. `docs/ARCHITECTURE_RULES.md` enforces the Surface / Service split
  that keeps it that way.
- **Editor and CLI agree by construction.** When an SDK is resolved, both
  `board.yaml` and `system-manifest.yaml` validate against *that SDK's own*
  schemas at `<sdkRoot>/metadata/schemas/`. The extension pins no SDK version,
  so this is the only way the two can agree. The vendored copies
  (`VENDORED_SDK_TAG = "v0.15.0"`) are the fallback for the common first-run
  state: a customer with no SDK yet.
- **Native-first shell.** `docs/ADR-native-shell-ux.md` (Accepted, 2026-06-05)
  commits the shell to VS Code primitives — Activity Bar trees, status bar,
  walkthrough, quick picks — and reserves webviews for genuinely visual
  surfaces and custom editors.
- **Conservative hardware claims.** The Models panel reports NPU coverage as
  *eligibility* (`full-eligible` / `partial` / `cpu-only` / `undetermined`), not
  as placement, unless a real compile proves it; host runs and A-B comparisons
  are labeled reference results, never the target SoM's measured performance.

## Operating Context

- Ships as a single VS Code extension, version `0.6.0`, distributed via the
  Marketplace and as a `.vsix`.
- **Shell:** one Activity Bar container, *Alp IDE*, with native tree views
  (`src/views/`: `setup`, `workspaces`, `projects`, `sdk`, `build`), a status
  bar, and a 4-step walkthrough *"Get started with Alp IDE"* (Install the Alp
  SDK -> Open or create a project -> Bootstrap your toolchain -> Build & flash).
  48 commands, 8 settings, 1 custom editor (`alp.boardConfigurator`).
- **Webview surfaces** (`packages/alp-webview`, routed by `App.tsx`):
  `overview`, `sidebar-hub`, `setup-flow`, `new-project-flow`,
  `existing-project-flow`, `sdk-manager`, `configurator`, `dependencies`,
  `hardware-explorer`, `build-plan`, `models`.
- **Target hardware:** 11 E1M SoM SKUs across three families, from
  `E1M_MODULES` in `src/ideHub/projectScaffold.ts` —
  `alif-ensemble`: `E1M-AEN301`, `E1M-AEN401`, `E1M-AEN501`, `E1M-AEN601`,
  `E1M-AEN701`, `E1M-AEN801`;
  `renesas-rzv2n`: `E1M-V2N101`, `E1M-V2N102`;
  `renesas-rzv2n-deepx`: `E1M-V2M101`, `E1M-V2M102`;
  `nxp-imx9`: `E1M-NX9101`.
- **Dependencies on other extensions:** `extensionDependencies` are
  `redhat.vscode-yaml` and `marus25.cortex-debug`; `extensionPack` adds
  `ms-vscode.cpptools` and `vadimcn.vscode-lldb`.
- **Trust:** `untrustedWorkspaces.supported` is `false`. The extension spawns
  `tan`, `west`, and the cross-toolchain driven by workspace-controlled inputs
  (`board.yaml`, `CMakeLists`, west manifests, `.vscode/settings.json`), so an
  untrusted folder could run code the user did not write.

## Capabilities and Constraints

- **Pinned CLI:** `SUPPORTED_CLI_VERSION = "0.6.0"` (`src/alpCli/service.ts:98`)
  — the GA tag this repo moved the `0.6.0-rc1` pin to once it was cut. The
  Renesas `CONFIG_ALP_SDK_CHIP_NONE` fix (tan-cli#688) was already present in
  `0.6.0-rc1` itself ("45 ahead / 0 behind", `src/alpCli/service.ts:71-72`) —
  GA did not newly add it, it dropped the rc label from a tag that already
  carried it; the pin moved because the GA tag was cut, not because the fix
  arrived. No longer a prerelease. `RENESAS_BUILD_CLI_VERSION = "0.6.0-rc1"`
  (`src/alpCli/somCliFloor.ts:39`) is a *separate* feature gate against the tan
  actually running, and stays at `rc1` even when the pin moves.
- **CLI surface is narrower than the UI.** The pinned tan does not implement
  every subcommand the panels drive;
  `packages/alp-webview/src/features/models/cliSurface.ts` classifies that on
  the machine-readable code `model.unknown-subcommand`, never on prose.
- **Models is currently unreachable.** `alp.openModelsPanel` and
  `alp.buildModel` are registered commands but palette-guarded with
  `"when": "false"`; the panel code, route, and gates are intact. Restoring the
  surface is tracked, not a bug to re-discover.
- **No shipped flash write gate.** No call site passes `--confirm` to
  `tan flash`, and there is no `src/flash/` module. Treat irreversible-write
  consent as an open product decision, not an existing guarantee.
- **Consent already required:** `alpSdk.tanCliDownloadConsent` gates the first
  download of the managed `tan` binary; a QuickPick gates dependency installs
  before any package manager runs.
- **Webview styling is theme-derived, and this is enforced.**
  `packages/alp-webview/src/styles/tokens.css` maps `--vscode-*` host variables
  to semantic aliases; colors must use `var(--vscode-*)` exclusively, with no
  hardcoded hex/rgb/hsl. `test/webview.cssTokens.test.js` fails on any token
  used but not declared. `test/webviewHtml.csp.test.js` gates the CSP: no
  external assets. Component styles are CSS Modules; no CSS framework.
- **One known host trap:** `--vscode-editor-font-family` resolves *empty* in
  some webview hosts, which collapses a nested `var()` fallback. `tokens.css`
  therefore ships a concrete `--text-mono` stack instead.
- **Typography and spacing are anchored to the workbench.** Font sizes are
  `calc()` offsets from `--vscode-font-size`, so panels honor the user's editor
  font size. Layout is capped by two tokens: `--content-max: 1600px` for the
  shell and `--prose-max: 90ch` for running text.
- **Motion:** `--duration-fast/base/slow` are reset to `0ms` under
  `prefers-reduced-motion: reduce`.
- **Stack (existing, not a decision to reopen):** React 19 + Vite 8 +
  TypeScript, CSS Modules, no runtime UI library. The webview is a static bundle
  loaded by the extension host — there is no dev server, so browser-based live
  iteration does not apply.
- **Vocabulary future work must use exactly:** SoM, SKU, core, slice,
  `board.yaml`, `system-manifest.yaml`, `tan`, `west`, Zephyr, Yocto, NPU
  coverage, preset, `populated`, carrier/board preset, app directory, inference
  arena, IPC / RPMsg carve-out.

## Brand Commitments

- Product name **Alp IDE** (`displayName`); extension id `alp-sdk`; publisher
  `AlpLabAI`; license Apache-2.0.
- Assets: `media/icon.png`,
  `packages/alp-webview/src/assets/alplab-logo-white.svg`.
- Voice in shipped copy is precise, hardware-literal, and deliberately
  under-claiming: an estimate is called an estimate, a host run is called a
  reference. Register names, SKUs, versions, and paths appear verbatim, never
  rounded or abbreviated.

## Evidence on Hand

- **Real product screenshots:** `media/screenshots/01-…` through `15-…` (IDE Hub
  overview, the 6-step New Project flow, 7 Configurator tabs, SDK Manager).
- **Documentation:** 30 files under `docs/`, including
  `ARCHITECTURE_RULES.md`, `ADR-native-shell-ux.md`,
  `EXTENSION_CLI_INTEGRATION.md`, `GETTING_STARTED_VSCODE.md`,
  `TEST_MATRIX.md`, `PERFORMANCE_BUDGETS.md`, `RELEASE_GATES.md`.
- **Runnable example:** `examples/alp-sample`.
- **Test suite:** roughly 160 test files.

**Absences future work must not fabricate:** there are no testimonials, no named
customers, no install counts, no pricing or licensing tiers, no published
benchmarks, and no on-device performance measurements (power and on-device
timing are hardware-gated). Do not invent E1M SKUs — `E1M-V2N1010` and
`E1M-NX9999` appear in the repository only as hypothetical or fixture values and
are not products.

## Product Principles

1. **The CLI decides, the IDE orchestrates.** When behavior could live in either
   place, it belongs in `tan`. The extension's value is the IDE-specific seam:
   surfacing, gating, and sequencing.
2. **Agree by construction, not by convention.** Validate against the resolved
   SDK's own schemas so the editor and the CLI cannot drift apart.
3. **A webview must earn its place.** Native VS Code primitives are the default;
   a webview is justified only by a genuinely visual surface or a custom editor.
4. **Never overstate hardware truth.** Estimates are labeled estimates, host
   runs are labeled reference, and a claim nobody measured does not ship.
5. **The first hour decides everything.** The customer meeting the SDK for the
   first time is the user the product is designed around; convenience for the
   already-expert never comes out of that hour.

## Accessibility & Inclusion

**WCAG 2.2 Level AA is the binding target for all webview surfaces.**

Already in place and not to be regressed: keyboard-only focus rings via
`:focus-visible` with `--border-focus`, full `prefers-reduced-motion` support,
and contrast inherited from the user's active VS Code theme rather than
hardcoded — which is also why the no-hardcoded-color rule is a gated test and
not a style preference.
