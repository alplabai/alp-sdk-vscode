// SPDX-License-Identifier: Apache-2.0
//
// Generate + validate commands. Both delegate to the native CLI:
// `alp generate [--target <emit> | --all]` and `alp validate`. The SDK's Python
// loader/validator run inside the CLI; this file maps the JSON envelope onto a
// NotificationPlan and hands it to the one presenter (src/notify/) — severity
// comes from the classified outcome, never from a hand-picked show*Message
// here. The cheap board.yaml-exists pre-check stays in-process for a precise
// "not found" message; per-edit board.yaml diagnostics remain the LSP's job
// (src/diagnostics.ts), untouched.

import * as path from "path";
import * as vscode from "vscode";

import { EmitMode } from "@alp-sdk/core/loader/models";
import {
  classifyMigrateCheck,
  MIGRATE_REFUSED_MESSAGE,
} from "@alp-sdk/core/validation/migrateCheck";
import {
  describeGenerationFailure,
  getGenerationTargetSupport,
} from "@alp-sdk/core/loader/service";
import { runAlpCommand } from "./alpCli/vscodeAdapter";
import {
  boardYamlExists,
  collectLoaderWorkspaceContext,
  previewGeneratedFile,
} from "./loader/vscodeAdapter";
import { NotificationPlan } from "./notify/models";
import {
  planCliOutcome,
  planFailure,
  planPrecondition,
  planSuccess,
} from "./notify/service";
import { notify, notifyAsync } from "./notify/vscodeAdapter";
import { log, showOutput } from "./util";

interface GenerateData {
  targets: string[];
  written: string[];
  failed: string[];
}

/**
 * `envelope.data` is the one part of the envelope whose shape the CLI contract
 * does NOT fix, so a `tan` that omits a list must not throw a TypeError out of
 * the command handler — that surfaces as VS Code's own unbranded "command
 * failed" popup with the raw error, which is worse than any bad toast.
 */
function generateData(data: unknown): GenerateData {
  const d = (data ?? {}) as Partial<GenerateData>;
  return {
    targets: d.targets ?? [],
    written: d.written ?? [],
    failed: d.failed ?? [],
  };
}

function boardYamlMissing(): boolean {
  const project = collectLoaderWorkspaceContext();
  if (boardYamlExists(project.boardYamlPath)) return false;
  // First run, not a failure: a warning that carries New Project / Open Setup,
  // with the path kept off the sentence and in the channel-only detail.
  // Fire-and-forget — the caller is synchronous and must return its guard now.
  notifyAsync(
    planPrecondition("noBoardYaml", {
      detail: project.boardYamlPath
        ? `expected at ${project.boardYamlPath}`
        : "no board.yaml path resolved for this workspace",
      dedupeKey: "board-yaml-missing",
    }),
  );
  return true;
}

function logIssues(
  prefix: string,
  issues: { severity: string; message: string }[],
): void {
  if (issues.length === 0) return;
  showOutput();
  for (const issue of issues) {
    log(`[${prefix}] ${issue.severity}: ${issue.message}`);
  }
}

export type CliResult = Awaited<ReturnType<typeof runAlpCommand>>;
export const CANCELLED = Symbol("cancelled");

/**
 * Run an envelope command inside a cancellable progress notification. The
 * CancellationToken is bridged to an AbortSignal so pressing Cancel kills the
 * `tan` child (and its Python validator/loader, or -- for `bootstrap.ts`'s
 * win32 pre-flight -- the `tan bootstrap --no-pip --no-west --dry-run` probe)
 * instead of leaving it running. Killing that probe is safe precisely BECAUSE
 * of its `--dry-run`: without it the same SIGTERM could land mid-relocation of
 * the customer's alp-sdk checkout. Returns CANCELLED when the user cancels so the
 * caller skips its error toast. Exported: `bootstrap.ts` reuses this exact
 * `withProgress` + CancellationToken->AbortController bridge for its win32
 * pre-flight rather than duplicating it.
 *
 * `interactive: true` unconditionally: every caller (the `alp.generate*` /
 * `alp.validateBoardYaml` command-palette entries, and `bootstrap.ts`'s win32
 * pre-flight, itself only reached from the explicit "Install Dependencies"
 * command) is a direct user action, never a background re-derive.
 */
export async function runAlpWithProgress(
  context: vscode.ExtensionContext,
  args: string[],
  title: string,
  cwd?: string,
): Promise<CliResult | typeof CANCELLED> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title,
      cancellable: true,
    },
    async (_progress, token) => {
      const controller = new AbortController();
      const sub = token.onCancellationRequested(() => controller.abort());
      try {
        const result = await runAlpCommand(context, args, cwd, {
          signal: controller.signal,
          interactive: true,
        });
        return token.isCancellationRequested ? CANCELLED : result;
      } finally {
        sub.dispose();
      }
    },
  );
}

