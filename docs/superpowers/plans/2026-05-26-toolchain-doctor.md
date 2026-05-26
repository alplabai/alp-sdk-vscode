# Toolchain Bootstrap + Doctor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A `Alp: Toolchain doctor` command that probes the Zephyr build toolchain, analyzes it in tested pure core, reports it in the output channel + a webview panel, and offers non-destructive one-click fixes.

**Architecture:** Pure, tested core in `@alp-sdk/core/toolchain/*` (`analyzeToolchain`, `planForHost`/`fixCommand`, panel HTML). Thin VS Code adapter probes the env (`execFileSync`, env vars) and renders. `bootstrap.ts` and `sdkStatus.ts` are refactored to reuse the moved logic.

**Tech Stack:** TypeScript, VS Code API (commands, webview, terminal, output channel), pnpm workspace, `node:test`.

**Spec:** `docs/superpowers/specs/2026-05-26-toolchain-doctor-design.md`

---

## Background the implementer needs

- **Build:** `pnpm run compile` before tests. **Tests:** `node --test test/*.test.js` (currently 193/193 — keep green).
- Core imported as `@alp-sdk/core/<area>/<file>` (compiles to `packages/alp-core/dist`).
- **Branch:** `feat/dev-tools`. **No `Co-Authored-By` trailer.** Brand "Alp" not "ALP".
- **Patterns to mirror:**
  - Webview shell + panel: `src/configuratorPanel.ts` (createWebviewPanel, nonce HTML, onDidReceiveMessage, postMessage) and `@alp-sdk/core/configurator/panelHtml.ts`.
  - Probe helper currently in `src/sdkStatus.ts`: `probe(cmd,args)` using `execFileSync(..., {encoding:"utf-8", timeout:4000})`, returns `{ok, value}`.
  - `src/bootstrap.ts` currently has `planForHost(host, os)` inline — Task 1 moves it to core verbatim.

## File Structure

**Create (core):** `packages/alp-core/src/toolchain/bootstrapPlan.ts`, `.../doctor.ts`, `.../doctorHtml.ts`.
**Create (adapter):** `src/toolchain/vscodeAdapter.ts`, `src/toolchain/doctorPanel.ts`, `src/toolchain.ts`.
**Create (media):** `media/toolchainDoctor.js`, `media/toolchainDoctor.css`.
**Create (tests):** `test/toolchain.bootstrapPlan.test.js`, `test/toolchain.doctor.test.js`.
**Modify:** `src/bootstrap.ts`, `src/sdkStatus.ts`, `src/extension.ts`, `package.json`.

---

### Task 1: Core — bootstrap plan + fix mapping

**Files:** Create `packages/alp-core/src/toolchain/bootstrapPlan.ts`, `test/toolchain.bootstrapPlan.test.js`.

- [ ] **Step 1: Write the failing test** — `test/toolchain.bootstrapPlan.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { planForHost, fixCommand } = require("@alp-sdk/core/toolchain/bootstrapPlan");

test("planForHost zephyr/win32 installs python deps + west", () => {
  const plan = planForHost("win32", "zephyr");
  assert.match(plan.title, /Zephyr/);
  assert.equal(plan.steps.length, 2);
  assert.match(plan.steps[0].command, /pip install --user pyyaml jsonschema/);
  assert.match(plan.steps[1].command, /pip install --user west/);
  assert.ok(plan.pointers.some((p) => /zephyr/i.test(p.url)));
});

test("planForHost yocto/linux uses apt; darwin warns linux-only", () => {
  assert.match(planForHost("linux", "yocto").steps[1].command, /apt-get install/);
  assert.match(planForHost("darwin", "yocto").steps[1].description, /Linux-only/);
});

test("planForHost baremetal lists vendor pointers", () => {
  const plan = planForHost("linux", "baremetal");
  assert.equal(plan.steps.length, 1);
  assert.ok(plan.pointers.some((p) => /alif|renesas|nxp/i.test(p.name)));
});

test("fixCommand maps fixIds to a command or pointer", () => {
  assert.equal(fixCommand("python-deps", "linux").kind, "command");
  assert.match(fixCommand("python-deps", "linux").step.command, /pyyaml jsonschema/);
  assert.equal(fixCommand("west", "win32").kind, "command");
  assert.match(fixCommand("west", "win32").step.command, /pip install --user west/);
  assert.equal(fixCommand("build-tools", "linux").kind, "pointer");
  assert.equal(fixCommand("zephyr-sdk", "linux").kind, "pointer");
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm run compile && node --test test/toolchain.bootstrapPlan.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement** — Create `packages/alp-core/src/toolchain/bootstrapPlan.ts`:

```ts
// SPDX-License-Identifier: Apache-2.0

