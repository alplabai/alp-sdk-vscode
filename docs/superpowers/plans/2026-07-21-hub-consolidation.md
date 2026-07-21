# Hub Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get status read-outs out of the action sidebar (into the status bar + Hub), surface the `tan` CLI next to `west`, rename the full-width Overview page to **Hub**, and fold the standalone SDK Manager panel into the Hub.

**Architecture:** The webview is one React bundle (`packages/alp-webview`) whose active view is chosen by `body[data-alp-mode]`, set per host panel via `buildWebviewHtml(webview, uri, mode)`. Extension state is one `AlpIdeState` produced by `queryAlpIdeState` and fanned out by `StateManager` to the status bar + sidebar webview. We add `tan` to that state, add a status-bar readiness item, thin the sidebar, and merge the SDK Manager host + React view into the Overview/Hub host + view.

**Tech Stack:** TypeScript 6 (strict, `noUnused*`), React 19 (CSS Modules), VS Code extension API, esbuild (ext) + Vite (webview), Node-native tests (`node --test`), pnpm workspace.

## Global Constraints

- Service layer stays pure: no `vscode`/`fs`/`child_process` in `*/service.ts`. All new `vscode`/`fs` code goes in adapters/panels/surface files.
- Protocol is hand-mirrored: any change to `src/ideHub/messages.ts` types is copied verbatim into `packages/alp-webview/src/types.ts`. `PROTOCOL_VERSION` stays `2` (additive optional field, read defensively).
- Brand name is "Alp", never "ALP", in every user-facing string.
- No `Co-Authored-By: Claude` / generated-by trailers in commits.
- `tan` version is INFO, never a readiness gate. Readiness = `pythonAvailable && westAvailable && sdk.readiness === "ready" && workspace.westInitialized`.
- **State refresh must NEVER trigger a `tan` network download.** The probe only reads an already-present binary.
- Run `pnpm run compile` before `pnpm test`. Prettier is the formatter (`pnpm run format`).
- Branch: `feat/status-out-of-sidebar` (already created off `dev`). Never commit to `dev` directly.

---

## Task 1: Add `tan` to the state model + a no-download probe

**Files:**
- Modify: `src/ideHub/messages.ts` (`ToolVersions`, `emptyAlpIdeState`)
- Modify: `packages/alp-webview/src/types.ts` (`ToolVersions` mirror)
- Modify: `src/alpCli/vscodeAdapter.ts` (new `probeTanVersion`)
- Modify: `src/ideHub/vscodeAdapter.ts` (`queryAlpIdeState` gains optional `context`, collects `tan`)
- Modify: `src/views/stateManager.ts` (holds + forwards `context`)
- Modify: `src/extension.ts` (pass `context` to `new StateManager`)
- Test: `test/ideHub.state.test.js` (new or existing state test file)

**Interfaces:**
- Produces: `ToolVersions.tan: string | null`; `probeTanVersion(context: vscode.ExtensionContext): Promise<string | null>`; `queryAlpIdeState(lastBootstrapAt?: string | null, context?: vscode.ExtensionContext): Promise<AlpIdeState>`; `new StateManager(context: vscode.ExtensionContext)`.
- Consumes: `decideBinarySource` (from `./service`), `resolveAlpBinary` (from `./adapterCore`), `buildResolveDeps` (private, same file), `parseTanVersion` (from `./service`).

- [ ] **Step 1: Write the failing test** — `test/ideHub.state.test.js`

```js
const test = require("node:test");
const assert = require("node:assert");
const { emptyAlpIdeState } = require("../out/ideHub/messages.js");

test("emptyAlpIdeState seeds tan as null", () => {
  const s = emptyAlpIdeState();
  assert.strictEqual(s.setup.toolVersions.tan, null);
  assert.ok("tan" in s.setup.toolVersions);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run compile && node --test test/ideHub.state.test.js`
Expected: FAIL — `tan` not present on `toolVersions` (undefined, not null).

- [ ] **Step 3: Add `tan` to the type + default** — `src/ideHub/messages.ts`

In `interface ToolVersions` add the field:

