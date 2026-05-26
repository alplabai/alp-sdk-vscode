# Auto-connect SDK — Design

**Date:** 2026-05-26
**Status:** Approved (design); spec under review
**Branch:** feat/dev-tools

## Goal

Eliminate the manual `alpSdk.path` step. When the extension can't find the Alp
SDK, it should **detect an existing local checkout** and offer to use it in one
click, and **fall back to cloning** the public `alplabai/alp-sdk` repo when none
exists — then point `alpSdk.path` at it. This removes the "NOT CONNECTED" dead
end that blocks the configurator, hardware explorer, and SDK status.

## Scope

This is the **anchor** sub-project of a larger "developer speedup" effort. Three
sibling areas were requested and are **queued as separate specs** (each gets its
own design → plan → build cycle so it stays testable in isolation):

1. Build/flash/debug ergonomics — auto-generate `tasks.json` + `launch.json`, a
   west-build problem matcher, status-bar Build/Flash buttons.
2. Toolchain bootstrap + doctor — detect/install python, west, Zephyr SDK with
   one-click fixes; an environment doctor.
3. Onboarding / project setup — smarter New Project flow, board.yaml from a SKU,
   sample scaffolding.

This spec covers **only** auto-connect SDK.

## Architecture

Follows the repo convention: hard logic is pure and unit-tested in
`@alp-sdk/core`; the VS Code layer is a thin adapter that does I/O and UI.

### Pure core — `@alp-sdk/core/sdkConnect/detect.ts`

- `candidateSdkPaths(workspaceRoot: string | null, homeDir: string): string[]`
  Returns an **ordered** list of absolute paths to probe (see Detection order).
  Pure: it only joins/normalizes strings.
- `isSdkRoot(hasFile: (relativePath: string) => boolean): boolean`
  Predicate deciding whether a directory is a valid SDK root. Takes an injected
  "does this relative file exist" function — **no filesystem access** — so it is
  fully unit-testable against fixture file-maps. A directory is a valid SDK root
  when it contains `metadata/sdk_version.yaml` (the catalogue source the
  extension actually reads via the existing `loadSdkCatalogue`).

### VS Code adapter — `src/sdkConnect/index.ts`

Glue only — no logic beyond orchestration:
- Probes `candidateSdkPaths(...)` with `fs.existsSync` + `isSdkRoot`.
- Drives the QuickPick / folder picker / notification UI.
- Runs `git clone` as a VS Code Task (visible terminal).
- Writes the setting and refreshes dependent views.
- Registers the `alp.connectSdk` command and the one-time activation prompt.

### Setting scope

The discovered path is written to **Global** settings
(`vscode.ConfigurationTarget.Global`), because a local checkout is a machine
location that should serve every workspace. (This intentionally differs from
`configuratorTheme`, which is Workspace-scoped.) A user can still override per
workspace by editing the setting manually.

## Detection order

`candidateSdkPaths` yields, in priority order; the first path that exists **and**
satisfies `isSdkRoot` wins:

1. The current `alpSdk.path` value, if set. (Valid → already connected; the
   command reports "already connected" and no-ops.)
2. Inside the workspace — the existing `scripts/alp_project.py` search is kept
   as-is and folded in here.
3. Workspace siblings: `<workspaceParent>/alp-sdk`, `<workspaceParent>/alp_sdk`.
4. Common dev roots under `<home>`: `Documents/GitHub/alp-sdk`,
   `GitHub/alp-sdk`, `src/alp-sdk`.

On the maintainer's machine this resolves at step 4
(`C:\Users\caner\Documents\GitHub\alp-sdk`).

## Command flow — `Alp: Connect SDK`

```
detect()  -> validRoots: string[]
  if validRoots.length >= 1:
      QuickPick(validRoots + ["Clone a fresh copy…"])
        pick a path      -> set alpSdk.path (Global), connected
        pick "Clone…"    -> clone flow
  else:
      confirm("No SDK found. Clone alplabai/alp-sdk?")
        -> folder picker (default = workspaceParent)
        -> if <dest>/alp-sdk already a valid root: use it (no re-clone)
        -> else: git clone https://github.com/alplabai/alp-sdk  (VS Code Task)
        -> on success: set alpSdk.path (Global) to the cloned folder
post-connect:
  - set context key alpSdk.sdkConnected = true
  - refresh project view
  - if a configurator panel is open, re-post render (now CONNECTED)
  - showInformationMessage("Alp SDK connected: <path>")
```

## UI surfaces

- **Command** `alp.connectSdk` — title "Alp: Connect SDK", category "Alp".
- **Context key** `alpSdk.sdkConnected` (boolean), set on activation and after a
  successful connect. Drives conditional UI.
- **Project view** — when `alpSdk.sdkConnected` is false, surface a "Connect SDK"
  action (in the Actions group / welcome) bound to `alp.connectSdk`.
- **Configurator NOT CONNECTED panel** — replace the text-only state with a real
  **Connect SDK** button that posts a `connectSdk` inbound message; the panel
  handler runs `vscode.commands.executeCommand("alp.connectSdk")`.
- **One-time prompt** — on activation, if not connected and the `globalState` key
  `alp.sdkConnectPromptDismissed` is unset, show a notification with actions
  **[Connect SDK] [Later] [Don't ask again]**. "Don't ask again" sets the flag;
  "Later" leaves it unset (asks again next session); "Connect SDK" runs the
  command. The prompt never appears once an SDK is connected.

## Error handling

- **git not installed** — detect missing `git`; show error with a link to
  https://git-scm.com/downloads. Do not attempt the clone.
- **clone fails** (network/auth/path) — the Task terminal stays open showing
  stderr; show a failure message; `alpSdk.path` is left unchanged.
- **chosen clone folder already contains a valid `alp-sdk`** — skip the clone and
  use the existing checkout (idempotent).
- **manually-set invalid path** — the existing `Alp: SDK status` already reports
  this; the connect command's step-1 check treats an invalid current path as
  "not connected" and proceeds with detection.

## Testing

- **Pure core (`node:test`):**
  - `candidateSdkPaths` — correct ordering and platform-independent path joining
    for representative `workspaceRoot` / `homeDir` inputs (incl. `null`
    workspace).
  - `isSdkRoot` — true only when `metadata/sdk_version.yaml` is present; false for
    near-misses (only `metadata/`, only `scripts/alp_project.py`, empty).
- **VS Code adapter** — thin; verified in the Extension Development Host per this
  repo's established practice (no jsdom / no vscode unit tests). Manual check:
  unset `alpSdk.path`, run the command, confirm detection finds the sibling
  checkout and the configurator flips to CONNECTED.

## Out of scope

- Cloning private/alternate remotes or auth handling (repo is public).
- `west init/update` or toolchain installation (covered by the queued
  bootstrap+doctor spec).
- Auto-updating an existing checkout (`git pull`).
