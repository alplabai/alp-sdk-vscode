# Models Panel — Measure GUI (Slice 4c) Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** "Run model" (host reference run: latency + accuracy) and "A/B compare" (two models side-by-side) in the Models panel — shell `tan model run` / `tan model ab`, render the results.

**Architecture:** Same thin shape as the slice-3c prep GUI (which is already in this branch — `prepModel`/`toModelPrepResult`/`ModelPrepStartedMessage`). Two flows: pick model(s) via native `showOpenDialog`, shell `tan model run|ab`, reshape the envelope (pure service), render in the webview. **Apply the 3c lessons:** use a "started" ack (post AFTER dialogs confirm, never optimistic) so a cancelled dialog doesn't stick the button; render failures via `IssuesBanner` (never silent).

**Tech Stack:** TypeScript (`strict`), React 19 webview, `node:test`. Gates: `pnpm run compile` + `pnpm test`.

## Global Constraints

- **Keep the extension thin** — native pickers + shell `tan model run|ab` + reshape. NO measurement logic in `src/`.
- **Honesty carries through** — the `run`/`ab` payloads carry `backend:"cpu-host"` + a `note` (host reference, not target-SoM) + `power_mj`/`peak_sram_kib` = null. Render them AS-IS; the webview must show the `note` caveat + show power/sram as "n/a" (null), never fabricate.
- **Envelope shapes** — `tan model run --format json` → `data: {model, backend, latency_ms, output_argmax, peak_sram_kib, power_mj, runs, random_input, accuracy?:{expected,match}, note}`; `tan model ab` → `data: {a:{model,backend,latency_ms,...}, b:{...}, comparison:{faster, latency_ratio, a_latency_ms, b_latency_ms, size_delta_bytes}, note}`. On failure `ok:false` + `model.failed` issue.
- **Started-ack pattern (from 3c):** one `modelMeasureStarted` message sets a `measuring` flag; the poster does NOT set it optimistically; a cancelled dialog posts nothing (button stays enabled). The result message clears `measuring`.
- **Mirror message types manually** (messages.ts ↔ types.ts); `PROTOCOL_VERSION` unchanged (additive).
- **Reuse `cliFailureMessage`** for null/error. **Timeout:** a `MEASURE_TIMEOUT_MS = 5 * 60 * 1000` (host inference is quick, but be safe).
- **Branch:** `feat/models-panel` (extends #310). Do NOT merge. NO Claude/AI attribution. Public-repo hygiene.

---

## File Structure

- **Modify** `src/ideHub/messages.ts` — `RunModelMessage`, `AbModelsMessage` (up); `ModelMeasureStartedMessage`, `ModelRunResultMessage`, `ModelAbResultMessage` (down); unions.
- **Modify** `packages/alp-webview/src/types.ts` — mirror all five + unions.
- **Modify** `src/models/service.ts` — `toModelRunResult`, `toModelAbResult`.
- **Modify** `src/models/panel.ts` — `MEASURE_TIMEOUT_MS`, `runModel()`, `abModels()`, message cases.
- **Modify** `packages/alp-webview/src/features/models/useModels.ts` — measure state + handlers + posters.
- **Modify** `packages/alp-webview/src/features/models/ModelsView.tsx` — Run/A-B buttons + result rendering.
- **Test** `test/models.service.test.js` — `toModelRunResult` + `toModelAbResult` unit tests.

---

## Task 1: Message types (both sides)

**Interfaces:**
- `RunModelMessage {type:"runModel"}`, `AbModelsMessage {type:"abModels"}` (webview→ext).
- `ModelMeasureStartedMessage {type:"modelMeasureStarted"}` (ext→webview).
- `ModelRunResultMessage {type:"modelRunResult"; ok:boolean; run?:{backend:string;latency_ms:number;output_argmax:number|null;peak_sram_kib:number|null;power_mj:number|null;runs:number;random_input:boolean;note:string;accuracy?:{expected:number;match:boolean}}; issues:{code:string;severity:string;message:string}[]}`.
- `ModelAbResultMessage {type:"modelAbResult"; ok:boolean; ab?:{a:{model:string;backend:string;latency_ms:number};b:{model:string;backend:string;latency_ms:number};comparison:{faster:string;latency_ratio:number|null;a_latency_ms:number;b_latency_ms:number;size_delta_bytes:number|null};note:string}; issues:{code:string;severity:string;message:string}[]}`.

- [ ] **Step 1: Add all five interfaces + union members in `src/ideHub/messages.ts`** (near `ModelPrepResultMessage`/`PrepModelMessage`). Add `ModelMeasureStartedMessage | ModelRunResultMessage | ModelAbResultMessage` to `ExtToWebviewMessage`, and `RunModelMessage | AbModelsMessage` to `WebviewToExtMessage`.

- [ ] **Step 2: Mirror all five in `packages/alp-webview/src/types.ts`** + the same union additions.

- [ ] **Step 3: Compile** (`pnpm run compile 2>&1 | tail -12`) — clean.

- [ ] **Step 4: Commit** (`git add src/ideHub/messages.ts packages/alp-webview/src/types.ts && git commit -m "feat(models): add run/ab measure protocol messages"`).

---

## Task 2: `toModelRunResult` + `toModelAbResult` service + tests

**Interfaces:** `toModelRunResult(outcome: CliOutcome): ModelRunResultMessage`; `toModelAbResult(outcome: CliOutcome): ModelAbResultMessage`.

- [ ] **Step 1: Write the failing tests** in `test/models.service.test.js`:

```js
test("toModelRunResult: ok -> run passthrough", () => {
  const outcome = { exitCode: 0, message: "",
    envelope: { command: "model", ok: true, exitCode: 0, project: {},
      data: { model: "m.onnx", backend: "cpu-host", latency_ms: 0.3, output_argmax: 5,
        peak_sram_kib: null, power_mj: null, runs: 5, random_input: true, note: "host reference" },
      issues: [] } };
  const msg = toModelRunResult(outcome);
  assert.equal(msg.ok, true);
  assert.equal(msg.run.backend, "cpu-host");
  assert.equal(msg.run.power_mj, null);
});

test("toModelRunResult: null envelope -> ok:false + real cause", () => {
  const msg = toModelRunResult({ exitCode: -1, message: "tan binary not found", envelope: null });
  assert.equal(msg.ok, false);
  assert.ok(msg.issues.some((i) => i.message.includes("tan binary not found")));
});

test("toModelAbResult: ok -> comparison passthrough", () => {
  const outcome = { exitCode: 0, message: "",
    envelope: { command: "model", ok: true, exitCode: 0, project: {},
      data: { a: { model: "a", backend: "cpu-host", latency_ms: 1 },
        b: { model: "b", backend: "cpu-host", latency_ms: 2 },
        comparison: { faster: "a", latency_ratio: 2, a_latency_ms: 1, b_latency_ms: 2, size_delta_bytes: 0 },
        note: "host reference" }, issues: [] } };
  const msg = toModelAbResult(outcome);
  assert.equal(msg.ok, true);
  assert.equal(msg.ab.comparison.faster, "a");
});

test("toModelAbResult: !ok -> surfaces model.failed", () => {
  const msg = toModelAbResult({ exitCode: 1, message: "x",
    envelope: { command: "model", ok: false, exitCode: 1, project: {}, data: null,
      issues: [{ code: "model.failed", severity: "error", message: "error: bad" }] } });
  assert.equal(msg.ok, false);
  assert.ok(msg.issues.some((i) => i.code === "model.failed"));
});
```

Import `toModelRunResult`/`toModelAbResult` at the top.

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement both** in `src/models/service.ts` (add the two message types to the `../ideHub/messages` import). They mirror `toModelPrepResult` exactly:

```ts
export function toModelRunResult(outcome: CliOutcome): ModelRunResultMessage {
  const env = outcome.envelope;
  if (env === null || !env.ok) {
    const issues: AlpIssue[] = [...(env?.issues ?? [])];
    if (env === null) {
      issues.push({ code: "modelRun.cli-error", severity: "error", message: cliFailureMessage(outcome) });
    }
    return { type: "modelRunResult", ok: false, issues };
  }
  return { type: "modelRunResult", ok: true,
    run: env.data as ModelRunResultMessage["run"], issues: env.issues };
}

export function toModelAbResult(outcome: CliOutcome): ModelAbResultMessage {
  const env = outcome.envelope;
  if (env === null || !env.ok) {
    const issues: AlpIssue[] = [...(env?.issues ?? [])];
    if (env === null) {
      issues.push({ code: "modelAb.cli-error", severity: "error", message: cliFailureMessage(outcome) });
    }
    return { type: "modelAbResult", ok: false, issues };
  }
  return { type: "modelAbResult", ok: true,
    ab: env.data as ModelAbResultMessage["ab"], issues: env.issues };
}
```

- [ ] **Step 4: Run green** (`pnpm run compile && node --test test/models.service.test.js 2>&1 | tail -8`).

- [ ] **Step 5: Commit** (`git commit -m "feat(models): toModelRunResult + toModelAbResult"`).

---

## Task 3: Panel adapter — `runModel()` + `abModels()`

- [ ] **Step 1: Import** `toModelRunResult, toModelAbResult` (extend `./service` import). Add `const MEASURE_TIMEOUT_MS = 5 * 60 * 1000;` near `MODEL_BUILD_TIMEOUT_MS`.

- [ ] **Step 2: Message cases** in `onMessage` (beside `prepModel`):

```ts
      case "runModel":
        void this.runModel();
        break;
      case "abModels":
        void this.abModels();
        break;
```

- [ ] **Step 3: The two methods** (after `prepModel`), following the 3c ack pattern — post `modelMeasureStarted` AFTER dialogs confirm:

```ts
  private async runModel(): Promise<void> {
    const pick = await vscode.window.showOpenDialog({
      canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
      filters: { "ONNX model": ["onnx"] }, openLabel: "Select model to run",
    });
    if (!pick || pick.length === 0) return;
    this.post({ type: "modelMeasureStarted" });
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Alp: Running model (host reference)", cancellable: false },
      async () => {
        const { outcome } = await runAlpCommand(this.context, ["model", "run", pick[0].fsPath], cwd, { timeoutMs: MEASURE_TIMEOUT_MS });
        this.post(toModelRunResult(outcome));
      },
    );
  }

  private async abModels(): Promise<void> {
    const pick = await vscode.window.showOpenDialog({
      canSelectFiles: true, canSelectFolders: false, canSelectMany: true,
      filters: { "ONNX model": ["onnx"] }, openLabel: "Select TWO models to A/B",
    });
    if (!pick || pick.length < 2) return;
    this.post({ type: "modelMeasureStarted" });
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Alp: A/B comparing models (host reference)", cancellable: false },
      async () => {
        const { outcome } = await runAlpCommand(this.context, ["model", "ab", pick[0].fsPath, pick[1].fsPath], cwd, { timeoutMs: MEASURE_TIMEOUT_MS });
        this.post(toModelAbResult(outcome));
      },
    );
  }
```

(Note: `abModels` uses `canSelectMany:true` and requires ≥2; if the user picks fewer, it returns without an ack — button stays enabled.)

- [ ] **Step 4: Compile** — clean. **Commit** (`git commit -m "feat(models): panel runModel + abModels — shell tan model run/ab"`).

---

## Task 4: Webview — buttons + result rendering

- [ ] **Step 1: `useModels.ts`** — narrowed types `RunResultView`/`AbResultView` (mirror the message `run`/`ab` shapes), state `measuring:boolean; runResult: RunResultView|null; runIssues; abResult: AbResultView|null; abIssues;`, actions `{type:"measureStart"}`, `{type:"runResult";...}`, `{type:"abResult";...}`, reducer arms (measureStart → measuring:true; runResult/abResult → measuring:false + store). `window` handlers: `modelMeasureStarted` → measureStart; `modelRunResult` → runResult; `modelAbResult` → abResult. Posters `runModel()`/`abModels()` post the up-message (NO optimistic flag). Return `measuring, runResult, runIssues, abResult, abIssues, runModel, abModels`.

- [ ] **Step 2: `ModelsView.tsx`** — two buttons (beside "Prep model"), disabled while `measuring`:

```tsx
<Button onClick={runModel} disabled={measuring}>{measuring ? "Measuring…" : "Run model"}</Button>
<Button onClick={abModels} disabled={measuring}>A/B compare</Button>
```

Render the run result (backend + latency + power "n/a" when null + accuracy + note) and the ab result (faster + ratio + latencies + size-delta + note). Failures via `IssuesBanner` — and, like the 3c fix, synthesize a fallback issue when `!ok && issues.length === 0` so failure is never silent. Reuse `Badge`/`styles`.

- [ ] **Step 3: Compile the webview** — clean. **Commit** (`git commit -m "feat(models): Run model + A/B compare buttons + results in the panel"`).

---

## Task 5: Full gate

- [ ] `pnpm run compile && pnpm test 2>&1 | tail -12` — all green. `pnpm run format:check`; if it flags touched files, `pnpm run format` + commit `style(models): prettier`.

---

## Self-Review

- **Spec coverage** (roadmap §4 extension): run-inference + A/B view → Tasks 3+4; live fleet dashboard + on-device = HW-gated follow-ons. ✓
- **3c lessons applied:** started-ack (no optimistic flag → cancel doesn't stick); never-silent failure (fallback issue). ✓
- **Honesty:** `backend:"cpu-host"` + `note` rendered; `power_mj`/`peak_sram_kib` shown as null/"n/a", never fabricated. ✓
- **Thin:** zero measurement logic in `src/` — pickers + shell + reshape. ✓
- **Type consistency:** the `run`/`ab` view types mirror the message `run`/`ab` shapes; `MEASURE_TIMEOUT_MS` used for both shells.
