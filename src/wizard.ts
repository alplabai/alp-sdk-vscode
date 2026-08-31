// SPDX-License-Identifier: Apache-2.0

import { planScaffoldArgv } from "@alp-sdk/core/wizard/scaffoldArgv";
import {
  classifyScaffoldRefusal,
  isScaffoldNoOp,
  narrowScaffoldResult,
  ScaffoldRefusal,
  ScaffoldResult,
} from "@alp-sdk/core/wizard/scaffoldPayload";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { runAlpCommand } from "./alpCli/vscodeAdapter";
import { CANCELLED, runAlpWithProgress } from "./loader";
import {
  isCancellation,
  planCliOutcome,
  planConfirm,
  planFailure,
  planPrecondition,
  planSuccess,
} from "./notify/service";
import { notify } from "./notify/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";
import { log, showOutput } from "./util";

const FIRST_RUN_PROMPT_KEY_PREFIX = "alp.firstRunWizardPromptShown";

/** A module template, exactly as `tan explain` reports it. Nothing in this
 *  file adds to the catalogue or renames an entry — #601 is what happens when
 *  a second copy of tan's own table lives here. */
interface ModuleTemplate {
  /** `tan explain`'s `available.moduleTemplates[]` id, e.g. `sensor-driver`. */
  id: string;
  /** `tan explain --template <id>`'s `summary`, or the id when it sent none. */
  title: string;
  /** That explain's `details[0]`, or "" when it sent none. */
  description: string;
}

// New Project is owned by NewProjectFlowPanel (the `alp.newProjectWizard`
// command, registered in extension.ts) which scaffolds real, v0.6-conformant
// projects via `tan init`. This module now only owns module scaffolding into an
// existing project (`alp.scaffoldModule`) — the legacy QuickPick project wizard
// was retired (it duplicated the command id and emitted pre-v0.6 board.yaml).
export function registerProjectWizardCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return vscode.commands.registerCommand("alp.scaffoldModule", () =>
    runModuleScaffoldWizard(context),
  );
}

/**
 * Offer the New Project flow on a first open with no board.yaml.
 *
 * Runs asynchronously after activation (`void maybeOfferFirstRunWizard`) —
 * never throws, for the same reason `maybeOfferSetupPanel` doesn't: the
 * `workspaceState.update` and the unanswered toast below are both pending
 * main-thread RPCs, and a window closing rejects them with a CancellationError.
 * Unguarded that is an unhandled rejection in the extension host naming
 * nothing. Nothing failed — the offer was abandoned along with the window, and
 * the next activation makes it again (the key is only recorded once the write
 * lands).
 */
export async function maybeOfferFirstRunWizard(
  context: vscode.ExtensionContext,
): Promise<void> {
  const project = collectProjectContext();
  if (!project.workspaceRoot || !project.boardYamlPath) {
    return;
  }
  if (fs.existsSync(project.boardYamlPath)) {
    return;
  }

  const workspaceKey = workspacePromptKey(project.workspaceRoot);
  if (context.workspaceState.get<boolean>(workspaceKey, false)) {
    return;
  }

  try {
    await context.workspaceState.update(workspaceKey, true);
    // Audit verdict `keep`: the text and the single action are already right, so
    // the plan is spelled out rather than built by `planPrecondition("noBoardYaml")`
    // — that builder retitles the offer and adds a second button. `newProject`
    // carries a `run` (alp.newProjectWizard), so the presenter executes it and the
    // old branch-on-title disappears with no change in what the user sees.
    await notify({
      severity: "info",
      channel: "toast",
      message: "Alp: No board.yaml found. Create a new project?",
      actions: [{ id: "newProject" }],
    });
  } catch (err) {
    if (isCancellation(err)) {
      log("[wizard] first-run offer abandoned, window closing", "info");
      return;
    }
    log(`[wizard] first-run offer failed: ${String(err)}`, "warn");
  }
}