async function runLoader(
  context: vscode.ExtensionContext,
  emit: EmitMode,
): Promise<void> {
  if (boardYamlMissing()) return;
  const target = getGenerationTargetSupport(emit);
  const operation = `${target.displayName} generation`;

  const res = await runAlpWithProgress(
    context,
    ["generate", "--target", emit],
    `Generating ${target.displayName}…`,
  );
  if (res === CANCELLED) {
    await notify(
      planSuccess("Alp: generation cancelled.", { timeoutMs: 3000 }),
    );
    return;
  }
  const { outcome } = res;
  const envelope = outcome.envelope;
  if (!envelope) {
    // planCliOutcome splits "tan was never installed" (Install it) from "tan is
    // there but broken/misconfigured" (Settings/Doctor) off
    // outcome.unavailable, and keeps the errno/path in the channel detail.
    if ((await notify(planCliOutcome(outcome, { operation }))) === "retry") {
      await runLoader(context, emit);
    }
    return;
  }
  logIssues("generate", envelope.issues);

  const data = generateData(envelope.data);
  if (!envelope.ok) {
    showOutput();
    // Severity is the outcome's: an exit-2 validation failure stays a warning,
    // exit 3 gets Retry, the rest get Run Doctor. "Open board.yaml" is opt-in
    // per-caller (the planner cannot know whether a board.yaml is even in play
    // -- `tan init` also exits 2), and generation reads one, so it opts in.
    if (
      (await notify(
        planCliOutcome(outcome, {
          operation,
          extraActions: [{ id: "openBoardYaml" }],
        }),
      )) === "retry"
    ) {
      await runLoader(context, emit);
    }
    return;
  }
  if (data.failed.includes(emit)) {
    showOutput();
    // The CLI exited 0 yet listed this target as failed, so there is no
    // classified severity to inherit — "warning" is the honest floor for a
    // self-contradicting envelope, and it must not read as a clean run.
    await notify(
      planFailure({
        operation,
        cause: `${target.displayName} was not generated.`,
        severity: "warning",
        actions: [{ id: "runDoctor" }],
      }),
    );
    return;
  }

  const written = data.written[0];
  if (written && envelope.project.root) {
    await previewGeneratedFile(path.resolve(envelope.project.root, written));
    await notify(
      planSuccess(`Alp: wrote ${target.displayName} (${written})`, {
        timeoutMs: 5000,
      }),
    );
  }
}

async function runLoaderAll(context: vscode.ExtensionContext): Promise<void> {
  if (boardYamlMissing()) return;
  const operation = "Regenerating all formats";

  const res = await runAlpWithProgress(
    context,
    ["generate", "--all"],
    "Regenerating all formats…",
  );
  if (res === CANCELLED) {
    await notify(
      planSuccess("Alp: generation cancelled.", { timeoutMs: 3000 }),
    );
    return;
  }
  const { outcome } = res;
  const envelope = outcome.envelope;
  if (!envelope) {
    if ((await notify(planCliOutcome(outcome, { operation }))) === "retry") {
      await runLoaderAll(context);
    }
    return;
  }
  logIssues("generate", envelope.issues);

  const data = generateData(envelope.data);
  if (envelope.ok && data.failed.length === 0) {
    await notify(
      planSuccess(
        `Alp: regenerated all ${data.targets.length} formats (${data.written.join(", ")})`,
        { timeoutMs: 7000 },
      ),
    );
    return;
  }

  showOutput();
  await notify(
    planFailure({
      operation,
      // The per-target counts are the best customer text this command has, so
      // they stay in `message`; only the severity moves — an exit-3 write
      // failure is an error, not the yellow toast this site used to hardcode.
      //
      // `describeGenerationFailure`, NOT a `getGenerationTargetSupport` lookup.
      // This site used to read `getGenerationTargetSupport(emit as EmitMode)`,
      // which THROWS on an id the catalog does not hold — and `generate --all`
      // on the pinned tan runs nine targets against this extension's six.
      // `west-libraries`, `hw-info-h` and `os-topology` are the three of those
      // nine it cannot name (`zephyr-board`, which tan reports it can generate
      // but `--all` does not run, is a fourth). Any board-model-level error
      // fails eight of the nine at once, so the throw was the rule rather than
      // the exception, and it took out the toast that carries these two
      // actions. The cast is what let a `string` back into a six-member union;
      // `data.failed` was always `string[]` and now stays it.
      cause: describeGenerationFailure(data),
      severity: envelope.ok ? "warning" : outcome.severity,
      actions: [{ id: "openBoardYaml" }, { id: "runDoctor" }],
    }),
  );
}

