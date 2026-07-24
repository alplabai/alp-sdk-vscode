# Models Panel — Prep GUI (Slice 3c) Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** A "Prep model" flow in the extension — pick a raw `.onnx` + a calibration folder (native dialogs), shell `tan model prep`, and render the **fp32-vs-int8 accuracy report** (verdict + top1/cosine/max-err + guidance) in the Models panel.

**Architecture:** Same thin shape as the fit-badge slice. A `prepModel` command/message triggers native `showOpenDialog`s (model + calibration dir), the panel shells `tan model prep <model> --calibration <dir>` via `runAlpCommand` (long timeout — quantize can take minutes), `toModelPrepResult` (pure service) shapes the `{raw,quantized,accuracy}` envelope, and the webview renders the report. No prep logic in the extension — `tan`/alp own it.

**Tech Stack:** TypeScript (`strict`), React 19 webview, `node:test`. Gates: `pnpm run compile` + `pnpm test`.

## Global Constraints

- **Keep the extension thin** — native file pickers + shell `tan model prep` + reshape the envelope. NO quantize/accuracy logic in `src/`.
- **The seam is the envelope** — `tan model prep --format json` → `{command,ok,exitCode,project,data:{raw,quantized,accuracy:{samples,top1_agreement_pct,mean_cosine,max_abs_err,verdict,guidance}},issues}`. On failure `ok:false` + a `model.failed` issue carrying alp stderr.
- **Mirror message types manually** — `src/ideHub/messages.ts` ↔ `packages/alp-webview/src/types.ts`. Additive types don't bump `PROTOCOL_VERSION` (repo precedent, matches the fit-badge slice).
- **Long timeout** — reuse `MODEL_BUILD_TIMEOUT_MS` (30 min) for the prep shell; a real quantize can run minutes.
- **Reuse `cliFailureMessage`** for the null/error path.
- **Verdict → variant:** `good`→ok (green), `degraded`→warn (yellow).
- **Branch:** `feat/models-panel` (extends #310). Do NOT merge. NO Claude/AI attribution. Public repo hygiene.

---

## File Structure

- **Modify** `src/ideHub/messages.ts` — `ModelPrepResultMessage` (ext→webview) + `PrepModelMessage` (webview→ext) + union members.
- **Modify** `packages/alp-webview/src/types.ts` — mirror both + unions.
- **Modify** `src/models/service.ts` — `toModelPrepResult(outcome: CliOutcome): ModelPrepResultMessage`.
- **Modify** `src/models/panel.ts` — `prepModel()` adapter (native dialogs + shell) + `prepModel` message case.
- **Modify** `packages/alp-webview/src/features/models/useModels.ts` — prep state + `modelPrepResult` handling + `prepModel()` poster.
- **Modify** `packages/alp-webview/src/features/models/ModelsView.tsx` — "Prep model" button + report rendering.
- **Test** `test/models.service.test.js` — `toModelPrepResult` unit tests.

---

## Task 1: Message types (both sides)

**Files:**
- Modify: `src/ideHub/messages.ts`, `packages/alp-webview/src/types.ts`

**Interfaces:**
- Produces: `ModelPrepResultMessage { type:"modelPrepResult"; ok:boolean; quantized?:string; accuracy?:{samples:number;top1_agreement_pct:number;mean_cosine:number;max_abs_err:number;verdict:string;guidance:string|null}; issues:{code:string;severity:string;message:string}[] }` and `PrepModelMessage { type:"prepModel" }`.

- [ ] **Step 1: Add types + unions in `src/ideHub/messages.ts`**

Near `ModelFitDataMessage`, add:

```ts
/** Result of `tan model prep` — the quantized artifact + accuracy report. */
export interface ModelPrepResultMessage {
  type: "modelPrepResult";
  ok: boolean;
  quantized?: string;
  accuracy?: {
    samples: number;
    top1_agreement_pct: number;
    mean_cosine: number;
    max_abs_err: number;
    verdict: string;
    guidance: string | null;
  };
  issues: { code: string; severity: string; message: string }[];
}
```

Near `CheckModelFitMessage`, add:

```ts
/** Ask the extension to prep a model (prompts for model + calibration dir). */
export interface PrepModelMessage {
  type: "prepModel";
}
```

Add `| ModelPrepResultMessage` to `ExtToWebviewMessage` and `| PrepModelMessage` to `WebviewToExtMessage`.

- [ ] **Step 2: Mirror in `packages/alp-webview/src/types.ts`** (identical interfaces + union additions).

- [ ] **Step 3: Compile** (`pnpm run compile 2>&1 | tail -12`) — clean.

- [ ] **Step 4: Commit**

```bash
git add src/ideHub/messages.ts packages/alp-webview/src/types.ts
git commit -m "feat(models): add prepModel/modelPrepResult protocol messages"
```

---

## Task 2: `toModelPrepResult` service + test

**Files:**
- Modify: `src/models/service.ts`
- Test: `test/models.service.test.js`

**Interfaces:**
- Consumes: `CliOutcome`, `AlpIssue`, `cliFailureMessage`, `ModelPrepResultMessage`.
- Produces: `toModelPrepResult(outcome: CliOutcome): ModelPrepResultMessage`.

- [ ] **Step 1: Write the failing test**

Add to `test/models.service.test.js`:

```js
test("toModelPrepResult: ok envelope -> quantized + accuracy passthrough", () => {
  const outcome = {
    exitCode: 0, message: "",
    envelope: { command: "model", ok: true, exitCode: 0, project: {},
      data: { raw: "m.onnx", quantized: "m.int8.onnx",
        accuracy: { samples: 8, top1_agreement_pct: 100.0, mean_cosine: 0.999,
          max_abs_err: 0.01, verdict: "good", guidance: null } },
      issues: [] },
  };
  const msg = toModelPrepResult(outcome);
  assert.equal(msg.type, "modelPrepResult");
  assert.equal(msg.ok, true);
  assert.equal(msg.quantized, "m.int8.onnx");
  assert.equal(msg.accuracy.verdict, "good");
});

test("toModelPrepResult: null envelope -> ok:false + real cause", () => {
  const outcome = { exitCode: -1, message: "tan binary not found", envelope: null };
  const msg = toModelPrepResult(outcome);
  assert.equal(msg.ok, false);
  assert.ok(msg.issues.some((i) => i.message.includes("tan binary not found")));
});

test("toModelPrepResult: !ok envelope -> ok:false, surfaces model.failed", () => {
  const outcome = {
    exitCode: 1, message: "prep failed",
    envelope: { command: "model", ok: false, exitCode: 1, project: {}, data: null,
      issues: [{ code: "model.failed", severity: "error", message: "error: calibration set has 2 samples" }] },
  };
  const msg = toModelPrepResult(outcome);
  assert.equal(msg.ok, false);
  assert.ok(msg.issues.some((i) => i.code === "model.failed"));
});
```

Ensure `toModelPrepResult` is imported at the top alongside the existing service imports.

- [ ] **Step 2: Run → fail** (`pnpm run compile && node --test test/models.service.test.js 2>&1 | tail -12`).

- [ ] **Step 3: Implement `toModelPrepResult`** in `src/models/service.ts` (add `ModelPrepResultMessage` to the `../ideHub/messages` import):

```ts
/**
 * Shape a `tan model prep` outcome into the webview's prep-result message.
 * A `null` envelope or `!ok` → `ok:false` with the real cause (via
 * `cliFailureMessage`) plus any envelope issues (tan's `model.failed`).
 */
export function toModelPrepResult(outcome: CliOutcome): ModelPrepResultMessage {
  const env = outcome.envelope;
  if (env === null || !env.ok) {
    const issues: AlpIssue[] = [...(env?.issues ?? [])];
    if (env === null) {
      issues.push({ code: "modelPrep.cli-error", severity: "error",
        message: cliFailureMessage(outcome) });
    }
    return { type: "modelPrepResult", ok: false, issues };
  }
  const data = env.data as {
    quantized?: string;
    accuracy?: ModelPrepResultMessage["accuracy"];
  };
  return { type: "modelPrepResult", ok: true, quantized: data.quantized,
    accuracy: data.accuracy, issues: env.issues };
}
```

- [ ] **Step 4: Run green** (`pnpm run compile && node --test test/models.service.test.js 2>&1 | tail -8`).

- [ ] **Step 5: Commit**

```bash
git add src/models/service.ts test/models.service.test.js
git commit -m "feat(models): toModelPrepResult — shape tan model prep envelope"
```

---

## Task 3: Panel adapter — `prepModel()` (native dialogs + shell)

**Files:**
- Modify: `src/models/panel.ts`

**Interfaces:**
- Consumes: `toModelPrepResult`, `runAlpCommand`, `MODEL_BUILD_TIMEOUT_MS`, `PrepModelMessage`.

- [ ] **Step 1: Import `toModelPrepResult`** (extend the `./service` import).

- [ ] **Step 2: Add the `prepModel` message case** in `onMessage` (beside `checkModelFit`):

```ts
      case "prepModel":
        void this.prepModel();
        break;
```

- [ ] **Step 3: Add the `prepModel` method** (after `checkFit`):

```ts
  /** Prompt for a raw .onnx + a calibration folder, shell `tan model prep`,
   *  and post the accuracy report. Thin: prep logic lives in tan/alp-sdk. */
  private async prepModel(): Promise<void> {
    const modelPick = await vscode.window.showOpenDialog({
      canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
      filters: { "ONNX model": ["onnx"] }, openLabel: "Select model to prep",
    });
    if (!modelPick || modelPick.length === 0) return;
    const calPick = await vscode.window.showOpenDialog({
      canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
      openLabel: "Select calibration folder (.npy samples)",
    });
    if (!calPick || calPick.length === 0) return;

    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const args = ["model", "prep", modelPick[0].fsPath,
      "--calibration", calPick[0].fsPath];
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification,
        title: "Alp: Prepping model (quantize + accuracy)", cancellable: false },
      async () => {
        const { outcome } = await runAlpCommand(this.context, args, cwd,
          { timeoutMs: MODEL_BUILD_TIMEOUT_MS });
        this.post(toModelPrepResult(outcome));
      },
    );
  }
```

- [ ] **Step 4: Compile** (`pnpm run compile 2>&1 | tail -12`) — clean.

- [ ] **Step 5: Commit**

```bash
git add src/models/panel.ts
git commit -m "feat(models): panel prepModel — pick model + calibration, shell tan model prep"
```

---

## Task 4: Webview — prep button + report rendering

**Files:**
- Modify: `packages/alp-webview/src/features/models/useModels.ts`, `ModelsView.tsx`

**Interfaces:**
- Consumes: `ModelPrepResultMessage`, `PrepModelMessage` (via `../../types`).

- [ ] **Step 1: Extend `useModels.ts`**

Add a narrowed type + state + reducer + handler + poster:

```ts
export interface PrepAccuracy {
  samples: number; top1_agreement_pct: number; mean_cosine: number;
  max_abs_err: number; verdict: string; guidance: string | null;
}
export interface PrepResult {
  ok: boolean; quantized?: string; accuracy?: PrepAccuracy;
  issues: ModelsDataMessage["issues"];
}
```

State additions: `prepping: boolean; prep: PrepResult | null;` (init `false`, `null`). Actions: `{ type: "prepStart" }` and `{ type: "prepResult"; result: PrepResult }`. Reducer:

```ts
    case "prepStart":
      return { ...state, prepping: true };
    case "prepResult":
      return { ...state, prepping: false, prep: action.result };
```

In the `window` message handler, add:

```ts
      if (msg.type === "modelPrepResult") {
        dispatch({ type: "prepResult", result: {
          ok: msg.ok, quantized: msg.quantized, accuracy: msg.accuracy,
          issues: msg.issues } });
      }
```

Expose:

```ts
  const prepModel = () => {
    dispatch({ type: "prepStart" });
    postMessage({ type: "prepModel" });
  };
```

Return `prep`, `prepping`, `prepModel` from the hook.

- [ ] **Step 2: `ModelsView.tsx` — button + report**

Import `PrepResult`/`PrepAccuracy`; pull `prep`, `prepping`, `prepModel` from `useModels()`. Add a toolbar button (beside "Check fit"):

```tsx
<Button onClick={prepModel} disabled={prepping}>
  {prepping ? "Prepping…" : "Prep model"}
</Button>
```

Render the report when present (verdict badge + numbers + guidance + error issues), e.g. a `PrepReport` component:

```tsx
function PrepReport({ prep }: { prep: PrepResult }) {
  if (!prep.ok) {
    return <IssuesBanner ok={false} issues={prep.issues} />;
  }
  const a = prep.accuracy;
  const variant: BadgeVariant = a?.verdict === "good" ? "ok" : "warn";
  return (
    <div className={styles.issues} data-ok={true}>
      <p className={styles.issuesHead}>Prep result</p>
      {prep.quantized && <p className={styles.mono}>{prep.quantized}</p>}
      {a && (
        <>
          <Badge variant={variant} label={`accuracy: ${a.verdict}`} />
          <p className={styles.suggestion}>
            top1 {a.top1_agreement_pct}%  ·  cosine {a.mean_cosine}  ·
            max err {a.max_abs_err}  ·  n={a.samples}
          </p>
          {a.guidance && <p className={styles.suggestion}>{a.guidance}</p>}
        </>
      )}
    </div>
  );
}
```

Render `{prep && <PrepReport prep={prep} />}` near the top of the view (below the toolbar).

- [ ] **Step 3: Compile the webview** (`pnpm run compile 2>&1 | tail -15`) — clean (`tsc --build` + `vp build`).

- [ ] **Step 4: Commit**

```bash
git add packages/alp-webview/src/features/models/useModels.ts packages/alp-webview/src/features/models/ModelsView.tsx
git commit -m "feat(models): Prep model button + accuracy report in the panel"
```

---

## Task 5: Full gate + e2e

- [ ] **Step 1: Full gate** (`pnpm run compile && pnpm test 2>&1 | tail -12`) — all green. Run `pnpm run format:check`; if it flags touched files, `pnpm run format` + commit `style(models): prettier`.
- [ ] **Step 2: e2e** — the controller runs a harness driving the real adapter path (`runAlpAsync` → `toModelPrepResult`) against the built `tan model prep` + a random calibration dir, asserting an ok envelope → `ok:true` + `accuracy.verdict`, and binary-missing → `ok:false` (not false "update tan"). (Executed by the controller — cross-repo tan binary.)

---

## Self-Review

- **Spec coverage** (roadmap §4 sub-project 3, extension): the prep wizard (point model + calibration → quantize → accuracy report) → Tasks 3+4; add-to-project (wire the quantized artifact into `board.yaml`) is a follow-on. ✓
- **Placeholder scan:** all message/service/panel code complete; the webview report gives concrete JSX deferring pixel styling to the implementer matching `ModelsView`.
- **Type consistency:** `ModelPrepResultMessage.accuracy` fields identical across messages.ts, types.ts, service.ts, useModels' `PrepAccuracy`; `prepModel` posted by the webview handled by the panel's `onMessage`.
- **Thin-extension check:** the extension adds zero quantize/accuracy logic — native pickers + shell `tan model prep` + reshape. ✓