export type BootstrapHost = "linux" | "darwin" | "win32";
export type BootstrapOs = "zephyr" | "yocto" | "baremetal";
export type ToolchainFixId = "python-deps" | "west" | "build-tools" | "zephyr-sdk";

export interface BootstrapStep {
  description: string;
  command: string;
}
export interface BootstrapPointer {
  name: string;
  url: string;
}
export interface BootstrapPlan {
  title: string;
  steps: BootstrapStep[];
  pointers: BootstrapPointer[];
}

const ZEPHYR_GETTING_STARTED: BootstrapPointer = {
  name: "Zephyr getting started guide",
  url: "https://docs.zephyrproject.org/latest/develop/getting_started/index.html",
};
const ZEPHYR_SDK_INSTALLER: BootstrapPointer = {
  name: "Zephyr SDK installer",
  url: "https://docs.zephyrproject.org/latest/develop/toolchains/zephyr_sdk.html",
};

function pythonDepsStep(host: BootstrapHost): BootstrapStep {
  return host === "win32"
    ? { description: "Install loader Python deps (pip)", command: "python -m pip install --user pyyaml jsonschema" }
    : { description: "Install loader Python deps (pip3)", command: "pip3 install --user pyyaml jsonschema" };
}

function westStep(host: BootstrapHost): BootstrapStep {
  return host === "win32"
    ? { description: "Install `west`", command: "python -m pip install --user west" }
    : { description: "Install `west`", command: "pip3 install --user west" };
}

export function planForHost(host: BootstrapHost, os: BootstrapOs): BootstrapPlan {
  if (os === "zephyr") {
    return {
      title: `Bootstrap Alp SDK (Zephyr, ${host})`,
      steps: [pythonDepsStep(host), westStep(host)],
      pointers: [ZEPHYR_SDK_INSTALLER, ZEPHYR_GETTING_STARTED],
    };
  }
  if (os === "yocto") {
    const yoctoStep: BootstrapStep =
      host === "linux"
        ? {
            description: "Install Yocto host packages (Ubuntu / Debian apt)",
            command:
              "sudo apt-get update && sudo apt-get install -y " +
              "gawk wget git diffstat unzip texinfo gcc build-essential " +
              "chrpath socat cpio python3 python3-pip python3-pexpect " +
              "xz-utils debianutils iputils-ping python3-git python3-jinja2 " +
              "libegl1-mesa libsdl1.2-dev pylint xterm python3-subunit " +
              "mesa-common-dev zstd liblz4-tool file locales",
          }
        : { description: "Yocto host build is Linux-only.  Use a VM / Docker container.", command: "echo 'See pointers below'" };
    return {
      title: `Bootstrap Alp SDK (Yocto, ${host})`,
      steps: [pythonDepsStep(host), yoctoStep],
      pointers: [
        { name: "Yocto Project quick build", url: "https://docs.yoctoproject.org/brief-yoctoprojectqs/index.html" },
        { name: "Yocto host requirements", url: "https://docs.yoctoproject.org/ref-manual/system-requirements.html" },
      ],
    };
  }
  return {
    title: `Bootstrap Alp SDK (baremetal, ${host})`,
    steps: [pythonDepsStep(host)],
    pointers: [
      { name: "Alif Ensemble dev tools", url: "https://alifsemi.com/support/software-development-kit/" },
      { name: "Renesas RZ/V2N CMSIS-Driver pack", url: "https://www.renesas.com/us/en/software-tool/flexible-software-package-fsp" },
      { name: "NXP MCUXpresso for i.MX 93", url: "https://www.nxp.com/design/software/mcuxpresso-software-and-tools/" },
    ],
  };
}

