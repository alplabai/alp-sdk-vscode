# Models Panel — Pre-flight Fit Badge (Slice 1c) Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]` checkboxes.

**Goal:** Add a per-model **fit badge** to the Models panel — the extension shells `tan model check --board board.yaml`, parses the envelope, and shows each board model's fit verdict (`fits`/`cpu-fallback`/`no-fit`) per SoM backend, before any build.

**Architecture:** Same thin shape as the existing list/doctor/build panel plumbing. Webview posts `checkModelFit`; the panel (adapter) shells `tan model check --board board.yaml` via `runAlpCommand`; `toModelFitData` (pure service) shapes the envelope into `ModelFitDataMessage`; the webview renders a fit badge per model. No fit/analysis logic in the extension — `tan`/alp-sdk own it.

**Tech Stack:** TypeScript (`strict`, `noUnused*`), React 19 webview (Vite), `node:test`. Gates: `pnpm run compile` + `pnpm test`.

## Global Constraints

- **Keep the extension thin** — it shells `tan model check --board` and renders the envelope. No board parsing, no verdict logic in `src/`.
- **The seam is the envelope** — `tan model check --board --format json` emits `{command,ok,exitCode,project,data,issues}` with `data = {board, sku, models:[{name,source,backends:[{backend,verdict,est_sram_kib,budget_sram_kib,est_latency_ms,op_coverage_pct,unsupported_ops,source}],suggestion} | {name,source,error}]}`. On failure tan emits `ok:false` + a `model.failed` issue carrying the alp stderr.
- **Mirror message types manually** — every change to `src/ideHub/messages.ts` is mirrored in `packages/alp-webview/src/types.ts` (and bump the protocol-version constant if there is one, both sides).
- **Verdict → badge variant:** `fits`→`ok` (green), `cpu-fallback`→`warn` (yellow), `no-fit`→`err` (red). Reuse the existing `Badge` component + `data-variant`.
- **Dedup backends per model** to the WORST verdict (severity `fits < cpu-fallback < no-fit`) for the summary badge — a model on E8 resolves 3 ethos_u configs; show one `ethos_u` badge at its worst verdict, not three identical rows.
- **Branch:** `feat/models-panel` (extends #310). PR already open — do NOT merge. NO Claude/AI attribution.
- **Reuse `cliFailureMessage`** (already exported from `src/models/service.ts`) for the null/error path — don't re-derive the "update tan" vs real-cause classification.

---

## File Structure

- **Modify** `src/ideHub/messages.ts` — add `ModelFitDataMessage` (ext→webview) + `CheckModelFitMessage` (webview→ext) + union members.
- **Modify** `packages/alp-webview/src/types.ts` — mirror both message types + union members.
- **Modify** `src/models/service.ts` — add pure `toModelFitData(outcome: CliOutcome): ModelFitDataMessage`.
- **Modify** `src/models/panel.ts` — `checkFit()` adapter method + `checkModelFit` message case + fire it from `refresh()`.
- **Modify** `packages/alp-webview/src/features/models/useModels.ts` — fit state + `modelFitData` handling + `checkFit()` poster + narrowed `ModelFit`/`BackendFit` types.
- **Modify** `packages/alp-webview/src/features/models/ModelsView.tsx` — a "Check fit" button + per-model fit badge rendering.
- **Test** `test/models.service.test.js` — `toModelFitData` unit tests.

---

## Task 1: Message types (both sides)

**Files:**
- Modify: `src/ideHub/messages.ts`
- Modify: `packages/alp-webview/src/types.ts`

**Interfaces:**
- Produces: `ModelFitDataMessage { type:"modelFitData"; ok:boolean; sku?:string; models:unknown[]; issues:{code:string;severity:string;message:string}[] }` and `CheckModelFitMessage { type:"checkModelFit" }`.

- [ ] **Step 1: Add types + union members in `src/ideHub/messages.ts`**

Near `ModelsDataMessage`, add:

```ts
/** Per-model fit verdicts from `tan model check --board`. `models` stays
 *  `unknown[]` at the boundary — the board-mode payload
 *  ([{name,source,backends?,suggestion?,error?}]) is narrowed in the webview. */
export interface ModelFitDataMessage {
  type: "modelFitData";
  /** Envelope `ok` (false → show issues, e.g. the alp stderr via `model.failed`). */
  ok: boolean;
  /** `envelope.data.sku` (the board's `som.sku`); absent on failure. */
  sku?: string;
  /** `envelope.data.models` — board-mode per-model results. */
  models: unknown[];
  issues: { code: string; severity: string; message: string }[];
}
```

Near `RequestModelsMessage`, add:

```ts
/** Ask the extension to run the static fit check on the board's models. */
export interface CheckModelFitMessage {
  type: "checkModelFit";
}
```

Add `| ModelFitDataMessage` to the `ExtToWebviewMessage` union (beside `ModelsDataMessage`) and `| CheckModelFitMessage` to the `WebviewToExtMessage` union (beside `RequestModelsMessage`). If a `PROTOCOL_VERSION` constant exists, bump it by 1.

- [ ] **Step 2: Mirror in `packages/alp-webview/src/types.ts`**

Add the identical `ModelFitDataMessage` and `CheckModelFitMessage` interfaces and the same union additions. If `types.ts` carries the mirrored `PROTOCOL_VERSION`, bump it to the SAME value.

- [ ] **Step 3: Compile (type-check both sides)**

Run: `pnpm run compile 2>&1 | tail -15`
Expected: clean (types added, not yet used — no errors).

- [ ] **Step 4: Commit**

```bash
git add src/ideHub/messages.ts packages/alp-webview/src/types.ts
git commit -m "feat(models): add checkModelFit/modelFitData protocol messages"
```

---

## Task 2: `toModelFitData` service (pure) + test

**Files:**
- Modify: `src/models/service.ts`
- Test: `test/models.service.test.js`

**Interfaces:**
- Consumes: `CliOutcome`, `AlpIssue` (from `../alpCli/models`); `cliFailureMessage` (same file); `ModelFitDataMessage` (Task 1).
- Produces: `toModelFitData(outcome: CliOutcome): ModelFitDataMessage`.

- [ ] **Step 1: Write the failing test**

Add to `test/models.service.test.js` (match the file's existing `require`/`node:test` style):

```js
test("toModelFitData: ok envelope -> models + sku passthrough", () => {
  const outcome = {
    exitCode: 0, message: "",
    envelope: { command: "model", ok: true, exitCode: 0, project: {},
      data: { board: "board.yaml", sku: "E1M-AEN801",
        models: [{ name: "tiny", source: "m.tflite",
          backends: [{ backend: "cpu", verdict: "fits" }], suggestion: null }] },
      issues: [] },
  };
  const msg = toModelFitData(outcome);
  assert.equal(msg.type, "modelFitData");
  assert.equal(msg.ok, true);
  assert.equal(msg.sku, "E1M-AEN801");
  assert.equal(msg.models.length, 1);
  assert.equal(msg.models[0].name, "tiny");
});

test("toModelFitData: null envelope -> ok:false + real cause (not 'update tan')", () => {
  const outcome = { exitCode: -1, message: "tan binary not found", envelope: null };
  const msg = toModelFitData(outcome);
  assert.equal(msg.ok, false);
  assert.equal(msg.models.length, 0);
  assert.ok(msg.issues.some((i) => i.message.includes("tan binary not found")));
});

test("toModelFitData: !ok envelope -> ok:false, surfaces envelope issues", () => {
  const outcome = {
    exitCode: 1, message: "model failed",
    envelope: { command: "model", ok: false, exitCode: 1, project: {}, data: null,
      issues: [{ code: "model.failed", severity: "error", message: "error: static check supports .tflite" }] },
  };
  const msg = toModelFitData(outcome);
  assert.equal(msg.ok, false);
  assert.ok(msg.issues.some((i) => i.code === "model.failed"));
});
```

Ensure `toModelFitData` is imported at the top of the test file alongside the existing `toModelsData`/`cliFailureMessage` imports.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm run compile && node --test test/models.service.test.js 2>&1 | tail -15`
Expected: FAIL — `toModelFitData is not a function`.

- [ ] **Step 3: Implement `toModelFitData`**

In `src/models/service.ts`, add the `ModelFitDataMessage` import to the existing `../ideHub/messages` import line, then add:

```ts
/**
 * Shape a `tan model check --board` outcome into the webview's fit payload.
 * A `null` envelope (command never produced one) or `!ok` (validation/runtime
 * failure) surfaces as `ok:false` with an empty model list; the real cause is
 * `cliFailureMessage(outcome)` (a `null` envelope with a real exit code =
 * "update tan"; otherwise the outcome's own message) plus any envelope issues
 * (e.g. tan's `model.failed` carrying the alp stderr).
 */
export function toModelFitData(outcome: CliOutcome): ModelFitDataMessage {
  const env = outcome.envelope;
  if (env === null || !env.ok) {
    const issues: AlpIssue[] = [...(env?.issues ?? [])];
    if (env === null) {
      issues.push({
        code: "modelFit.cli-error",
        severity: "error",
        message: cliFailureMessage(outcome),
      });
    }
    return { type: "modelFitData", ok: false, models: [], issues };
  }
  const data = env.data as { sku?: string; models?: unknown[] };
  return {
    type: "modelFitData",
    ok: true,
    sku: data.sku,
    models: data.models ?? [],
    issues: env.issues,
  };
}
```

- [ ] **Step 4: Run tests green**

Run: `pnpm run compile && node --test test/models.service.test.js 2>&1 | tail -8`
Expected: PASS (existing `toModelsData` tests + 3 new `toModelFitData` tests).

- [ ] **Step 5: Commit**

```bash
git add src/models/service.ts test/models.service.test.js
git commit -m "feat(models): toModelFitData — shape tan model check envelope for the webview"
```

---

## Task 3: Panel adapter — `checkFit()`

**Files:**
- Modify: `src/models/panel.ts`

**Interfaces:**
- Consumes: `toModelFitData` (Task 2); `runAlpCommand`; `CheckModelFitMessage` (Task 1).
- Produces: a `checkModelFit` message handler that shells `tan model check --board board.yaml` and posts `modelFitData`.

- [ ] **Step 1: Add the import**

In `src/models/panel.ts`, extend the `./service` import to include `toModelFitData`:

```ts
import { cliFailureMessage, toModelFitData, toModelsData } from "./service";
```

- [ ] **Step 2: Add the `checkModelFit` case in `onMessage`**

In the `onMessage` switch, add (beside `requestModels`):

```ts
      case "checkModelFit":
        void this.checkFit();
        break;
```

- [ ] **Step 3: Add the `checkFit` method**

Add after `refresh()`:

```ts
  /** Run the static fit check on every board.yaml model
   *  (`tan model check --board board.yaml`) and post the per-model verdicts.
   *  Thin: all fit logic lives in `tan`/alp-sdk; this only shells + shapes. */
  private async checkFit(): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const { outcome } = await runAlpCommand(
      this.context,
      ["model", "check", "--board", "board.yaml"],
      cwd,
    );
    this.post(toModelFitData(outcome));
  }
```

- [ ] **Step 4: Fire it from `refresh()` so badges appear on open**

At the end of `refresh()`, after `this.post(toModelsData(...))`, add:

```ts
    void this.checkFit();
```

- [ ] **Step 5: Compile**

Run: `pnpm run compile 2>&1 | tail -12`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/models/panel.ts
git commit -m "feat(models): panel checkFit — shell tan model check --board on refresh + on demand"
```

---

## Task 4: Webview — fit state + badge rendering

**Files:**
- Modify: `packages/alp-webview/src/features/models/useModels.ts`
- Modify: `packages/alp-webview/src/features/models/ModelsView.tsx`

**Interfaces:**
- Consumes: `ModelFitDataMessage`, `CheckModelFitMessage` (Task 1, via `../../types`).
- Produces: `useModels()` additionally returns `{ fits, fitOk, fitIssues, checkingFit, checkFit }`; `ModelsView` renders a "Check fit" button + a per-model fit badge.

- [ ] **Step 1: Extend `useModels.ts` — types, state, reducer, message handler, poster**

Add narrowed types (beside `ModelListEntry`):

```ts
export interface BackendFit {
  backend: string;
  verdict: "fits" | "cpu-fallback" | "no-fit" | string;
  est_sram_kib?: number;
  budget_sram_kib?: number | null;
  est_latency_ms?: number | null;
  op_coverage_pct?: number;
  unsupported_ops?: string[];
  source?: string;
}
export interface ModelFit {
  name: string;
  source?: string;
  backends?: BackendFit[];
  suggestion?: string | null;
  error?: string;
}
```

Add to `State`: `fits: ModelFit[]; fitOk: boolean; fitIssues: ModelsDataMessage["issues"]; checkingFit: boolean;` (initialise `fits: [], fitOk: true, fitIssues: [], checkingFit: false`).

Add `Action` variants:

```ts
  | { type: "fitStart" }
  | {
      type: "fitData";
      ok: boolean;
      models: ModelFit[];
      issues: ModelsDataMessage["issues"];
    }
```

Add reducer arms:

```ts
    case "fitStart":
      return { ...state, checkingFit: true };
    case "fitData":
      return {
        ...state,
        checkingFit: false,
        fitOk: action.ok,
        fits: action.models,
        fitIssues: action.issues,
      };
```

In the `window` message `useEffect` handler, add a branch (beside `modelsData`):

```ts
      if (msg.type === "modelFitData") {
        dispatch({
          type: "fitData",
          ok: msg.ok,
          models: (msg.models as ModelFit[]) ?? [],
          issues: msg.issues,
        });
      }
```

Expose a `checkFit` callback and return it from the hook:

```ts
  const checkFit = () => {
    dispatch({ type: "fitStart" });
    postMessage({ type: "checkModelFit" });
  };
```

(Return `fits`, `fitOk`, `fitIssues`, `checkingFit`, `checkFit` alongside the existing hook return fields.)

- [ ] **Step 2: `ModelsView.tsx` — the "Check fit" button + per-model badge**

Add a verdict→variant helper + a per-model fit lookup near the existing `artifactVariant`:

```tsx
const FIT_SEVERITY: Record<string, number> = { fits: 0, "cpu-fallback": 1, "no-fit": 2 };
const FIT_VARIANT: Record<number, BadgeVariant> = { 0: "ok", 1: "warn", 2: "err" };
const FIT_LABEL: Record<string, string> = {
  fits: "fits", "cpu-fallback": "cpu fallback", "no-fit": "no fit",
};

/** Collapse a model's per-backend verdicts to one worst-case badge per backend
 *  (E8 resolves 3 ethos_u configs → show one ethos_u at its worst verdict). */
function worstByBackend(backends?: BackendFit[]): { backend: string; verdict: string }[] {
  const worst = new Map<string, string>();
  for (const b of backends ?? []) {
    const prev = worst.get(b.backend);
    if (prev === undefined || (FIT_SEVERITY[b.verdict] ?? 0) > (FIT_SEVERITY[prev] ?? 0)) {
      worst.set(b.backend, b.verdict);
    }
  }
  return [...worst.entries()].map(([backend, verdict]) => ({ backend, verdict }));
}
```

Import `BackendFit`, `ModelFit` from `./useModels`. In the component, pull `fits`, `checkingFit`, `checkFit` from `useModels()`. Add a toolbar button:

```tsx
<Button onClick={checkFit} disabled={checkingFit}>
  {checkingFit ? "Checking fit…" : "Check fit"}
</Button>
```

In `ModelRow` (pass the model's `ModelFit | undefined` in as a prop, looked up by `name` from `fits`), render below the artifact badge:

```tsx
{fit?.error ? (
  <span className={styles.badge} data-variant="err" title={fit.error}>check error</span>
) : (
  worstByBackend(fit?.backends).map(({ backend, verdict }) => (
    <Badge
      key={backend}
      variant={FIT_VARIANT[FIT_SEVERITY[verdict] ?? 0]}
      label={`${backend}: ${FIT_LABEL[verdict] ?? verdict}`}
    />
  ))
)}
{fit?.suggestion && <p className={styles.suggestion}>{fit.suggestion}</p>}
```

Wire `fit` from the parent list: `const fit = fits.find((f) => f.name === model.name);` and pass it into `<ModelRow ... fit={fit} />`. Add a `.suggestion` CSS rule to `ModelsView.module.css` (small, muted text) mirroring an existing muted style.

- [ ] **Step 3: Compile the webview**

Run: `pnpm run compile 2>&1 | tail -15`
Expected: clean (`tsc --build` + `vp build` both succeed).

- [ ] **Step 4: Commit**

```bash
git add packages/alp-webview/src/features/models/useModels.ts packages/alp-webview/src/features/models/ModelsView.tsx packages/alp-webview/src/features/models/ModelsView.module.css
git commit -m "feat(models): render per-model pre-flight fit badges in the panel"
```

---

## Task 5: e2e — real envelope round-trip through the extension path

**Files:**
- Test harness: scratch file outside the repo (not committed)

**Interfaces:** none (verification only).

- [ ] **Step 1: Full gate**

Run: `pnpm run compile && pnpm test 2>&1 | tail -20`
Expected: all `node --test test/*.test.js` green, including the new `toModelFitData` tests.

- [ ] **Step 2: e2e — drive the REAL adapter path against a built `tan` with board-mode check**

The controller builds `tan` (with slices 1b + 1b-board) and runs a harness that injects a node `spawn` into the extension's real `runAlpAsync` → `toModelFitData`, exactly like the existing `ext-e2e-harness.js`. Assert: an ok envelope → `ok:true`, `sku:"E1M-AEN801"`, `models[0].backends` non-empty with a cpu `fits`; a binary-missing outcome → `ok:false` and NOT a false "update tan". (This step is executed by the controller after Task 4, not inside a subagent — it needs the cross-repo `tan` binary + alp-sdk checkout.)

- [ ] **Step 3: Commit (if the harness surfaced any fix)**

Only if Step 2 required a code change; otherwise nothing to commit.

---

## Self-Review

- **Spec coverage** (roadmap §3.5 extension + §5 success #4): fit badge per SoM backend, shown before build, on refresh + on-demand → Tasks 3+4. Click-to-detail (SRAM bar / op-coverage drill-down) is a follow-on; the MVP shows the worst-verdict badge + suggestion + est numbers available in the payload. ✓
- **Placeholder scan:** all message/service/panel code complete; the webview JSX gives concrete code but defers pixel styling to the implementer matching the existing `ModelsView` component — flagged, not a blank.
- **Type consistency:** `ModelFitDataMessage` fields identical across messages.ts, types.ts, service.ts, and useModels' `fitData` action; `BackendFit`/`ModelFit` match the alp `BackendResult`/board-mode payload keys; `checkModelFit` posted by the webview is handled by the panel's `onMessage`.
- **Thin-extension check:** the extension adds zero verdict/board logic — `checkFit` shells `tan model check --board`, `toModelFitData` only reshapes the envelope. ✓