/**
 * Scaffold a module into the open project, by calling `tan scaffold` (#601).
 *
 * WHAT CHANGED AND WHY. This flow used to build the module's header, source and
 * README itself, from a TypeScript re-implementation of `tan scaffold` that had
 * drifted from the command it copied: tan's README carries a `## Wiring`
 * section naming the two `CMakeLists.txt` edits without which the module is
 * never compiled, and the port emitted `## Notes` and stopped. Everything
 * around that section was byte-identical, so a customer scaffolding from VS
 * Code got a module that silently never built, and nothing told them why.
 *
 * The port is gone rather than patched. Patching the text closes this symptom
 * and leaves the mechanism — a second, un-gated copy of a generator tan owns —
 * to miss the next upstream addition the same way.
 *
 * THE ORDER IS LOAD-BEARING. Preview first (`--preview` writes nothing), then a
 * modal naming every file, then the write. `--force` is on neither of those: it
 * REPLACES a file whose contents differ, with no diff and no backup, so it is
 * reached only through the second confirm below, which tan itself triggers by
 * refusing with `scaffold.would-overwrite`.
 */
async function runModuleScaffoldWizard(
  context: vscode.ExtensionContext,
): Promise<void> {
  const project = collectProjectContext();
  if (!project.workspaceRoot) {
    // A precondition, not a failure: warning severity + the Open Folder action
    // (alp.switchWorkspace) instead of a red toast whose only option is dismissal.
    await notify(
      planPrecondition("noWorkspace", { operation: "scaffold a module" }),
    );
    return;
  }
  const projectRoot = project.workspaceRoot;

  const templates = await fetchModuleTemplates(context, projectRoot);
  if (templates === null) return;

  const template = await pickModuleTemplate(templates);
  if (!template) {
    return;
  }

  const moduleName = await vscode.window.showInputBox({
    title: "Alp: Module name",
    prompt: "Enter a module name (letters, numbers, separators are allowed).",
    placeHolder: suggestedModuleName(template.id),
    value: suggestedModuleName(template.id),
    ignoreFocusOut: true,
    // A fast local answer to the one refusal that is purely about this input
    // box, so the customer is not sent through a spawn to be told. tan stays
    // the authority: a name that gets past this and normalizes to nothing
    // comes back as `scaffold.invalid-name`, handled below.
    validateInput: (value) => {
      return /[a-zA-Z0-9]/.test(value)
        ? null
        : "Module name must include at least one alphanumeric character.";
    },
  });
  if (!moduleName) {
    return;
  }

  // ── 1. Plan. `--preview` writes nothing. ──────────────────────────────────
  const preview = await runScaffold(
    context,
    {
      projectRoot,
      templateId: template.id,
      moduleName,
      preview: true,
      force: false,
    },
    "Previewing the module scaffold",
    "previewing the module scaffold…",
  );
  if (preview.kind !== "ok") {
    await reportScaffoldRefusal(preview, "Previewing the module scaffold");
    return;
  }

  if (isScaffoldNoOp(preview.result)) {
    // Same channel as this function's success path below (the status bar): a
    // transient no-op verdict is not worth a notification the user must dismiss.
    await notify(
      planSuccess(
        "Alp: module scaffold matches current files. Nothing to write.",
      ),
    );
    return;
  }

  // Stays MODAL: this gates a multi-file write, and a corner toast is easy to
  // miss or auto-dismiss — the blocking dialog is what guarantees the user saw
  // the question. The file list is tan's own `fileChanges[]`, so what the
  // dialog names is what tan will actually write; the previous flow opened a
  // markdown document rendered by the retired port, which is precisely the
  // text that had gone stale. The pick still gates the write: `applyChanges`
  // has no `run` in the presenter's table, so `notify` hands the id back
  // instead of swallowing it.
  const applyAction = await notify(
    planConfirm({
      message: `Alp: apply ${preview.result.fileChanges.length} module file change(s)?`,
      modalDetail: describeChanges(preview.result),
      confirm: { id: "applyChanges" },
    }),
  );
  if (applyAction !== "applyChanges") {
    return;
  }

  // ── 2. Write. Still no `--force`. ─────────────────────────────────────────
  let write = await runScaffold(
    context,
    {
      projectRoot,
      templateId: template.id,
      moduleName,
      preview: false,
      force: false,
    },
    "Scaffolding the module",
    "scaffolding the module…",
  );

  // ── 3. tan refused because a file on disk differs from what it generates. ──
  //      This is the ONLY route to `--force`, and it is gated by a second modal
  //      that names those files. Reaching it means a previously scaffolded file
  //      was edited: replacing it loses that edit outright, with no diff and no
  //      backup (measured on the pinned tan 0.6.0).
  if (write.kind === "refused" && write.refusal.kind === "would-overwrite") {
    const overwriteAction = await notify(
      planConfirm({
        message: "Alp: replace files that differ from the module template?",
        modalDetail: describeOverwrite(write.result, write.refusal),
        confirm: { id: "applyChanges" },
        severity: "error",
      }),
    );
    if (overwriteAction !== "applyChanges") {
      return;
    }
    write = await runScaffold(
      context,
      {
        projectRoot,
        templateId: template.id,
        moduleName,
        preview: false,
        force: true,
      },
      "Scaffolding the module",
      "replacing the module files…",
    );
  }

  if (write.kind !== "ok") {
    await reportScaffoldRefusal(write, "Scaffolding the module");
    return;
  }

  await openScaffoldedSource(projectRoot, write.result);

  vscode.window.setStatusBarMessage(
    `Alp: module scaffold wrote ${write.result.written.length} file(s), unchanged ${write.result.unchanged.length}.`,
    7000,
  );
}