async function runValidator(context: vscode.ExtensionContext): Promise<void> {
  if (boardYamlMissing()) return;
  const operation = "Validating board.yaml";

  // Delegate to the native CLI (which spawns the SDK's Python validator) and
  // map the envelope onto a plan.
  const res = await runAlpWithProgress(
    context,
    ["validate"],
    "Validating board.yaml…",
  );
  if (res === CANCELLED) {
    await notify(
      planSuccess("Alp: validation cancelled.", { timeoutMs: 3000 }),
    );
    return;
  }
  const { outcome } = res;
  const envelope = outcome.envelope;
  if (!envelope) {
    // Binary could not be resolved or produced no envelope.
    if ((await notify(planCliOutcome(outcome, { operation }))) === "retry") {
      await runValidator(context);
    }
    return;
  }
  logIssues("validate", envelope.issues);

  // `envelope.ok` is the authority. The old `envelope.data.outcome` switch read
  // a field the envelope contract does not guarantee, so a tan that omitted it
  // reported "validation failed unexpectedly" for a board.yaml that passed.
  if (envelope.ok && envelope.issues.length === 0) {
    // `tan validate` clean is not the whole answer (#613). A board.yaml
    // stamped with a `schemaVersion` newer than the resolved SDK's passes
    // validation — the schema permits any integer >= 1 — while the SDK's
    // migrator refuses it outright. Measured at tan 0.6.0 / alp-sdk
    // v0.16.0-rc1: `validate` answers ok/exit 0/issues [], `migrate --check`
    // answers ok false/exit 1/`migrate.failed`.
    await notify(await checkMigrator(context));
    return;
  }
  // Validation failures are always about the board.yaml this command just read,
  // so this site opts into the "Open board.yaml" remedy (see runLoader).
  if (
    (await notify(
      planCliOutcome(outcome, {
        operation,
        extraActions: [{ id: "openBoardYaml" }],
      }),
    )) === "retry"
  ) {
    await runValidator(context);
  }
}

/**
 * Second opinion on a board.yaml `tan validate` just called clean: ask the
 * SDK's own migrator whether it will accept the file (#613).
 *
 * Returns the plan the caller shows either way, so the clean path has exactly
 * one notification rather than two.
 *
 * A refusal is the ONLY thing reported. `--check` needs a resolved SDK and a
 * west workspace, and a project without one must not have a clean validation
 * turned into an error about a verb that never ran — those outcomes are
 * `unavailable`, logged and nothing more. The customer-facing sentence does not
 * guess WHY the migrator refused; west's own words ride in `detail`, which the
 * planner routes to the "Alp SDK" channel.
 */
async function checkMigrator(
  context: vscode.ExtensionContext,
): Promise<NotificationPlan> {
  const clean = planSuccess("Alp: board.yaml is clean.");
  let res;
  try {
    res = await runAlpCommand(context, ["migrate", "--check"], undefined, {
      interactive: false,
    });
  } catch {
    return clean;
  }
  const envelope = res.outcome.envelope;
  if (!envelope) return clean;
  logIssues("migrate --check", envelope.issues);

  const verdict = classifyMigrateCheck(envelope.ok, envelope.issues);
  if (verdict.kind !== "refused") return clean;

  return planFailure({
    operation: "Checking board.yaml against the SDK migrator",
    cause: MIGRATE_REFUSED_MESSAGE,
    detail: verdict.message
      ? `tan reported ${verdict.code}: ${verdict.message}`
      : `tan reported ${verdict.code}`,
    severity: "warning",
    actions: [{ id: "openBoardYaml" }],
  });
}

export function registerLoaderCommands(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("alp.generateZephyrConf", () =>
      runLoader(context, "zephyr-conf"),
    ),
    vscode.commands.registerCommand("alp.generateDtsOverlay", () =>
      runLoader(context, "dts-overlay"),
    ),
    vscode.commands.registerCommand("alp.generateNativeSimOverlay", () =>
      runLoader(context, "native-sim-overlay"),
    ),
    vscode.commands.registerCommand("alp.generateCmakeArgs", () =>
      runLoader(context, "cmake-args"),
    ),
    vscode.commands.registerCommand("alp.generateYoctoConf", () =>
      runLoader(context, "yocto-conf"),
    ),
    vscode.commands.registerCommand("alp.generateAll", () =>
      runLoaderAll(context),
    ),
    vscode.commands.registerCommand("alp.validateBoardYaml", () =>
      runValidator(context),
    ),
  ];
}