export type FixResult =
  | { kind: "command"; step: BootstrapStep }
  | { kind: "pointer"; pointer: BootstrapPointer };

export function fixCommand(fixId: ToolchainFixId, host: BootstrapHost): FixResult {
  switch (fixId) {
    case "python-deps":
      return { kind: "command", step: pythonDepsStep(host) };
    case "west":
      return { kind: "command", step: westStep(host) };
    case "build-tools":
      return { kind: "pointer", pointer: ZEPHYR_GETTING_STARTED };
    case "zephyr-sdk":
      return { kind: "pointer", pointer: ZEPHYR_SDK_INSTALLER };
  }
}
```

- [ ] **Step 4: Run to verify it passes** — `pnpm run compile && node --test test/toolchain.bootstrapPlan.test.js` → PASS (4).
- [ ] **Step 5: Commit**
```bash
git add packages/alp-core/src/toolchain/bootstrapPlan.ts test/toolchain.bootstrapPlan.test.js
git commit -m "feat(core): toolchain bootstrap plans + fix mapping"
```

---

### Task 2: Core — toolchain analyzer

**Files:** Create `packages/alp-core/src/toolchain/doctor.ts`, `test/toolchain.doctor.test.js`.

- [ ] **Step 1: Write the failing test** — `test/toolchain.doctor.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyzeToolchain } = require("@alp-sdk/core/toolchain/doctor");

function allPresent() {
  return {
    tools: {
      python: { present: true, detail: "Python 3.11.0" },
      west: { present: true, detail: "v1.2" },
      cmake: { present: true }, ninja: { present: true },
      dtc: { present: true }, gdb: { present: true }, alp: { present: true },
    },
    pythonDeps: { pyyaml: true, jsonschema: true },
    env: { zephyrSdkDir: "/opt/zephyr-sdk", zephyrBase: "/z" },
    sdkConnected: true,
  };
}

test("all present → ok, zero missing required", () => {
  const r = analyzeToolchain(allPresent());
  assert.equal(r.ok, true);
  assert.equal(r.missingRequired, 0);
  assert.ok(r.checks.every((c) => c.status === "ok"));
});

test("missing required tool (cmake) → missing + fixId, not ok", () => {
  const inputs = allPresent();
  inputs.tools.cmake = { present: false };
  const r = analyzeToolchain(inputs);
  const cmake = r.checks.find((c) => c.id === "cmake");
  assert.equal(cmake.status, "missing");
  assert.equal(cmake.required, true);
  assert.equal(cmake.fixId, "build-tools");
  assert.equal(r.ok, false);
  assert.equal(r.missingRequired, 1);
});

test("missing recommended (alp CLI) → warn, still ok", () => {
  const inputs = allPresent();
  inputs.tools.alp = { present: false };
  const r = analyzeToolchain(inputs);
  const alp = r.checks.find((c) => c.id === "alp");
  assert.equal(alp.status, "warn");
  assert.equal(alp.required, false);
  assert.equal(r.ok, true);
});

test("missing python deps → missing with python-deps fixId", () => {
  const inputs = allPresent();
  inputs.pythonDeps = { pyyaml: true, jsonschema: false };
  const r = analyzeToolchain(inputs);
  const deps = r.checks.find((c) => c.id === "python-deps");
  assert.equal(deps.status, "missing");
  assert.equal(deps.fixId, "python-deps");
  assert.match(deps.detail, /jsonschema/);
});

