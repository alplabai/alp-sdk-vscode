# Models Panel — Zoo Gallery (Slice 2c) Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes. All commands run from the worktree root.

**Goal:** A "Model zoo" section in the Models panel — browse curated zoo entries (via `tan model zoo --board`), each marked "runs on your SoM" (from the board's `som.sku`), with a one-click **Add** (`tan model add`) that fetches the source + appends it to `board.yaml`.

**Architecture:** Same thin shape as the fit/prep/measure slices already in this branch. Webview posts `requestZoo`/`addFromZoo`; the panel shells `tan model zoo --board board.yaml` / `tan model add <id> --board board.yaml` via `runAlpCommand`; `toZooData`/`toZooAddResult` (pure service) reshape the envelopes; the webview renders entry cards. NO zoo logic in the extension — `tan`/alp-sdk own it.

**Tech Stack:** TypeScript (`strict`), React 19 webview, `node:test`. Gates: `pnpm run compile` + `pnpm test`.

## Global Constraints

- **Keep the extension thin** — shell `tan model zoo|add --board` + reshape. No zoo/fetch logic in `src/`.
- **Envelope shapes** — `tan model zoo --board --format json` → `data:{entries:[{id,task,description,license,validated_soms,runs_here}]}`; `tan model add <id> --board --format json` → `data:{added,source,from}`. On failure `ok:false` + `model.failed` issue.
- **Started-ack for Add (the 3c lesson):** an `zooAddStarted` message sets an `adding` flag; the webview poster does NOT set it optimistically. Add's result clears it. (Add mutates `board.yaml` + fetches — treat like prep.)
- **After a successful Add, refresh both** the model list (the new model appears) and the zoo (idempotence — the entry may now be present). Call `refresh()` + `refreshZoo()` after `zooAddResult` ok.
- **Never-silent failure** — render `!ok` zoo/add results via `IssuesBanner` with a synthesized fallback issue when `issues.length===0`.
- **Mirror message types manually** (messages.ts ↔ types.ts); `PROTOCOL_VERSION` unchanged (additive).
- **Reuse `cliFailureMessage`**; use `MODEL_BUILD_TIMEOUT_MS` for Add (a url fetch can be slow).
- **Branch:** `feat/models-panel` (extends #310). Do NOT merge. NO Claude/AI attribution. Public-repo hygiene — NO local absolute paths in committed files.

---

## File Structure

- **Modify** `src/ideHub/messages.ts` — `RequestZooMessage`, `AddFromZooMessage` (up); `ZooDataMessage`, `ZooAddStartedMessage`, `ZooAddResultMessage` (down); unions.
- **Modify** `packages/alp-webview/src/types.ts` — mirror all five + unions.
- **Modify** `src/models/service.ts` — `toZooData`, `toZooAddResult`.
- **Modify** `src/models/panel.ts` — `refreshZoo()`, `addFromZoo(id)`, message cases; call `refreshZoo()` from `refresh()`.
- **Modify** `packages/alp-webview/src/features/models/useModels.ts` — zoo state + handlers + posters.
- **Modify** `packages/alp-webview/src/features/models/ModelsView.tsx` — "Model zoo" section (cards + Add buttons).
- **Test** `test/models.service.test.js` — `toZooData` + `toZooAddResult` unit tests.

---

## Task 1: Message types (both sides)

**Interfaces:**
- `RequestZooMessage {type:"requestZoo"}`, `AddFromZooMessage {type:"addFromZoo"; id:string}` (webview→ext).
- `ZooAddStartedMessage {type:"zooAddStarted"}` (ext→webview).
- `ZooDataMessage {type:"zooData"; ok:boolean; entries:{id:string;task:string;description:string;license:string;validated_soms:string[];runs_here:boolean|null}[]; issues:{code:string;severity:string;message:string}[]}`.
- `ZooAddResultMessage {type:"zooAddResult"; ok:boolean; added?:string; issues:{code:string;severity:string;message:string}[]}`.

- [ ] **Step 1:** Add all five interfaces in `src/ideHub/messages.ts` (near `ModelFitDataMessage`). Add `ZooDataMessage | ZooAddStartedMessage | ZooAddResultMessage` to `ExtToWebviewMessage`; `RequestZooMessage | AddFromZooMessage` to `WebviewToExtMessage`.
- [ ] **Step 2:** Mirror all five in `packages/alp-webview/src/types.ts` + the same unions.
- [ ] **Step 3:** `pnpm run compile 2>&1 | tail -12` — clean.
- [ ] **Step 4:** Commit: `git add src/ideHub/messages.ts packages/alp-webview/src/types.ts && git commit -m "feat(models): add zoo gallery protocol messages"`.

---

## Task 2: `toZooData` + `toZooAddResult` service + tests

**Interfaces:** `toZooData(outcome: CliOutcome): ZooDataMessage`; `toZooAddResult(outcome: CliOutcome): ZooAddResultMessage`.

- [ ] **Step 1:** Failing tests in `test/models.service.test.js`:

```js
test("toZooData: ok -> entries passthrough", () => {
  const outcome = { exitCode: 0, message: "",
    envelope: { command: "model", ok: true, exitCode: 0, project: {},
      data: { entries: [{ id: "example-tiny", task: "example", description: "d",
        license: "Apache-2.0", validated_soms: ["E1M-AEN801"], runs_here: true }] },
      issues: [] } };
  const msg = toZooData(outcome);
  assert.equal(msg.ok, true);
  assert.equal(msg.entries.length, 1);
  assert.equal(msg.entries[0].runs_here, true);
});

test("toZooData: null envelope -> ok:false + real cause", () => {
  const msg = toZooData({ exitCode: -1, message: "tan binary not found", envelope: null });
  assert.equal(msg.ok, false);
  assert.equal(msg.entries.length, 0);
  assert.ok(msg.issues.some((i) => i.message.includes("tan binary not found")));
});

test("toZooAddResult: ok -> added passthrough", () => {
  const outcome = { exitCode: 0, message: "",
    envelope: { command: "model", ok: true, exitCode: 0, project: {},
      data: { added: "example-tiny", source: "models/example-tiny.tflite", from: "example-tiny" },
      issues: [] } };
  const msg = toZooAddResult(outcome);
  assert.equal(msg.ok, true);
  assert.equal(msg.added, "example-tiny");
});

test("toZooAddResult: !ok -> surfaces model.failed", () => {
  const msg = toZooAddResult({ exitCode: 1, message: "x",
    envelope: { command: "model", ok: false, exitCode: 1, project: {}, data: null,
      issues: [{ code: "model.failed", severity: "error", message: "error: already has a model named X" }] } });
  assert.equal(msg.ok, false);
  assert.ok(msg.issues.some((i) => i.code === "model.failed"));
});
```

Import `toZooData`/`toZooAddResult` at the top.

- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Implement in `src/models/service.ts` (mirror `toModelFitData`/`toModelPrepResult`):

```ts
export function toZooData(outcome: CliOutcome): ZooDataMessage {
  const env = outcome.envelope;
  if (env === null || !env.ok) {
    const issues: AlpIssue[] = [...(env?.issues ?? [])];
    if (env === null) {
      issues.push({ code: "zoo.cli-error", severity: "error", message: cliFailureMessage(outcome) });
    }
    return { type: "zooData", ok: false, entries: [], issues };
  }
  const data = env.data as { entries?: ZooDataMessage["entries"] };
  return { type: "zooData", ok: true, entries: data.entries ?? [], issues: env.issues };
}

export function toZooAddResult(outcome: CliOutcome): ZooAddResultMessage {
  const env = outcome.envelope;
  if (env === null || !env.ok) {
    const issues: AlpIssue[] = [...(env?.issues ?? [])];
    if (env === null) {
      issues.push({ code: "zooAdd.cli-error", severity: "error", message: cliFailureMessage(outcome) });
    }
    return { type: "zooAddResult", ok: false, issues };
  }
  const data = env.data as { added?: string };
  return { type: "zooAddResult", ok: true, added: data.added, issues: env.issues };
}
```

- [ ] **Step 4:** `pnpm run compile && node --test test/models.service.test.js 2>&1 | tail -8` — green.
- [ ] **Step 5:** Commit: `git commit -m "feat(models): toZooData + toZooAddResult"`.

---

## Task 3: Panel adapter — `refreshZoo()` + `addFromZoo()`

- [ ] **Step 1:** Import `toZooData, toZooAddResult` (extend `./service` import).
- [ ] **Step 2:** Message cases in `onMessage` (beside `checkModelFit`):

```ts
      case "requestZoo":
        void this.refreshZoo();
        break;
      case "addFromZoo":
        void this.addFromZoo(msg.id);
        break;
```

- [ ] **Step 3:** Methods (after `checkFit`):

```ts
  private async refreshZoo(): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const { outcome } = await runAlpCommand(this.context, ["model", "zoo", "--board", "board.yaml"], cwd);
    this.post(toZooData(outcome));
  }

  private async addFromZoo(id: string): Promise<void> {
    this.post({ type: "zooAddStarted" });
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Alp: Adding ${id} from zoo`, cancellable: false },
      async () => {
        const { outcome } = await runAlpCommand(this.context, ["model", "add", id, "--board", "board.yaml"], cwd, { timeoutMs: MODEL_BUILD_TIMEOUT_MS });
        this.post(toZooAddResult(outcome));
        if (outcome.envelope && outcome.envelope.ok) {
          await this.refresh();       // the new model now appears in the list
          await this.refreshZoo();
        }
      },
    );
  }