/**
 * Build the module-template picker from the CLI's own catalogue: `tan explain`
 * lists the ids, then a per-id explain gives the title and blurb — the same
 * shape `NewProjectFlowPanel.fetchTemplates` uses for project templates.
 *
 * Returns `null` when the customer should see nothing more (already notified),
 * which is NOT the same as an empty list.
 *
 * The whole loop sits inside ONE progress notification rather than using
 * `runAlpWithProgress` per call, which would stack one popup per template.
 */
async function fetchModuleTemplates(
  context: vscode.ExtensionContext,
  cwd: string,
): Promise<ModuleTemplate[] | null> {
  const operation = "Loading the module templates";
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Alp: loading module templates…",
      cancellable: false,
    },
    async () => {
      const overview = await runAlpCommand(context, ["explain"], cwd, {
        interactive: true,
      });
      if (!overview.outcome.envelope) {
        // An unresolvable or failed CLI returns a null-envelope outcome rather
        // than throwing. Without surfacing it the picker opens empty with no
        // trace — issue #129's shape, for a different command.
        await notify(planCliOutcome(overview.outcome, { operation }));
        return null;
      }
      const ids = moduleTemplateIds(overview.outcome.envelope.data);
      if (ids.length === 0) {
        await notify(
          planFailure({
            operation,
            cause:
              "The tan CLI reported no module templates, so there is nothing to scaffold.",
            actions: [{ id: "runDoctor" }],
          }),
        );
        return null;
      }

      const templates: ModuleTemplate[] = [];
      for (const id of ids) {
        const detail = await runAlpCommand(
          context,
          ["explain", "--template", id],
          cwd,
          { interactive: true },
        );
        const data = detail.outcome.envelope?.data;
        templates.push({
          id,
          title: explainString(data, "summary") ?? id,
          description: explainDetail(data) ?? "",
        });
      }
      return templates;
    },
  );
}

/** `tan explain`'s `data.available.moduleTemplates[]`, narrowed. Anything that
 *  is not a list of strings answers `[]` — never a coerced entry, which would
 *  reach `--template` and come straight back as `scaffold.invalid-template`. */
function moduleTemplateIds(raw: unknown): string[] {
  if (typeof raw !== "object" || raw === null) return [];
  const available = (raw as Record<string, unknown>).available;
  if (typeof available !== "object" || available === null) return [];
  const ids = (available as Record<string, unknown>).moduleTemplates;
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === "string");
}

function explainString(raw: unknown, key: string): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function explainDetail(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const details = (raw as Record<string, unknown>).details;
  if (!Array.isArray(details)) return null;
  const first = details[0];
  return typeof first === "string" && first.length > 0 ? first : null;
}