```ts
export interface ToolVersions {
  python: string | null;
  west: string | null;
  tan: string | null;
  cmake: string | null;
  ninja: string | null;
}
```

In `emptyAlpIdeState()` update the default:

```ts
      toolVersions: { python: null, west: null, tan: null, cmake: null, ninja: null },
```

- [ ] **Step 4: Mirror the field in the webview types** — `packages/alp-webview/src/types.ts`

```ts
export interface ToolVersions {
  python: string | null;
  west: string | null;
  tan: string | null;
  cmake: string | null;
  ninja: string | null;
}
```

- [ ] **Step 5: Add the no-download probe** — `src/alpCli/vscodeAdapter.ts`

Import `parseTanVersion` and `resolveAlpBinary`, plus `execFile` for the version spawn. Add near `resolveAlpBinaryForContext`:

```ts
import { promisify } from "util";
import { execFile } from "child_process";
const execFileAsyncCli = promisify(execFile);

/**
 * The installed native `tan` version, or null — WITHOUT ever downloading.
 * Called from state refresh (focus/save/settings), so it must never fetch: if
 * nothing resolves locally (`decideBinarySource === "download"`) it returns
 * null immediately. Otherwise it resolves the already-present binary (no
 * download in a non-download branch) and parses `tan --version`; a non-native
 * `tan` on PATH parses to null (parseTanVersion guards the shape).
 */
export async function probeTanVersion(
  context: vscode.ExtensionContext,
): Promise<string | null> {
  const deps = buildResolveDeps(context);
  const input: BinaryResolutionInput = {
    cliPathSetting: deps.cliPathSetting,
    cliPathExists:
      Boolean(deps.cliPathSetting) && deps.fileExists(deps.cliPathSetting),
    onPath: deps.commandOnPath("tan"),
    bundledExists: deps.bundledExists,
    localBuildExists: Boolean(deps.localBuildBinaryPath),
    cachedExists: deps.fileExists(deps.cachedBinaryPath),
  };
  if (decideBinarySource(input) === "download") return null;
  try {
    const bin = await resolveAlpBinary(deps);
    const { stdout } = await execFileAsyncCli(bin.command, ["--version"], {
      timeout: 3000,
    });
    return parseTanVersion(stdout);
  } catch {
    return null;
  }
}
```

(`decideBinarySource` from `./service`, `resolveAlpBinary` from `./adapterCore`, `parseTanVersion` from `./service`, `BinaryResolutionInput` already imported from `./models`. If `resolveAlpBinary` needs different deps than `buildResolveDeps` returns, reuse the exact same `deps` object `resolveAlpBinaryForContext` passes it.)

- [ ] **Step 6: Collect `tan` in the state adapter** — `src/ideHub/vscodeAdapter.ts`

Change the signature and add the probe. Import `probeTanVersion` from `../alpCli/vscodeAdapter`:

```ts
export async function queryAlpIdeState(
  lastBootstrapAt: string | null = null,
  context?: vscode.ExtensionContext,
): Promise<AlpIdeState> {
```

Add `tan` to the parallel probe batch (it does not use `probeEnv`; it resolves its own binary). After the existing `Promise.all` for python/west/cmake/ninja:

```ts
  const tanVersion = context ? await probeTanVersion(context) : null;
```

And include it in the returned `toolVersions`:

```ts
      toolVersions: {
        python: pythonVersion,
        west: westVersion,
        tan: tanVersion,
        cmake: cmakeVersion,
        ninja: ninjaVersion,
      },
```

- [ ] **Step 7: Thread `context` through `StateManager`** — `src/views/stateManager.ts`

```ts
export class StateManager implements vscode.Disposable {
  private _state: AlpIdeState = emptyAlpIdeState();
  private readonly _emitter = new vscode.EventEmitter<AlpIdeState>();
  readonly onStateChange = this._emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get state(): AlpIdeState {
    return this._state;
  }

  async refresh(lastBootstrapAt: string | null = null): Promise<void> {
    this._state = await queryAlpIdeState(lastBootstrapAt, this.context).catch(
      (err) => {
        log(`Alp IDE state refresh failed; showing empty state: ${err}`);
        return emptyAlpIdeState();
      },
    );
    this._emitter.fire(this._state);
  }

  dispose(): void {
    this._emitter.dispose();
  }
}
```