```

- [ ] **Step 4:** Call `void this.refreshZoo();` at the end of `refresh()` (so the gallery loads on panel open, beside `checkFit`).
- [ ] **Step 5:** `pnpm run compile 2>&1 | tail -12` — clean. Commit: `git commit -m "feat(models): panel refreshZoo + addFromZoo — shell tan model zoo/add"`.

---

## Task 4: Webview — zoo gallery section

- [ ] **Step 1: `useModels.ts`** — narrowed `ZooEntryView {id;task;description;license;validated_soms:string[];runs_here:boolean|null}`; state `zoo: ZooEntryView[]; zooOk:boolean; zooIssues; adding:boolean;` (init `[]`, `true`, `[]`, `false`). Actions `{type:"zooData";ok;entries;issues}`, `{type:"addStart"}`, `{type:"addDone"}`. Reducer: `zooData` → store entries/ok/issues; `addStart` → adding:true; `addDone` → adding:false. `window` handlers: `zooData` → dispatch zooData; `zooAddStarted` → addStart; `zooAddResult` → addDone (+ the panel already re-posts `zooData` after a successful add). Posters: `requestZoo()` → `postMessage({type:"requestZoo"})`; `addFromZoo(id)` → `postMessage({type:"addFromZoo", id})` (NO optimistic adding flag). Return `zoo, zooOk, zooIssues, adding, requestZoo, addFromZoo`.

- [ ] **Step 2: `ModelsView.tsx`** — a "Model zoo" `<section>` (below the models table) rendering `zoo` entries as cards: each shows `task` + `description` + a runs-here badge (`runs_here === true` → `<Badge variant="ok" label="runs here" />`; `=== false` → `<Badge variant="warn" label="not validated here" />`; `null` → nothing) + an `<Button disabled={adding} onClick={() => addFromZoo(entry.id)}>Add</Button>`. When `!zooOk`, render the issues via `IssuesBanner` (synthesize a fallback issue when `zooIssues.length===0`). Reuse `Badge`/`styles`.

- [ ] **Step 3:** `pnpm run compile 2>&1 | tail -15` — clean. Commit: `git commit -m "feat(models): Model zoo gallery section (browse + one-click Add)"`.

---

## Task 5: Full gate

- [ ] `pnpm run compile && pnpm test 2>&1 | tail -12` — all green. `pnpm run format:check`; if flagged, `pnpm run format` + commit `style(models): prettier`.

---

## Self-Review

- **Spec coverage** (roadmap §4 sub-project 2, extension): gallery filtered to "runs on your SoM" (via `runs_here`) + one-click Add → Tasks 3+4. Full "filter to only runs-here" toggle + example-app scaffold = follow-ons; the MVP shows all entries badged (honest — doesn't hide non-fitting). ✓
- **3c lessons applied:** started-ack for Add (no optimistic flag → no stuck button); never-silent failures. ✓
- **Thin:** zero zoo/fetch logic in `src/` — shell + reshape. ✓
- **Hygiene:** no local absolute paths in this doc or the code.
- **Type consistency:** `ZooEntryView` mirrors `ZooDataMessage.entries[]`; `addFromZoo(id)` payload matches `AddFromZooMessage`.