/** What one `tan scaffold` spawn produced. `failed` and `cancelled` mean the
 *  customer has already been told; `refused` means tan answered with a code
 *  this extension can act on. */
type ScaffoldRun =
  | { kind: "ok"; result: ScaffoldResult }
  | { kind: "refused"; refusal: ScaffoldRefusal; result: ScaffoldResult | null }
  | { kind: "failed" }
  | { kind: "cancelled" };

interface ScaffoldRunInput {
  projectRoot: string;
  templateId: string;
  moduleName: string;
  preview: boolean;
  force: boolean;
}

/**
 * Run one `tan scaffold` pass and read its envelope.
 *
 * `cwd` is the project root, ALWAYS — the same value `--project` carries.
 * Measured on the pinned tan 0.6.0, a spawn with neither answers
 * `project.root: "."`, which for an extension-host child is whatever directory
 * VS Code inherited; #605 is three other spawns already in that state, and this
 * one does not join them.
 *
 * `issues[]` reaches the channel on EVERY outcome, including `ok: true` —
 * dropping an advisory on the success path is the #611 defect, and #477 is what
 * it costs.
 */
async function runScaffold(
  context: vscode.ExtensionContext,
  input: ScaffoldRunInput,
  operation: string,
  progressTitle: string,
): Promise<ScaffoldRun> {
  const argv = planScaffoldArgv(input);
  const res = await runAlpWithProgress(
    context,
    argv,
    `Alp: ${progressTitle}`,
    input.projectRoot,
  );
  if (res === CANCELLED) {
    await notify(
      planSuccess("Alp: module scaffold cancelled.", { timeoutMs: 3000 }),
    );
    return { kind: "cancelled" };
  }

  const { outcome } = res;
  const envelope = outcome.envelope;
  if (!envelope) {
    // planCliOutcome splits "tan was never installed" (Install it) from "tan is
    // there but broken/misconfigured" (Settings/Doctor) off outcome.unavailable,
    // and keeps the errno/path in the channel detail.
    await notify(planCliOutcome(outcome, { operation }));
    return { kind: "failed" };
  }
  logIssues(envelope.issues);

  const result = narrowScaffoldResult(envelope.data);

  if (!envelope.ok) {
    const refusal = classifyScaffoldRefusal(envelope.issues);
    if (refusal) {
      return { kind: "refused", refusal, result };
    }
    // A refusal this extension has no guidance for keeps tan's own reporting
    // rather than being wrapped in a wrong sentence — planCliOutcome puts every
    // issue on the plan behind a "Show issues" action.
    await notify(planCliOutcome(outcome, { operation }));
    return { kind: "failed" };
  }

  if (!result) {
    // An `ok: true` whose payload this extension cannot read is NOT a success.
    // Reporting it as one is the `written ?? []` failure pinned in
    // test/ideHub.materialiseGuard.test.js: a renamed field announced
    // "Materialised 0 file(s)" and the customer built against whatever was
    // already on disk.
    await notify(
      planFailure({
        operation,
        cause:
          "The tan CLI reported success but returned a scaffold result this extension cannot read — no file list came back, so what was written is unknown.",
        actions: [{ id: "updateCli" }, { id: "runDoctor" }],
      }),
    );
    return { kind: "failed" };
  }

  return { kind: "ok", result };
}

/** Report a non-ok `runScaffold`. `failed` and `cancelled` were already told. */
async function reportScaffoldRefusal(
  run: ScaffoldRun,
  operation: string,
): Promise<void> {
  if (run.kind !== "refused") return;
  const { refusal } = run;
  await notify(
    planFailure({
      operation,
      // tan's own sentence, verbatim — it names the template or the offending
      // input, which no table here could — with this extension's route forward
      // appended. Never parsed.
      cause: `${refusal.message ?? "The tan CLI refused the module scaffold."} ${scaffoldAdvice(refusal)}`,
      detail: `tan reported ${refusal.code}`,
    }),
  );
}

