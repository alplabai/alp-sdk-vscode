// SPDX-License-Identifier: Apache-2.0
//
// Models panel — full-tab preview of the model surface, with a build action
// (`tan model build`). Mirrors hardwareExplorer/panel.ts's singleton
// webview-panel shape. No model/build logic lives in this file, only envelope
// shaping + progress plumbing.
//
// ONE of the nine subcommands this panel presents is implemented by the pinned
// tan, and it is `build`. The other eight — list, doctor, check, zoo, add,
// prep, run, ab — are tan-cli#857, and this panel USED TO ESTABLISH THAT BY
// SPAWNING THEM (#543): nine `runAlpCommand(["model", …])` calls whose only
// possible answer was a refusal.
//
// It no longer spawns them, and it still reports the gap. `unsupportedModel-
// Subcommand` (../alpCli/pinnedSurface) synthesises the refusal tan would have
// returned, carrying tan's own `model.unknown-subcommand` code, so it flows
// through the same `./service` shapers into the same one banner the webview
// already renders (`cliSurface.ts` → `useModels`'s `cliModelSurfaceMissing`).
// THE ALARM IS NOW DERIVED FROM THE PIN RATHER THAN PROBED FROM THE BINARY —
// same message path, same banner, no subprocess. Two of the old probes could
// not even be classified: `model add <id> --board …` and `model ab <a> <b>`
// send more positionals than `tan model` takes, so click exited 2 with no
// envelope at all and the webview got a bare failure instead of a capability
// notice.
//
// WHEN tan-cli#857 LANDS: `test/tan.pinnedSurface.test.js` goes red, and each
// handler below gets its `runAlpCommand(["model", <verb>, …])` back. Restoring
// the surface in the IDE is #524.
//
// Until someone does that rewiring, these calls DO NOT go on claiming the
// capability is missing. `unsupportedModelSubcommand` consults
// `MODEL_SUBCOMMANDS` itself, so the moment a verb joins the pin it starts
// reporting the truth — "this tan can, this panel does not call it (#524)",
// under an extension-owned code rather than tan's `model.unknown-subcommand`,
// so the webview stops raising a capability banner over a capable CLI. The
// eight verb strings below stay hardcoded because the verb IS the call site's
// identity; what is no longer hardcoded is the verdict about it.

import * as vscode from "vscode";
import { unsupportedModelSubcommand } from "../alpCli/pinnedSurface";
import { SUPPORTED_CLI_VERSION } from "../alpCli/service";
import { runAlpCommand } from "../alpCli/vscodeAdapter";
import {
  type ExtToWebviewMessage,
  type WebviewToExtMessage,
} from "../ideHub/messages";
import { buildWebviewHtml, runWebviewCommand } from "../ideHub/webviewHtml";
import { planPrecondition } from "../notify/service";
import { notifyAsync, reportError } from "../notify/vscodeAdapter";
import { collectProjectContext } from "../project/vscodeAdapter";
import { log as logChannel } from "../util";
import {
  cliFailureMessage,
  toModelAbResult,
  toModelFitData,
  toModelPrepResult,
  toModelRunResult,
  toModelsData,
  toZooAddResult,
  toZooData,
} from "./service";

const PANEL_VIEW_TYPE = "alpModels";
const PANEL_TITLE = "Alp Models";

// A real NPU compile (vela/dxcom/drpai) can run well past the 60s default
// envelope timeout (spawnAlpAsync's ALP_SPAWN_TIMEOUT_MS) — killing it there
// would falsely report "Build failed" and orphan the in-progress compile.
const MODEL_BUILD_TIMEOUT_MS = 30 * 60 * 1000;

// Pure envelope shaping (`toModelsData`) lives in ./service.ts — no `vscode`
// there, so it's unit-testable directly (test/models.service.test.js) without
// this file's vscode dependency in the require chain.