- [ ] **Step 8: Pass `context` at the `StateManager` construction site** — `src/extension.ts`

Find `new StateManager(` and pass `context`:

```ts
  const stateMgr = new StateManager(context);
```

(Also pass `context` to any other `queryAlpIdeState(...)` caller that has one — `overviewPanel.ts`, `hubViewProvider.ts` — so their webviews get `tan` too. Grep `queryAlpIdeState(` and add `, context` / `, this.context`.)

- [ ] **Step 9: Run tests + compile**

Run: `pnpm run compile && node --test test/ideHub.state.test.js`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/ideHub/messages.ts packages/alp-webview/src/types.ts src/alpCli/vscodeAdapter.ts src/ideHub/vscodeAdapter.ts src/views/stateManager.ts src/extension.ts test/ideHub.state.test.js
git commit -m "feat(state): surface the tan CLI version via a no-download probe"
```

---

## Task 2: Status-bar env-readiness item

**Files:**
- Create: `packages/alp-core/src/statusReadiness/service.ts` (pure presentation) — OR co-locate a pure helper in `src/statusBar.ts` if a package export is heavier than warranted; prefer the pure `@alp-sdk/core` seam so it's unit-testable like `createStatusBarPresentation`.
- Modify: `src/statusBar.ts` (render the item)
- Test: `test/statusReadiness.test.js`

**Interfaces:**
- Produces: `envReadinessPresentation(state: AlpIdeState): { ready: boolean; text: string; tooltip: string }`.
- Consumes: `AlpIdeState` from Task 1 (with `toolVersions.tan`).

- [ ] **Step 1: Write the failing test** — `test/statusReadiness.test.js`

```js
const test = require("node:test");
const assert = require("node:assert");
const {
  envReadinessPresentation,
} = require("../packages/alp-core/dist/statusReadiness/service.js");

const base = {
  sdk: { activePath: "/x", version: "0.6.0", readiness: "ready", localEntries: [] },
  setup: {
    pythonAvailable: true,
    westAvailable: true,
    lastBootstrapAt: null,
    toolVersions: { python: "3.12", west: "1.2", tan: "0.1.0", cmake: null, ninja: null },
  },
  workspace: { workspaceRoot: "/w", boardYamlExists: true, westInitialized: true },
};

test("all ready → check + full tooltip", () => {
  const p = envReadinessPresentation(base);
  assert.strictEqual(p.ready, true);
  assert.match(p.text, /Alp/);
  assert.match(p.tooltip, /tan 0\.1\.0/);
  assert.match(p.tooltip, /Alp SDK v0\.6\.0/);
});

test("missing west → not ready + warning", () => {
  const s = JSON.parse(JSON.stringify(base));
  s.setup.westAvailable = false;
  s.setup.toolVersions.west = null;
  const p = envReadinessPresentation(s);
  assert.strictEqual(p.ready, false);
  assert.match(p.text, /setup/i);
  assert.match(p.tooltip, /west .*(not found|—)/i);
});