function scaffoldAdvice(refusal: ScaffoldRefusal): string {
  switch (refusal.kind) {
    case "invalid-name":
      return 'Re-run "Alp: Scaffold module" and enter a name containing at least one letter or digit.';
    case "invalid-template":
      return 'Re-run "Alp: Scaffold module" and pick a template again — the list is read from the tan CLI each time, so a stale one refreshes.';
    case "would-overwrite":
      // Reached only when the SECOND, forced run is refused again, which means
      // the files changed between the two spawns.
      return 'The files changed while the scaffold was running. Re-run "Alp: Scaffold module".';
  }
}

/** The modal body for the first confirm: every path tan named, with its kind. */
function describeChanges(result: ScaffoldResult): string {
  const lines = result.fileChanges.map(
    (change) => `${change.kind.toUpperCase()}: ${change.relativePath}`,
  );
  return [
    "The tan CLI will write these files into the open project:",
    "",
    ...lines,
  ].join("\n");
}

/**
 * The modal body for the overwrite confirm. Names ONLY the paths that are not
 * `unchanged`, and says plainly what replacing them costs — reaching this
 * dialog means those files differ from the template, which for a previously
 * scaffolded module means they were edited.
 */
function describeOverwrite(
  result: ScaffoldResult | null,
  refusal: ScaffoldRefusal,
): string {
  const paths = (result?.fileChanges ?? [])
    .filter((change) => change.kind !== "unchanged")
    .map((change) => change.relativePath);
  const named =
    paths.length > 0
      ? paths
      : // tan refused without naming the files. Say so, rather than showing an
        // empty list that reads as "nothing will be replaced".
        ["(the tan CLI did not name the files)"];
  return [
    refusal.message ?? "One or more files would be overwritten.",
    "",
    "These files will be REPLACED with the template's contents. Any edits made",
    "in them are lost, and this cannot be undone from the editor:",
    "",
    ...named,
  ].join("\n");
}

/**
 * Open the module source tan wrote, so the customer lands in the file they are
 * about to edit.
 *
 * The path is tan's, taken from `written[]` — never rebuilt from the module
 * name and an assumed `src/modules/<name>/<name>.c` layout, which is the same
 * class of local copy #601 is removing. A run that wrote no `.c` (every file
 * already up to date) opens nothing, which is correct.
 */
async function openScaffoldedSource(
  projectRoot: string,
  result: ScaffoldResult,
): Promise<void> {
  const source = result.written.find((rel) => rel.endsWith(".c"));
  if (!source) return;
  try {
    const doc = await vscode.workspace.openTextDocument(
      vscode.Uri.file(path.join(projectRoot, source)),
    );
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (err) {
    if (isCancellation(err)) return;
    // The files ARE written; only the convenience of opening one failed. Say so
    // in the channel rather than turning a successful scaffold into an error
    // toast the customer cannot act on.
    log(`[wizard] could not open ${source}: ${String(err)}`, "warn");
  }
}

function logIssues(issues: { severity: string; message: string }[]): void {
  if (issues.length === 0) return;
  showOutput();
  for (const issue of issues) {
    log(`[scaffold] ${issue.severity}: ${issue.message}`);
  }
}

function workspacePromptKey(workspaceRoot: string): string {
  return `${FIRST_RUN_PROMPT_KEY_PREFIX}:${workspaceRoot}`;
}

async function pickModuleTemplate(
  templates: ModuleTemplate[],
): Promise<ModuleTemplate | null> {
  const pick = await vscode.window.showQuickPick(
    templates.map((template) => ({
      label: template.title,
      description: template.description,
      detail: `id: ${template.id}`,
      template,
    })),
    {
      title: "Alp: Scaffold module template",
      placeHolder:
        "Select the module template for existing project scaffolding",
      ignoreFocusOut: true,
    },
  );
  return pick?.template ?? null;
}

/**
 * A pre-filled name, DERIVED from the template id rather than looked up.
 *
 * The retired port carried a four-entry `templateId → suggestion` table
 * (`sensor-driver → sensor_input`, and three more). That table is the shape
 * #601 is removing: a local copy of tan's catalogue that goes stale the moment
 * tan ships a fifth template. Deriving it means a template this extension has
 * never heard of still gets a sensible default.
 */
function suggestedModuleName(templateId: string): string {
  return templateId.replace(/[^a-zA-Z0-9]+/g, "_");
}