test("missing zephyr sdk env → missing with zephyr-sdk fixId", () => {
  const inputs = allPresent();
  inputs.env = {};
  const r = analyzeToolchain(inputs);
  assert.equal(r.checks.find((c) => c.id === "zephyr-sdk").fixId, "zephyr-sdk");
  assert.equal(r.checks.find((c) => c.id === "zephyr-base").status, "warn");
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm run compile && node --test test/toolchain.doctor.test.js` → FAIL.

- [ ] **Step 3: Implement** — Create `packages/alp-core/src/toolchain/doctor.ts`:

```ts
// SPDX-License-Identifier: Apache-2.0

import { ToolchainFixId } from "./bootstrapPlan";

export interface ToolProbe {
  present: boolean;
  detail?: string;
}

export interface ToolchainInputs {
  tools: Record<string, ToolProbe>;
  pythonDeps: Record<string, boolean>;
  env: { zephyrSdkDir?: string; zephyrBase?: string };
  sdkConnected: boolean;
}

export type DoctorCheckStatus = "ok" | "missing" | "warn";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  detail: string;
  required: boolean;
  fixId?: ToolchainFixId;
}

export interface ToolchainReport {
  checks: DoctorCheck[];
  ok: boolean;
  missingRequired: number;
}

function toolCheck(
  inputs: ToolchainInputs,
  id: string,
  label: string,
  required: boolean,
  fixId?: ToolchainFixId,
): DoctorCheck {
  const probe = inputs.tools[id];
  const present = Boolean(probe?.present);
  return {
    id,
    label,
    required,
    status: present ? "ok" : required ? "missing" : "warn",
    detail: present
      ? probe?.detail ?? "found"
      : required
        ? "not found on PATH"
        : "not found (recommended)",
    fixId: present ? undefined : fixId,
  };
}

export function analyzeToolchain(inputs: ToolchainInputs): ToolchainReport {
  const checks: DoctorCheck[] = [];

  checks.push(toolCheck(inputs, "python", "Python", true));

  const missingDeps = Object.entries(inputs.pythonDeps)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  checks.push({
    id: "python-deps",
    label: "Python deps (pyyaml, jsonschema)",
    required: true,
    status: missingDeps.length === 0 ? "ok" : "missing",
    detail: missingDeps.length === 0 ? "importable" : `missing: ${missingDeps.join(", ")}`,
    fixId: missingDeps.length === 0 ? undefined : "python-deps",
  });

  checks.push(toolCheck(inputs, "west", "west", true, "west"));
  checks.push(toolCheck(inputs, "cmake", "CMake", true, "build-tools"));
  checks.push(toolCheck(inputs, "ninja", "Ninja", true, "build-tools"));
  checks.push(toolCheck(inputs, "dtc", "Device Tree Compiler (dtc)", true, "build-tools"));
  checks.push(toolCheck(inputs, "gdb", "GDB", false, "build-tools"));

  checks.push({
    id: "zephyr-sdk",
    label: "Zephyr SDK",
    required: true,
    status: inputs.env.zephyrSdkDir ? "ok" : "missing",
    detail: inputs.env.zephyrSdkDir ?? "ZEPHYR_SDK_INSTALL_DIR not set",
    fixId: inputs.env.zephyrSdkDir ? undefined : "zephyr-sdk",
  });
  checks.push({
    id: "zephyr-base",
    label: "ZEPHYR_BASE",
    required: false,
    status: inputs.env.zephyrBase ? "ok" : "warn",
    detail: inputs.env.zephyrBase ?? "not set (recommended)",
  });

  checks.push(toolCheck(inputs, "alp", "alp CLI", false));
  checks.push({
    id: "sdk-connected",
    label: "Alp SDK connected",
    required: false,
    status: inputs.sdkConnected ? "ok" : "warn",
    detail: inputs.sdkConnected ? "alpSdk.path resolves" : "run Alp: Connect SDK",
  });

  const missingRequired = checks.filter((c) => c.required && c.status === "missing").length;
  return { checks, ok: missingRequired === 0, missingRequired };
}
```

- [ ] **Step 4: Run to verify it passes** — `pnpm run compile && node --test test/toolchain.doctor.test.js` → PASS (5).
- [ ] **Step 5: Commit**
```bash
git add packages/alp-core/src/toolchain/doctor.ts test/toolchain.doctor.test.js
git commit -m "feat(core): toolchain doctor analyzer"
```

---

### Task 3: Adapter — probes + inputs collection

**Files:** Create `src/toolchain/vscodeAdapter.ts`. Modify `src/sdkStatus.ts` (reuse the moved `probeTool`).

- [ ] **Step 1: Create `src/toolchain/vscodeAdapter.ts`**

```ts
// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "child_process";
import { collectProjectContext } from "../project/vscodeAdapter";
import { ToolchainInputs, ToolProbe } from "@alp-sdk/core/toolchain/doctor";

/** Probe a CLI tool's version; present=false if it isn't on PATH / errors. */
export function probeTool(cmd: string, args: string[]): ToolProbe {
  try {
    const out = execFileSync(cmd, args, { encoding: "utf-8", timeout: 4000 });
    return { present: true, detail: out.trim().split(/\r?\n/)[0] };
  } catch {
    return { present: false };
  }
}

function pythonCmd(): string {
  return process.platform === "win32" ? "python" : "python3";
}

function probePythonDep(module: string): boolean {
  try {
    execFileSync(pythonCmd(), ["-c", `import ${module}`], { timeout: 4000, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function collectToolchainInputs(): ToolchainInputs {
  const py = pythonCmd();
  return {
    tools: {
      python: probeTool(py, ["--version"]),
      west: probeTool("west", ["--version"]),
      cmake: probeTool("cmake", ["--version"]),
      ninja: probeTool("ninja", ["--version"]),
      dtc: probeTool("dtc", ["--version"]),
      gdb: probeTool("gdb", ["--version"]),
      alp: probeTool("alp", ["--help"]),
    },
    pythonDeps: {
      pyyaml: probePythonDep("yaml"),
      jsonschema: probePythonDep("jsonschema"),
    },
    env: {
      zephyrSdkDir: process.env.ZEPHYR_SDK_INSTALL_DIR || undefined,
      zephyrBase: process.env.ZEPHYR_BASE || undefined,
    },
    sdkConnected: collectProjectContext().sdkRoot !== null,
  };
}
```

- [ ] **Step 2: Refactor `src/sdkStatus.ts` to reuse `probeTool`**

In `src/sdkStatus.ts`, delete the local `probe` function and import the shared one, adapting call sites (it now returns `{present, detail}` not `{ok, value}`). Replace the import block top and the two probe calls. Specifically:
- Add `import { probeTool } from "./toolchain/vscodeAdapter";`
- Delete the local `function probe(...)`.
- Change `const py = probe(pythonCmd, ["--version"]);` → `const py = probeTool(pythonCmd, ["--version"]);` and below `value: py.value, ok: py.ok` → `value: py.detail ?? "not found on PATH", ok: py.present`. Same for `west`: `const west = probeTool("west", ["--version"]);` and `value: west.detail ?? "not found on PATH", ok: west.present`.

- [ ] **Step 3: Verify it compiles** — `pnpm run compile` → EXIT 0.
- [ ] **Step 4: Commit**
```bash
git add src/toolchain/vscodeAdapter.ts src/sdkStatus.ts
git commit -m "feat(toolchain): env probes + shared probeTool"
```

---

### Task 4: Refactor `bootstrap.ts` onto core `planForHost`

**Files:** Modify `src/bootstrap.ts`.

- [ ] **Step 1: Replace the inline plan with the core import**

In `src/bootstrap.ts`: delete the local `type Host`, `interface BootstrapPlan`, and `function planForHost(...)`. Add:
```ts
import { planForHost, BootstrapHost, BootstrapOs } from "@alp-sdk/core/toolchain/bootstrapPlan";
```
Update `runBootstrap` to use the imported types:
```ts
  const host: BootstrapHost =
    process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
  const plan = planForHost(host, os as BootstrapOs);
```
(`pickOs` and the terminal-emit logic stay unchanged.)

- [ ] **Step 2: Verify it compiles** — `pnpm run compile` → EXIT 0.
- [ ] **Step 3: Commit**
```bash
git add src/bootstrap.ts
git commit -m "refactor(bootstrap): use tested core planForHost"
```

---

### Task 5: Doctor command (output channel + actions)

**Files:** Create `src/toolchain.ts`. Modify `src/extension.ts`, `package.json`.

- [ ] **Step 1: Create `src/toolchain.ts`** (panel wiring is added in Task 7; this task delivers the command + output report + fix action)

```ts
// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { analyzeToolchain, ToolchainReport } from "@alp-sdk/core/toolchain/doctor";
import { fixCommand, ToolchainFixId, BootstrapHost } from "@alp-sdk/core/toolchain/bootstrapPlan";
import { collectToolchainInputs } from "./toolchain/vscodeAdapter";
import { log, showOutput } from "./util";

function host(): BootstrapHost {
  return process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
}

function statusGlyph(status: string): string {
  return status === "ok" ? "OK " : status === "warn" ? "~~ " : "!! ";
}

export function runToolchainFix(fixId: ToolchainFixId): void {
  const result = fixCommand(fixId, host());
  if (result.kind === "pointer") {
    void vscode.env.openExternal(vscode.Uri.parse(result.pointer.url));
    return;
  }
  const term = vscode.window.createTerminal({ name: "Alp toolchain fix" });
  term.show(true);
  term.sendText(`# ${result.step.description}`);
  term.sendText(result.step.command);
}

function reportToOutput(report: ToolchainReport): void {
  log("── Alp toolchain doctor ──");
  for (const c of report.checks) {
    log(`  ${statusGlyph(c.status)}${c.label}: ${c.detail}`);
  }
  log(`  → ${report.ok ? "toolchain OK" : `${report.missingRequired} required item(s) missing`}`);
}

export function buildToolchainReport(): ToolchainReport {
  return analyzeToolchain(collectToolchainInputs());
}

function registerDoctorCommand(): vscode.Disposable {
  return vscode.commands.registerCommand("alp.toolchainDoctor", async () => {
    const report = buildToolchainReport();
    reportToOutput(report);
    const firstFix = report.checks.find((c) => c.status === "missing" && c.fixId);
    const summary = report.ok
      ? "Toolchain OK"
      : `Toolchain — ${report.missingRequired} required item(s) missing`;
    const actions = ["Show report", firstFix ? "Fix missing" : "", "Settings"].filter(Boolean);
    const pick = await vscode.window.showInformationMessage(summary, ...actions);
    if (pick === "Show report") showOutput();
    else if (pick === "Fix missing" && firstFix?.fixId) runToolchainFix(firstFix.fixId);
    else if (pick === "Settings") void vscode.commands.executeCommand("workbench.action.openSettings", "alpSdk");
  });
}

export function registerToolchainCommands(): vscode.Disposable[] {
  return [registerDoctorCommand()];
}
```

- [ ] **Step 2: Register in `src/extension.ts`**

Add `import { registerToolchainCommands } from "./toolchain";` and add `...registerToolchainCommands(),` to the `context.subscriptions.push(...)` list.

- [ ] **Step 3: Add the command to `package.json`** — in `contributes.commands`, after `alp.generateTasksJson`:
```json
      {
        "command": "alp.toolchainDoctor",
        "title": "Alp: Toolchain doctor",
        "category": "Alp"
      }
```

- [ ] **Step 4: Verify** — `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'));console.log('ok')" && pnpm run compile` → ok + EXIT 0.
- [ ] **Step 5: Commit**
```bash
git add src/toolchain.ts src/extension.ts package.json
git commit -m "feat(toolchain): Alp: Toolchain doctor command (output report + fix)"
```

---

### Task 6: Core — doctor panel HTML

**Files:** Create `packages/alp-core/src/toolchain/doctorHtml.ts`.

- [ ] **Step 1: Implement** (no test — pure string builder verified via compile + the panel render)

```ts
// SPDX-License-Identifier: Apache-2.0

export interface DoctorPanelHtmlInput {
  nonce: string;
  cspSource: string;
  cssUri: string;
  jsUri: string;
}

export function createDoctorPanelHtml(input: DoctorPanelHtmlInput): string {
  const { nonce, cspSource, cssUri, jsUri } = input;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource}; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${cssUri}" rel="stylesheet" />
  <title>Alp Toolchain Doctor</title>
</head>
<body>
  <header class="alp-doc-header">
    <span class="alp-doc-title">Toolchain Doctor</span>
    <span id="alp-doc-summary" class="alp-doc-summary"></span>
  </header>
  <main id="alp-doc-rows"></main>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`;
}
```

- [ ] **Step 2: Verify it compiles** — `pnpm run compile` → EXIT 0.
- [ ] **Step 3: Commit**
```bash
git add packages/alp-core/src/toolchain/doctorHtml.ts
git commit -m "feat(core): toolchain doctor panel HTML shell"
```

---

### Task 7: Webview panel + renderer, wired to the command

**Files:** Create `src/toolchain/doctorPanel.ts`, `media/toolchainDoctor.js`, `media/toolchainDoctor.css`. Modify `src/toolchain.ts` (open the panel from the command).

- [ ] **Step 1: Create `src/toolchain/doctorPanel.ts`**

```ts
// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { createDoctorPanelHtml } from "@alp-sdk/core/toolchain/doctorHtml";
import { ToolchainFixId } from "@alp-sdk/core/toolchain/bootstrapPlan";
import { buildToolchainReport, runToolchainFix } from "../toolchain";

let current: vscode.WebviewPanel | undefined;

function html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = String(Math.random()).slice(2);
  const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "toolchainDoctor.css"));
  const jsUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "toolchainDoctor.js"));
  return createDoctorPanelHtml({ nonce, cspSource: webview.cspSource, cssUri: String(cssUri), jsUri: String(jsUri) });
}

