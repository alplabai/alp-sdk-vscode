<!-- SPDX-License-Identifier: Apache-2.0 -->

# ADR: Native-first IDE shell, webview reserved for visual surfaces

**Status:** Accepted — implemented on `feat/webview-ui` (2026-06-05).
**Deciders:** Hakan (alp-sdk-vscode).
**Scope:** the extension's UX architecture — what lives in native VS Code
primitives vs. in React webviews.

> **Implementation log** (all phases landed):
>
> - **R** — Build Plan rescued into a live `BuildPlanPanel` + Build & Flash tree
>   node + `alp.showBuildPlan`.
> - **A** — status bar promoted to an action surface (board target + Build/Flash).
> - **B** — `contributes.walkthroughs` "Get started with ALP SDK" +
>   `alp.openGettingStarted`.
> - **C** — configurator is now a document-backed `CustomTextEditor` for
>   `board.yaml` (priority `option`); `alp.openConfigurator` opens it via
>   `vscode.openWith`; the old `ConfiguratorPanel` is retired.
> - **Cleanup** — orphan AppShell (`alp-ide.panel` provider + tab-only
>   components) removed; `App.tsx` is now a pure mode-router; webview bundle
>   105 → 86 modules.
>
> Decisions taken during implementation: Phase C ships as an **opt-in** custom
> editor (text editor stays the default for `board.yaml`); the setup-flow
> webview wizard is kept as a fallback alongside the new Walkthrough.

## Context

VS Code's own UX guidance is explicit: **"webviews should only be used if you
absolutely need them"** — they are resource-heavy, run in a separate context,
"can easily feel out of place," and should _not_ be used for wizards, Welcome
pages, Settings, or "every window." The recommended primitives are **Tree
Views, Status Bar, Quick Picks, Command Palette, Walkthroughs, Notifications,
Settings**. The leading embedded VS Code extensions follow this:

- **PlatformIO** — an Activity-Bar "Project Tasks" **TreeView**; tasks run in the
  terminal. No custom webview for actions.
- **nRF Connect** — Activity-Bar sidebar **tree sections** (Welcome/Actions,
  Applications, Connected Devices) + a **webview only** for the genuinely visual
  DeviceTree viewer.

### What we already have (inventory, 2026-06-05)

Good news: the extension **already follows native-first** for its core shell.
`src/extension.ts` activates exactly two things:

- **`createStatusBar`** — a read-only board-summary item.
- **`registerTreeViews`** — the Activity-Bar container **ALP IDE** with five
  native `TreeDataProvider`s: **Setup**, **West Workspaces**, **Projects**, **SDK
  Manager**, and **Build & Flash**. The Build & Flash tree already lists West
  Build / Flash / Run (native_sim) / ALP Image / ALP Flash / West Update /
  Clean as clickable items. (Renode was in that list until tan v0.6.0 removed
  the verb — #584.)

Webview **panels** (full-tab `WebviewPanel`s opened by commands) cover the
genuinely visual / flow surfaces: `openConfigurator`, `toolchainDoctor`,
`openHardwareExplorer`, `openOverview`, `openSetupFlow`, `newProjectWizard`,
`openExistingProject`, `openSdkManager`.

**The orphan:** the React **AppShell** (the 5-tab `App.tsx` sidebar mode behind
`alp-ide.panel`, registered by `src/ideHub/provider.ts`) is **neither activated
in `extension.ts` nor contributed in `package.json`** → it is dead. Consequently
the recently-added **Build Plan tab** and the AppShell tab iconography are **not
reachable** in the shipped extension. (Still live + valuable from that work: the
global foundation styles, the iconography on the real panels, and the build-plan
consumer logic in `alp-core` + `provider.ts` — just not yet surfaced.)

## Decision

Commit to **native-first; reserve webviews for visual surfaces and custom
editors.** This is mostly _already true_; this ADR finishes it and reconciles
the orphan:

1. Keep the five native trees + status bar as the shell.
2. Reserve webviews for: the **Configurator** (visual board.yaml editor), the
   **Hardware Explorer** (SoM/topology map), and the **Build Plan** preview.
3. Replace the **setup-flow webview wizard** with a native **Walkthrough**
   (VS Code lists wizards as a webview anti-pattern).
4. Promote the **Status Bar** from read-only to an action surface (build target +
   Build/Flash).
5. **Retire the orphan AppShell** and its now-superseded tab components.

## Plan (phased, each independently shippable on `feat/webview-ui`)

### R — Rescue the Build Plan into the live UI

The build-plan consumer (`alp build --plan` → `BuildPlanView`) is useful but only
exists in the dead AppShell. Make it live:

- New `BuildPlanPanel` (`WebviewPanel`, like `configuratorPanel.ts`) that renders
  `App.tsx` with a new `ALP_MODE = "build-plan"` and owns the
  `requestBuildPlan`/`buildPlanData` + materialise/run messages (move them off the
  orphan `provider.ts`).
- Command **`alp.showBuildPlan`** + a **"Preview Build Plan"** item in the Build &
  Flash tree (`src/views/build.ts`) that opens it.
- Net: the build-plan view + its actions become reachable, as a webview _only_
  for the visual plan (contract-aligned).

### A — Status Bar as an action surface

`src/statusBar.ts` is read-only today. Add:

- A **build-target** item — `$(circuit-board) <sku>` from the active board.yaml;
  click → open the Build Plan (or Configurator).
- **Build** / **Flash** status-bar items (`$(play)` / `$(zap)`) → `alp.westBuild`
  / `alp.westFlash`. Always-visible, one-click, matches the language/env-picker
  pattern.

### B — Native onboarding Walkthrough

Add `contributes.walkthroughs`: a checklist (Install SDK → Bootstrap → Open/Create
project → Build) wired to the existing commands. Replaces the `openSetupFlow`
webview wizard (anti-pattern) with the native, progress-tracked experience. Keep
the command as a fallback during transition.

### C — Configurator as a CustomTextEditor

Register the configurator webview as a **`CustomTextEditor`** for `board.yaml`
(`contributes.customEditors`) so opening a `board.yaml` _is_ the visual editor,
with native dirty/save/undo — instead of a separate command-opened panel. (Keep
the command as an alternate entry.)

### Cleanup — retire the orphan AppShell

Remove the dead `alp-ide.panel` provider + the `App.tsx` "sidebar" AppShell branch
+ the tab-only components (the in-AppShell `SetupView`/`ProjectView`/`SdkView`/
`QuickActionsView`/`WestWorkspacesView`/`BuildBar`/tab iconography) that the
native trees supersede. Keep the panel-mode views (configurator, hardware-explorer,
build-plan, the flows). Net: less dead code, one source of truth per surface.

## Sequencing & risk

R + A first (highest value, low risk, rescues shipped work). B + C next (bigger:
walkthrough manifest, custom-editor wiring). Cleanup last (deletion — do it once
R has re-homed the build-plan so nothing is lost). Each phase builds + tests
clean and is a separate commit; the native trees keep the shell working
throughout.

**Reused from the recent webview work:** foundation `styles.css`/`tokens.css`
(all panels), the `Icon` set + panel iconography, and the `alp-core::build_plan`
consumer + materialise/execute logic (re-homed by R).

## Sources

- VS Code UX — Webviews: <https://code.visualstudio.com/api/ux-guidelines/webviews>
- VS Code UX — Views: <https://code.visualstudio.com/api/ux-guidelines/views>
- VS Code UX — Status Bar: <https://code.visualstudio.com/api/ux-guidelines/status-bar>
- PlatformIO IDE for VSCode: <https://docs.platformio.org/en/latest/integration/ide/vscode.html>
- nRF Connect for VS Code: <https://nrfconnect.github.io/vscode-nrf-connect/index.html>