test("tan absent → managed marker, still not gating", () => {
  const s = JSON.parse(JSON.stringify(base));
  s.setup.toolVersions.tan = null;
  const p = envReadinessPresentation(s);
  assert.strictEqual(p.ready, true); // tan does not gate
  assert.match(p.tooltip, /tan managed/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run compile && node --test test/statusReadiness.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the pure presentation** — `packages/alp-core/src/statusReadiness/service.ts`

```ts
// SPDX-License-Identifier: Apache-2.0
import type { AlpIdeState } from "../../../..//src/ideHub/messages"; // if a shared AlpIdeState type is not available in core, define a minimal structural type here instead.

type ReadinessState = {
  setup: {
    pythonAvailable: boolean;
    westAvailable: boolean;
    toolVersions: { python: string | null; west: string | null; tan: string | null };
  };
  sdk: { version: string | null; readiness: string };
  workspace: { westInitialized: boolean };
};

export function envReadinessPresentation(state: ReadinessState): {
  ready: boolean;
  text: string;
  tooltip: string;
} {
  const { pythonAvailable, westAvailable, toolVersions } = state.setup;
  const ready =
    pythonAvailable &&
    westAvailable &&
    state.sdk.readiness === "ready" &&
    state.workspace.westInitialized;

  const v = (x: string | null, fallback = "not found") => x ?? fallback;
  const tan = toolVersions.tan ? `tan ${toolVersions.tan}` : "tan managed";
  const sdk = state.sdk.version ? `Alp SDK v${state.sdk.version}` : "Alp SDK not installed";
  const ws = state.workspace.westInitialized ? "Workspace: Initialized" : "Workspace: Not initialized";
  const tooltip = [
    `Python ${v(toolVersions.python)}`,
    `west ${v(toolVersions.west)}`,
    tan,
    sdk,
    ws,
  ].join("\n");

  return {
    ready,
    text: ready ? "$(check) Alp" : "$(warning) Alp: setup",
    tooltip,
  };
}
```

(Do NOT couple core to `src/ideHub`. Use the local structural `ReadinessState` type above; delete the speculative import line. Add the subpath to `packages/alp-core` `exports` map: `"./statusReadiness/service": "./dist/statusReadiness/service.js"`.)

- [ ] **Step 4: Render the item** — `src/statusBar.ts`

Add a fifth item (priority `102`) and render it in `render()`:

```ts
import { envReadinessPresentation } from "@alp-sdk/core/statusReadiness/service";
```

In `createStatusBar`, before the `sdk` item:

```ts
  const env = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    102,
  );
  env.command = "alp.openHub";
```

In `render(...)`, add `env` as the first parameter and:

```ts
  const envP = envReadinessPresentation(state);
  env.text = envP.text;
  env.tooltip = envP.tooltip;
  env.show();
```

Thread `env` through the `render(...)` signature, the initial `render(...)` call, the `onStateChange` handler, and `vscode.Disposable.from(env, sdk, target, build, flash, sub)`.

- [ ] **Step 5: Run tests + compile**

Run: `pnpm run compile && node --test test/statusReadiness.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/alp-core/src/statusReadiness/service.ts packages/alp-core/package.json src/statusBar.ts test/statusReadiness.test.js
git commit -m "feat(statusbar): add an Alp env-readiness item (glance + tooltip, opens Hub)"
```

---

## Task 3: Overview/Hub Environment card shows `tan`

**Files:**
- Modify: `packages/alp-webview/src/features/overview/OverviewView.tsx` (`envMeta`)
- Test: `test/webview/overviewEnvMeta.test.tsx` (or extend the existing webview render test)

**Interfaces:**
- Consumes: `AlpIdeState.setup.toolVersions.tan` (Task 1 mirror).

- [ ] **Step 1: Write the failing test** — `test/webview/overviewEnvMeta.test.tsx`

If `envMeta` is not exported, export it from `OverviewView.tsx` (`export function envMeta`). Test:

```tsx
import test from "node:test";
import assert from "node:assert";
import { envMeta } from "../../packages/alp-webview/src/features/overview/OverviewView";

test("envMeta includes tan when all tools present", () => {
  const state = {
    setup: { pythonAvailable: true, westAvailable: true, toolVersions: { python: "3.12", west: "1.2", tan: "0.1.0", cmake: null, ninja: null } },
  } as any;
  assert.match(envMeta(state), /tan 0\.1\.0/);
  assert.match(envMeta(state), /Python 3\.12/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run compile && node --test test/webview/overviewEnvMeta.test.tsx` (match the repo's existing tsx test runner invocation; mirror how `test/webview/ui-render.tsx` is run).
Expected: FAIL — `tan` not in the meta string.

- [ ] **Step 3: Add `tan` to the "all available" branch** — `OverviewView.tsx`

```ts
  if (pythonAvailable && westAvailable) {
    const parts: string[] = [];
    if (toolVersions.python) parts.push(`Python ${toolVersions.python}`);
    if (toolVersions.west) parts.push(`west ${toolVersions.west}`);
    parts.push(toolVersions.tan ? `tan ${toolVersions.tan}` : "tan managed");
    return parts.join(" · ") || "All tools available";
  }
```

(Leave the "Missing: …" branch untouched — `tan` is not a gate, so it never appears in "missing".)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run compile && node --test test/webview/overviewEnvMeta.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/alp-webview/src/features/overview/OverviewView.tsx test/webview/overviewEnvMeta.test.tsx
git commit -m "feat(hub): show the tan CLI version in the Environment card"
```

---

## Task 4: Strip the five status rows from the sidebar

**Files:**
- Modify: `packages/alp-webview/src/features/sidebar-hub/SidebarHubView.tsx`
- Test: extend `test/webview/ui-render.tsx` (assert no status dots in Setup; "Finish setup" toggles)

**Interfaces:**
- Consumes: `alp.openHub` (registered in Task 6; until then it maps through `alp.openOverview`). Use `alp.openHub` in the label so the final wiring is correct; Task 6 registers it. If executed before Task 6, the alias in Task 6 keeps `alp.openOverview` valid — but prefer ordering Task 6 before this task's manual smoke.

- [ ] **Step 1: Write the failing render assertion** — in `test/webview/ui-render.tsx`

Add to the sidebar-hub render case:

```tsx
assert.doesNotMatch(html, /data-health=/); // no status dots remain
assert.match(html, /Hub/); // Overview link relabeled
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm run compile && node --test test/webview/ui-render.tsx`
Expected: FAIL — `data-health=` dots still present.

- [ ] **Step 3: Replace the Setup section** — `SidebarHubView.tsx`

Replace the entire `<Section title="Setup"> … </Section>` (lines ~197–249) with:

```tsx
      <Section title="Setup">
        <ActionRow
          icon="book"
          label="Hub"
          desc="Open the full-width hub"
          command="alp.openHub"
        />
        {!ready && (
          <ActionRow
            icon="wrench"
            label="Finish setup"
            desc="Run the setup wizard"
            command="alp.openSetupFlow"
          />
        )}
      </Section>
```

Add the `ready` computation near the existing derived values (mirror `isAllReady`), and drop the now-unused `toolsReady` and `setup` destructure:

```tsx
  const { sdk, workspace } = state;
  const ready =
    state.setup.pythonAvailable &&
    state.setup.westAvailable &&
    sdk.readiness === "ready" &&
    workspace.westInitialized;
```

(Keep `wsName`, `buildReady`, `sdkValue`, and the Workspace / Project / SDK Manager / Build & Flash sections exactly as they are. The SDK Manager section's `alp.openSdkManager` targets are unchanged here — Task 6 repoints that command to the Hub.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm run compile && node --test test/webview/ui-render.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/alp-webview/src/features/sidebar-hub/SidebarHubView.tsx test/webview/ui-render.tsx
git commit -m "feat(sidebar): drop status read-outs; Setup is Hub + conditional Finish setup"
```

---

## Task 5: Extract the SDK message handlers into a shared module

**Files:**
- Create: `src/ideHub/sdkManagerMessages.ts`
- Modify: `src/ideHub/sdkManagerPanel.ts` (delegate to the new module — temporary, retired in Task 6)
- Test: none new (behavior-preserving move; existing SDK coverage stays green). If the repo lacks any SdkManagerPanel test, this move is verified by Task 6's manual smoke.

**Interfaces:**
- Produces: `createSdkMessageHandler(deps: SdkHandlerDeps): (msg: WebviewToExtMessage) => boolean` — returns `true` when it handled the message, `false` otherwise (so the host handles `ready`/`runCommand`/`openUrl`/`closePanel` itself). `SdkHandlerDeps = { context: vscode.ExtensionContext; post: (msg: ExtToWebviewMessage) => void; refresh: () => Promise<void> }`.

- [ ] **Step 1: Create the module** — move the six handler bodies verbatim from `sdkManagerPanel.ts` (`handleSelectSdkPath`, `handleRequestSdkReleases`, `handleRequestSdkInstall`, `handleSwitchSdk`, `handleUninstallSdk`, `handleDeactivateSdk`) into free functions that take `deps`. **The `handleUninstallSdk` body — the modal warning confirm, the Alp-managed-path check via `sdkCacheRoot()`, `fs.rmSync(target, { recursive: true, force: true })`, and the active-pointer clear — moves byte-for-byte. Do not simplify or drop the confirmation.** Replace `this.panel.webview.postMessage(...)` with `deps.post(...)`, `this.refresh()` with `deps.refresh()`, `this.context` with `deps.context`.

```ts
// SPDX-License-Identifier: Apache-2.0
import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import type { SdkInstallAdapter } from "@alp-sdk/core/sdk/adapterCore";
import type { SdkRelease } from "@alp-sdk/core/sdk/models";
import { installSdkRelease } from "@alp-sdk/core/sdk/service";
import { runAlpCommand } from "../alpCli/vscodeAdapter";
import { clearActiveSdk, setActiveSdk } from "../sdk/activeSdk";
import { writeAlpSetting } from "../sdk/settingsWrite";
import type { ExtToWebviewMessage, WebviewToExtMessage } from "./messages";
import { sdkCacheRoot } from "./vscodeAdapter";

export interface SdkHandlerDeps {
  context: vscode.ExtensionContext;
  post: (msg: ExtToWebviewMessage) => void;
  refresh: () => Promise<void>;
}

export function createSdkMessageHandler(deps: SdkHandlerDeps) {
  // ... move handleSelectSdkPath / handleSwitchSdk / handleUninstallSdk /
  // handleDeactivateSdk / handleRequestSdkReleases / handleRequestSdkInstall
  // here as closures over `deps`, verbatim from sdkManagerPanel.ts ...

  return (msg: WebviewToExtMessage): boolean => {
    switch (msg.type) {
      case "selectSdkPath": void handleSelectSdkPath(); return true;
      case "requestSdkReleases": void handleRequestSdkReleases(); return true;
      case "requestSdkInstall": void handleRequestSdkInstall(msg.version); return true;
      case "switchSdk": void handleSwitchSdk(msg.sdkPath); return true;
      case "uninstallSdk": void handleUninstallSdk(msg.sdkPath); return true;
      case "deactivateSdk": void handleDeactivateSdk(); return true;
      default: return false;
    }
  };
}
```

- [ ] **Step 2: Delegate from `SdkManagerPanel`** (temporary) — construct `createSdkMessageHandler({ context, post: (m) => this.panel.webview.postMessage(m), refresh: () => this.refresh() })` and call it first in `handleMessage`; if it returns `false`, fall through to the existing `ready`/`runCommand`/`openUrl` cases.

- [ ] **Step 3: Compile**

Run: `pnpm run compile`
Expected: clean (no unused, no type errors).

- [ ] **Step 4: Commit**

```bash
git add src/ideHub/sdkManagerMessages.ts src/ideHub/sdkManagerPanel.ts
git commit -m "refactor(sdk): extract SDK webview message handlers into a shared module"
```

---

## Task 6: Fold SDK Manager into the Hub host; rename the command

**Files:**
- Modify: `src/ideHub/overviewPanel.ts` (SDK message cases + `open(context, focus?)`)
- Modify: `src/extension.ts` (`alp.openHub` + alias + repoint `alp.openSdkManager`; drop `SdkManagerPanel`)
- Delete: `src/ideHub/sdkManagerPanel.ts`; Modify: `src/ideHub/index.ts` (drop the export)
- Modify: `package.json` (`contributes.commands`: id `alp.openOverview`→`alp.openHub`, title "…Hub"; add hidden alias command; walkthrough `command:alp.openOverview` links)
- Modify: `src/ideHub/webviewHtml.ts` (allowlist: add `alp.openHub`, keep `alp.openOverview`)
- Modify: `src/views/setup.ts` (dead e2e provider: update `alp.openOverview` ref)
- Test: manual smoke (webview panels) + `pnpm test` regression

**Interfaces:**
- Consumes: `createSdkMessageHandler` (Task 5).
- Produces: command `alp.openHub`; `OverviewPanel.open(context, focus?: "sdk")`.

- [ ] **Step 1: OverviewPanel gains the SDK handler** — `src/ideHub/overviewPanel.ts`

In the constructor, build the handler and try it first in `handleMessage`:

```ts
  private readonly sdkHandler = createSdkMessageHandler({
    context: this.context,
    post: (m) => void this.panel.webview.postMessage(m),
    refresh: () => this.refresh(),
  });
```

```ts
  private handleMessage(msg: WebviewToExtMessage): void {
    if (this.sdkHandler(msg)) return;
    switch (msg.type) {
      case "ready": void this.refresh(); break;
      case "runCommand": /* unchanged */ break;
      case "openUrl": /* unchanged */ break;
      case "closePanel": this.panel.dispose(); break;
    }
  }
```

Add focus support to `open`:

```ts
  static open(context: vscode.ExtensionContext, focus?: "sdk"): void {
    if (OverviewPanel.instance) {
      OverviewPanel.instance.panel.reveal(vscode.ViewColumn.One);
    } else {
      OverviewPanel.instance = new OverviewPanel(context);
    }
    if (focus === "sdk") {
      void OverviewPanel.instance.panel.webview.postMessage({ type: "focusSection", section: "sdk" } as any);
    }
  }
```

(Add a `FocusSectionMessage { type: "focusSection"; section: "sdk" }` to `ExtToWebviewMessage` in both `messages.ts` and `types.ts`; the Hub view scroll is wired in Task 7. Until Task 7 consumes it, the message is a harmless no-op.)

- [ ] **Step 2: Rewire commands** — `src/extension.ts`

```ts
    vscode.commands.registerCommand("alp.openHub", () => OverviewPanel.open(context)),
    // Deprecated alias — keep old keybindings/links working.
    vscode.commands.registerCommand("alp.openOverview", () => OverviewPanel.open(context)),
    vscode.commands.registerCommand("alp.openSdkManager", () => OverviewPanel.open(context, "sdk")),
```

Remove the `SdkManagerPanel` import and its old `alp.openSdkManager` → `SdkManagerPanel.open` registration.

- [ ] **Step 3: Delete the standalone panel** — remove `src/ideHub/sdkManagerPanel.ts` and its `export { SdkManagerPanel }` line in `src/ideHub/index.ts`. Grep `SdkManagerPanel` to confirm no remaining refs (except `test/e2e` — update those to open the Hub).

- [ ] **Step 4: package.json** — set the command id to `alp.openHub` with title "Alp: Open Hub"; add a `alp.openOverview` command entry (title "Alp: Open Overview (deprecated)") or leave it undeclared as a plain alias (declared is cleaner for the palette). Update any walkthrough step `command:alp.openOverview` → `command:alp.openHub`.

- [ ] **Step 5: webviewHtml allowlist** — `src/ideHub/webviewHtml.ts`: add `"alp.openHub"` to the `runWebviewCommand` allowlist array (keep `"alp.openOverview"`, `"alp.openSdkManager"`).

- [ ] **Step 6: Compile + full test suite**

Run: `pnpm run compile && pnpm test`
Expected: PASS (no unused `SdkManagerPanel`, all suites green).

- [ ] **Step 7: Manual smoke** — `pnpm run install:vscode`, then: command palette → "Alp: Open Hub" opens the Hub; "Alp: Open Overview" still opens it; the sidebar "Manage SDKs" opens the Hub (SDK section wired in Task 7).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(hub): fold SDK Manager into the Hub; rename alp.openOverview → alp.openHub (alias kept)"
```

---

## Task 7: Render the SDK Manager as a Hub section

**Files:**
- Modify: `packages/alp-webview/src/features/overview/OverviewView.tsx` (render `<SdkView>` section, subtitle "Hub", focus-scroll anchor)
- Modify: `packages/alp-webview/src/types.ts` (`FocusSectionMessage` mirror)
- Modify: `packages/alp-webview/src/shared/AppContext` message handling (consume `focusSection` → scroll)
- Test: extend `test/webview/ui-render.tsx` (overview mode renders an element with `id="sdk-section"` and the SDK view)

**Interfaces:**
- Consumes: `SdkView` from `../sdk`; `focusSection` message (Task 6).

- [ ] **Step 1: Failing render assertion** — in `test/webview/ui-render.tsx`, overview case:

```tsx
assert.match(html, /id="sdk-section"/);
assert.match(html, /Hub/); // subtitle
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm run compile && node --test test/webview/ui-render.tsx`
Expected: FAIL.

- [ ] **Step 3: Render the section + rename subtitle** — `OverviewView.tsx`

Change `<Brand subtitle="Alp IDE" />`? No — keep the brand; add the SDK section and rename the page's own heading usage from "Overview" to "Hub" wherever the word is user-visible. After the Quick Actions `<section>`:

```tsx
        <section aria-labelledby="sdk-heading" id="sdk-section">
          <p id="sdk-heading" className={styles.sectionLabel}>
            SDK Manager
          </p>
          <SdkView />
        </section>
```

Import `SdkView` from `../sdk`. If `SdkView` assumes a full-page wrapper (its own `Brand`/root padding), render its inner content component instead, or pass a prop to suppress the page chrome — inspect `packages/alp-webview/src/features/sdk` and reuse the list/install pieces without a second `<Brand>`.

- [ ] **Step 4: Consume `focusSection`** — in the webview message listener (`shared/AppContext` or `vscode` message plumbing), on `{ type: "focusSection", section: "sdk" }` call `document.getElementById("sdk-section")?.scrollIntoView({ behavior: "smooth" })`. Add `FocusSectionMessage` to the `ExtToWebviewMessage` union in `types.ts`.

- [ ] **Step 5: Run to verify pass**

Run: `pnpm run compile && node --test test/webview/ui-render.tsx`
Expected: PASS.

- [ ] **Step 6: Manual smoke** — `pnpm run install:vscode`; sidebar "Manage SDKs" → Hub opens and scrolls to the SDK section; install/switch/uninstall/deactivate all work from there; **uninstall shows the modal confirm and only deletes on confirm.**

- [ ] **Step 7: Commit**

```bash
git add packages/alp-webview/src/features/overview/OverviewView.tsx packages/alp-webview/src/types.ts packages/alp-webview/src/shared test/webview/ui-render.tsx
git commit -m "feat(hub): render SDK Manager as a Hub section with focus-scroll"
```

---

## Task 8: Full gate + PR

- [ ] **Step 1: Format + full gates**

Run: `pnpm run format && pnpm run compile && pnpm test && pnpm run package`
Expected: all green; `.vsix` builds.

- [ ] **Step 2: Reviewer pass** — dispatch `alp-reviewer` on the branch diff (pnpm gates + CLI-envelope lens). Focus: Task 1 no-download probe, Task 5/6 the `fs.rmSync` uninstall confirm survived the move, protocol mirror sync.

- [ ] **Step 3: Open PR**

```bash
git push -u origin feat/status-out-of-sidebar
gh pr create --base dev --title "Hub consolidation: status out of the sidebar, Overview→Hub, SDK Manager folded in" --body "Implements docs/superpowers/specs/2026-07-21-status-out-of-sidebar-design.md"
```

---

## Self-Review

**Spec coverage:** Part A goals → Tasks 1–3; Part B → Task 4; Part C (rename + fold) → Tasks 5–7. `tan` info-not-gating → asserted in Task 2 test. No-download probe → Task 1 Step 5 + Task 8 review. Out-of-scope dupes → untouched (tracked in memory).

**Placeholder scan:** the two genuine integration checks flagged inline (Task 2 core `AlpIdeState` structural type; Task 7 `SdkView` page-chrome inspection) are verification instructions with concrete fallbacks, not "TBD". No "add error handling"/"write tests for the above" left.

**Type consistency:** `probeTanVersion(context)` (Task 1) consumed nowhere else; `envReadinessPresentation` (Task 2) name stable; `createSdkMessageHandler`/`SdkHandlerDeps` (Task 5) consumed in Task 6; `focusSection`/`FocusSectionMessage` introduced Task 6, consumed Task 7 — matched.