function postReport(panel: vscode.WebviewPanel): void {
  panel.webview.postMessage({ type: "report", report: buildToolchainReport() });
}

export function showToolchainDoctorPanel(context: vscode.ExtensionContext): void {
  if (current) {
    current.reveal(vscode.ViewColumn.Active);
    postReport(current);
    return;
  }
  const panel = vscode.window.createWebviewPanel(
    "alpToolchainDoctor",
    "Alp Toolchain Doctor",
    vscode.ViewColumn.Active,
    { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")] },
  );
  panel.webview.html = html(panel.webview, context.extensionUri);
  panel.webview.onDidReceiveMessage((msg) => {
    if (msg?.type === "fix" && typeof msg.fixId === "string") {
      runToolchainFix(msg.fixId as ToolchainFixId);
    } else if (msg?.type === "reload") {
      postReport(panel);
    }
  });
  panel.onDidDispose(() => {
    current = undefined;
  });
  current = panel;
  postReport(panel);
}
```

- [ ] **Step 2: Create `media/toolchainDoctor.css`**

```css
:root { color-scheme: light dark; }
body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); margin: 0; padding: 0 16px 24px; }
.alp-doc-header { display: flex; align-items: baseline; gap: 12px; padding: 16px 0; border-bottom: 1px solid var(--vscode-panel-border); position: sticky; top: 0; background: var(--vscode-editor-background); }
.alp-doc-title { font-size: 16px; font-weight: 600; }
.alp-doc-summary { opacity: 0.8; }
.alp-doc-row { display: grid; grid-template-columns: 24px 1fr auto; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--vscode-panel-border); }
.alp-doc-glyph { font-weight: 700; }
.alp-doc-ok { color: var(--vscode-testing-iconPassed, #3fb950); }
.alp-doc-warn { color: var(--vscode-testing-iconQueued, #d29922); }
.alp-doc-missing { color: var(--vscode-testing-iconFailed, #f85149); }
.alp-doc-label { font-weight: 600; }
.alp-doc-detail { opacity: 0.75; font-size: 12px; }
.alp-doc-fix { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; }
.alp-doc-fix:hover { background: var(--vscode-button-hoverBackground); }
```

- [ ] **Step 3: Create `media/toolchainDoctor.js`**

```js
// SPDX-License-Identifier: Apache-2.0
(function () {
  const vscode = acquireVsCodeApi();

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || msg.type !== "report") return;
    render(msg.report);
  });

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else node[k] = v;
    }
    for (const c of children || []) if (c) node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    return node;
  }

  function glyph(status) {
    return status === "ok" ? "✓" : status === "warn" ? "!" : "✗";
  }

  function render(report) {
    const summary = document.getElementById("alp-doc-summary");
    summary.textContent = report.ok ? "All required tools present" : report.missingRequired + " required item(s) missing";

    const rows = document.getElementById("alp-doc-rows");
    rows.textContent = "";
    for (const c of report.checks) {
      const g = el("span", { class: "alp-doc-glyph alp-doc-" + c.status, text: glyph(c.status) });
      const mid = el("div", {}, [
        el("div", { class: "alp-doc-label", text: c.label + (c.required ? "" : " (recommended)") }),
        el("div", { class: "alp-doc-detail", text: c.detail }),
      ]);
      let action = el("span", {});
      if (c.fixId) {
        const btn = el("button", { class: "alp-doc-fix", text: "Fix" });
        btn.addEventListener("click", () => vscode.postMessage({ type: "fix", fixId: c.fixId }));
        action = btn;
      }
      rows.appendChild(el("div", { class: "alp-doc-row" }, [g, mid, action]));
    }
  }

  vscode.postMessage({ type: "reload" });
})();
```

- [ ] **Step 4: Open the panel from the command** — in `src/toolchain.ts`:
  - Add `import { showToolchainDoctorPanel } from "./toolchain/doctorPanel";`
  - Change `registerToolchainCommands()` to accept `context: vscode.ExtensionContext` and register the command with it; in the command handler, change the `"Show report"` action to open the panel: replace `if (pick === "Show report") showOutput();` with `if (pick === "Show report") showToolchainDoctorPanel(context);`. Keep the output-channel write (always) and the other actions.
  - Update the signature: `export function registerToolchainCommands(context: vscode.ExtensionContext): vscode.Disposable[]` and have `registerDoctorCommand(context)` receive it.
  - In `src/extension.ts` change `...registerToolchainCommands(),` → `...registerToolchainCommands(context),`.

  Note: `doctorPanel.ts` imports `buildToolchainReport`/`runToolchainFix` from `../toolchain`, and `toolchain.ts` imports `showToolchainDoctorPanel` from `./toolchain/doctorPanel` — this is a cyclic import but safe here because all uses are inside function bodies (not module top-level execution). If `tsc` errors, break the cycle by moving `buildToolchainReport`/`runToolchainFix` into `src/toolchain/vscodeAdapter.ts`; otherwise leave as-is.

- [ ] **Step 5: Verify it compiles** — `pnpm run compile` → EXIT 0.
- [ ] **Step 6: Commit**
```bash
git add src/toolchain/doctorPanel.ts media/toolchainDoctor.js media/toolchainDoctor.css src/toolchain.ts src/extension.ts
git commit -m "feat(toolchain): doctor webview panel with per-row fixes"
```

---

### Task 8: Full suite + headless panel verification

**Files:** none (verification only).

- [ ] **Step 1: Full suite** — `pnpm run compile && node --test test/*.test.js` → all pass (193 + 9 new = 202; the new files add: bootstrapPlan 4, doctor 5). No new failures.

- [ ] **Step 2: Headless webview render check** — build a standalone HTML harness that inlines `media/toolchainDoctor.css` + `media/toolchainDoctor.js`, stubs `acquireVsCodeApi`, and `postMessage`s a mock `report` (a few checks: some ok, one missing with fixId, one warn). Serve via the brainstorm visual-companion server and screenshot with Playwright MCP. Confirm rows render with status glyphs/colors and a Fix button on the missing row. (Per repo convention — no jsdom.)

- [ ] **Step 3: Manual dev-host notes** — run **Alp: Toolchain doctor**: output channel lists all checks; info message shows the count; "Show report" opens the panel; a Fix on a missing required tool opens a terminal (python-deps/west) or a doc link (build-tools/zephyr-sdk).

---

## Self-Review

**1. Spec coverage:** new `alp.toolchainDoctor` command (Task 5) + shared core (`analyzeToolchain` Task 2, `planForHost`/`fixCommand` Task 1) reused by bootstrap (Task 4) and sdkStatus (Task 3 `probeTool`). Checks: core build tools + Zephyr SDK/env + alp CLI + python deps (Task 2). Report both output channel (Task 5) and webview (Tasks 6–7). Non-destructive fixes (Task 1 `fixCommand` → command or pointer; Task 5 `runToolchainFix`). ✓

**2. Placeholder scan:** every code step has complete code; the only prose is the cyclic-import note (with a concrete fallback). ✓

**3. Type consistency:** `ToolchainFixId` (Task 1) used by `doctor.ts` (Task 2), `toolchain.ts` (Task 5), `doctorPanel.ts` (Task 7). `ToolchainInputs`/`ToolProbe`/`ToolchainReport` (Task 2) used by adapter (Task 3) and command (Task 5). `createDoctorPanelHtml` input shape (Task 6) matches the panel call (Task 7). `probeTool` returns `{present, detail}` (Task 3) — sdkStatus refactor adapts to that. The `report` message shape (`{type:"report", report}`) is posted (Task 7 panel) and consumed (Task 7 media js). ✓