class ModelsPanel {
  private static current: ModelsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext): ModelsPanel {
    if (ModelsPanel.current) {
      ModelsPanel.current.panel.reveal(vscode.ViewColumn.Active);
      void ModelsPanel.current.refresh();
      return ModelsPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      PANEL_TITLE,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(
            context.extensionUri,
            "packages",
            "alp-webview",
            "dist",
          ),
        ],
      },
    );
    ModelsPanel.current = new ModelsPanel(panel, context);
    return ModelsPanel.current;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.panel = panel;
    this.panel.webview.html = buildWebviewHtml(
      this.panel.webview,
      context.extensionUri,
      "models",
    );

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => this.onMessage(msg),
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private post(msg: ExtToWebviewMessage): void {
    void this.panel.webview.postMessage(msg);
  }

  /** The model list + toolchain doctor. Both subcommands are tan-cli#857, so
   *  the pair is answered from the pin instead of from two spawns — the same
   *  `modelsData` message, `ok: false`, carrying the refusal that raises the
   *  capability banner. `checkFit`/`refreshZoo` still run: they post their own
   *  sections, and the banner is derived once from whichever arrives first. */
  private async refresh(): Promise<void> {
    this.post(
      toModelsData(
        unsupportedModelSubcommand("list"),
        unsupportedModelSubcommand("doctor"),
      ),
    );
    void this.checkFit();
    void this.refreshZoo();
  }

  /** The curated zoo gallery. `tan model zoo` is tan-cli#857, so the section
   *  reports the gap from the pin rather than spawning for it. Zoo logic lives
   *  in tan/alp-sdk; nothing about it is re-derived here. */
  private async refreshZoo(): Promise<void> {
    this.post(toZooData(unsupportedModelSubcommand("zoo")));
  }

  /** Add a curated zoo entry to board.yaml. `tan model add` is tan-cli#857.
   *
   *  NO `zooAddStarted` and NO progress notification: both announce work that
   *  is not starting, and a spinner that resolves into "not implemented" is a
   *  worse answer than the answer itself. The refusal is posted straight to
   *  the section, and `reportError` still fires so a click is never silent —
   *  which is what the spawned version bought for a subprocess that exited 2
   *  with `Got unexpected extra argument(s)` and no envelope for the webview
   *  to classify. */
  private async addFromZoo(id: string): Promise<void> {
    const outcome = unsupportedModelSubcommand("add");
    this.post(toZooAddResult(outcome));
    void reportError(
      `Alp: cannot add ${id} from the zoo — ${cliFailureMessage(outcome)}`,
    );
  }

  /** The static NPU-eligibility screen over every board.yaml model.
   *  `tan model check` is tan-cli#857, so the coverage section reports the gap
   *  from the pin. The screen, its vocabulary and every caveat live in
   *  `tan`/alp-sdk and none of it is re-derived here — an eligibility verdict
   *  invented locally would be exactly the wrong thing to invent. */
  private async checkFit(): Promise<void> {
    this.post(toModelFitData(unsupportedModelSubcommand("check")));
  }

  /** Prep a raw .onnx (quantize + accuracy). `tan model prep` is tan-cli#857.
   *
   *  NO file dialogs and NO `modelPrepStarted`: asking a customer to pick a
   *  model and a calibration folder before telling them the CLI cannot prep
   *  anything spends their time to reach the same refusal. */
  private async prepModel(): Promise<void> {
    this.post(toModelPrepResult(unsupportedModelSubcommand("prep")));
  }

  /** Host reference latency/accuracy for one model. `tan model run` is
   *  tan-cli#857 — see `prepModel` for why no dialog opens first. */
  private async runModel(): Promise<void> {
    this.post(toModelRunResult(unsupportedModelSubcommand("run")));
  }

  /** Head-to-head comparison of two models. `tan model ab` is tan-cli#857 —
   *  see `prepModel` for why no dialog opens first. */
  private async abModels(): Promise<void> {
    this.post(toModelAbResult(unsupportedModelSubcommand("ab")));
  }

  private onMessage(msg: WebviewToExtMessage): void {
    switch (msg.type) {
      case "ready":
      case "requestModels":
        void this.refresh();
        break;
      case "buildModel":
        void this.buildModel(msg.name);
        break;
      case "checkModelFit":
        void this.checkFit();
        break;
      case "prepModel":
        void this.prepModel();
        break;
      case "runModel":
        void this.runModel();
        break;
      case "abModels":
        void this.abModels();
        break;
      case "requestZoo":
        void this.refreshZoo();
        break;
      case "addFromZoo":
        void this.addFromZoo(msg.id);
        break;
      // "Edit models in Configurator" (ModelsView.tsx) posts this. Without the
      // case the message was dropped silently — no compile error, dead button.
      // Every sibling panel handles it the same way (overviewPanel.ts:138).
      case "runCommand":
        runWebviewCommand(msg.command);
        break;
      case "closePanel":
        this.panel.dispose();
        break;
      case "openUrl":
        if (msg.url.startsWith("https://") || msg.url.startsWith("vscode://")) {
          void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        break;
    }
  }

  /** Build the models board.yaml declares. Streams progress (mirrors
   *  sdkManagerMessages.ts's install-progress tee) then re-refreshes so the
   *  list/doctor state reflects the just-built artifact.
   *
   *  `name` NARROWS NOTHING AT THIS PIN, and the run says so rather than
   *  quietly doing something else. `tan model` has no `--model` option at all
   *  (its options are --board/--board-yaml --out --metadata-root --project
   *  --sdk-root --format), so the old `["model", "build", "--model", name]`
   *  died at click exit 2 with `No such option` and no envelope — the ONE
   *  subcommand this pin implements, broken by a flag borrowed from a surface
   *  we do not ship (#543).
   *
   *  Per-model selection is not expressible here, so the choice was between
   *  refusing the click and building everything. It builds everything: `tan
   *  model build` compiles every model board.yaml declares, which is a
   *  SUPERSET of what was asked, so the requested artifact does get built. The
   *  cost — other models compiling too, and an NPU compile is not quick — is
   *  stated in the first progress line and in the notification title, because
   *  a build that silently does more than the button said is worse than one
   *  that says so.
   *
   *  THE DISCLOSURE IS POST-DISPATCH, AND THAT QUESTION IS NOT SETTLED. The
   *  first `sendProgress` runs AFTER this method was called; there is no
   *  consent prompt in front of it, so a customer who pressed "Build" on ONE
   *  model learns that every other model is compiling too by reading it happen
   *  — the shape #467 put a QuickPick in front of for dependency installs.
   *
   *  It is not a live defect at the moment, and the reason is worth writing
   *  down rather than rediscovering: `name` can only arrive from `ModelRow`'s
   *  per-model Build button (`ModelsView.tsx`), those rows render only inside
   *  `models.map(...)`, and `models` is ALWAYS `[]` here — `refresh()` posts
   *  `toModelsData(unsupportedModelSubcommand("list"), …)`, whose `!ok` arm
   *  returns an empty list. "Build all" is `disabled={building ||
   *  models.length === 0}` for the same reason, and the whole surface is
   *  hidden anyway (#525: both commands carry `"when": "false"` in the
   *  palette, and the Overview card and sidebar section are gone).
   *
   *  So THREE separate things are currently standing between a customer and
   *  an undisclosed build-everything, and #524 removes at least one of them by
   *  design. Settle the pre-dispatch-consent question BEFORE that lands —
   *  either a confirmation in front of this call, or `tan model` growing the
   *  per-model selection that removes the surprise entirely (tan-cli#857) —
   *  rather than after the panel is visible again. */
  async buildModel(name?: string): Promise<void> {
    // Defined BEFORE the workspace guard below, and the guard's own refusal
    // calls it: the webview's `build()` (useModels.ts) dispatches `buildStart`
    // — `building: true` — before it even posts the click, and only a
    // `modelBuildProgress` with `done: true` clears it (both Build buttons
    // are `disabled={building}`). Every OTHER exit from this method reaches
    // that through `sendProgress`; an early `return` that skips it leaves the
    // button disabled until the panel is closed and reopened, which is worse
    // than the spawn this guard exists to prevent.
    const sendProgress = (
      log: string,
      done: boolean,
      success?: boolean,
    ): void => {
      logChannel(`[model-build] ${log}`);
      this.post({ type: "modelBuildProgress", log, done, success });
    };

    // #605: this used to read `workspaceFolders[0]` and pass it straight to a
    // spawn unchecked — with no folder open, `tan model build` would run
    // against the extension host's own cwd (on Windows, the VS Code install
    // directory) and compile there. Resolved through `collectProjectContext`,
    // not `workspaceFolders[0]`, per `docs/ARCHITECTURE_RULES.md` §3 — the
    // same rule `requireWorkspace` (ideHub/buildPlanPanel.ts) follows.
    const cwd = collectProjectContext().workspaceRoot;
    if (!cwd) {
      notifyAsync(
        planPrecondition("noWorkspace", { operation: "build models" }),
      );
      sendProgress("Open a folder to build models.", true, false);
      return;
    }

    sendProgress(
      name
        ? `Building ALL models — tan ${SUPPORTED_CLI_VERSION} has no ` +
            `per-model selection, so ${name} is built along with every other ` +
            "model in board.yaml (tan-cli#857)…"
        : "Building all models…",
      false,
    );

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: name
          ? `Alp: Building all models (including ${name})`
          : "Alp: Building models",
        cancellable: false,
      },
      async () => {
        const { outcome } = await runAlpCommand(
          this.context,
          ["model", "build"],
          cwd,
          { timeoutMs: MODEL_BUILD_TIMEOUT_MS },
        );
        const envelope = outcome.envelope;
        if (envelope && envelope.ok) {
          sendProgress("Build complete.", true, true);
        } else {
          const error = cliFailureMessage(outcome);
          sendProgress(`Build failed: ${error}`, true, false);
          void reportError(`Alp: model build failed — ${error}`);
        }
        await this.refresh();
      },
    );
  }

  private dispose(): void {
    ModelsPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }
}

/** Open (or reveal + refresh) the Models panel. */
export function showModelsPanel(context: vscode.ExtensionContext): void {
  ModelsPanel.show(context);
}

/** Open the Models panel, then immediately kick off a build-all — what
 *  `alp.buildModel` does (per-model builds happen from the panel's own build
 *  button, which posts `buildModel` with a `name`).
 *
 *  The command is still registered but no longer reaches the command palette:
 *  it carries `"when": "false"` there while the Models surface is hidden, so
 *  calling it a "palette entry" would be a claim the manifest contradicts.
 *  See #524. */
export function triggerModelBuild(context: vscode.ExtensionContext): void {
  const panel = ModelsPanel.show(context);
  void panel.buildModel();
}
