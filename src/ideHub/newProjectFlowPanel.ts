// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { exampleCategory } from "@alp-sdk/core/examples/category";
import { planInitArgv } from "@alp-sdk/core/project/initArgv";
import { classifyInitRefusal } from "@alp-sdk/core/project/initRefusal";
import {
  appDirOverrides,
  orphanedAppDirs,
  applyCoreAssignments,
  companionCmakeLists,
  companionMainC,
  companionPrjConf,
  isSafeAppDir,
  unknownCoreOs,
} from "@alp-sdk/core/project/coreScaffold";
import type { BoardConfig } from "@alp-sdk/core/board/models";
import { parseBoardConfig } from "@alp-sdk/core/board/parse";
import { serializeBoardConfig } from "@alp-sdk/core/board/serialize";
import { runAlpCommand } from "../alpCli/vscodeAdapter";
import { unresolvedSdkReason } from "../alpCli/service";
import {
  type CreateNewProjectMessage,
  emptyAlpIdeState,
  PROTOCOL_VERSION,
  type E1mModule,
  type ExtToWebviewMessage,
  type ProjectTemplate,
  type WebviewToExtMessage,
} from "./messages";
import { E1M_MODULES } from "./projectScaffold";
import { buildProjectSettings } from "./projectSettings";
import { resetSetupNudge } from "./setupOrchestrator";
import { openProjectFolder, queryAlpIdeState } from "./vscodeAdapter";
import { buildWebviewHtml, runWebviewCommand } from "./webviewHtml";
import {
  isCancellation,
  planCliOutcome,
  planFailure,
  planPrecondition,
  planSuccess,
} from "../notify/service";
import { notify, notifyAsync } from "../notify/vscodeAdapter";
import { log } from "../util";

const PANEL_VIEW_TYPE = "alp-ide.new-project-flow";
const PANEL_TITLE = "Alp IDE — New Project";

/** tan's code for "I returned an empty example catalogue because no SDK
 *  resolved" — exit 0 and `ok: true` carry no hint of it. */
const EXAMPLES_SDK_ROOT_UNRESOLVED = "examples.sdk-root-unresolved";

export class NewProjectFlowPanel {
  private static instance?: NewProjectFlowPanel;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  /** tan's verbatim reason for an empty example catalogue, or null when the
   *  catalogue is legitimately empty. Set by `fetchTemplates`. */
  private examplesUnavailableReason: string | null = null;
  /** The toast is once per panel, not per catalog reload: the wizard re-fetches
   *  whenever the SDK selection changes. */
  private warnedAboutExamples = false;

  private constructor(private readonly context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel(
      PANEL_VIEW_TYPE,
      PANEL_TITLE,
      vscode.ViewColumn.One,
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

    this.panel.webview.html = buildWebviewHtml(
      this.panel.webview,
      context.extensionUri,
      "new-project-flow",
    );

    // `handleMessage` is voided (a message pump must not be awaited), so
    // without this handler every rejection inside it is an UNHANDLED one in the
    // extension host, with no line naming which message produced it. It really
    // can reject: the wizard awaits a folder picker, toasts, a globalState
    // write and the workspace-replacing folder open — all main-thread RPCs, all
    // rejected with a CancellationError when the window goes away. That is the
    // "Create" button working (the new project's window is opening), so it is
    // logged as abandoned, never as a failure.
    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) =>
        void this.handleMessage(msg).catch((err: unknown) => {
          if (isCancellation(err)) {
            log(`[new-project] "${msg.type}" abandoned, window closing`);
            return;
          }
          notifyAsync(
            planFailure({
              operation: "The New Project wizard",
              cause: "Alp: the New Project wizard hit an unexpected error.",
              detail: `${msg.type}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`,
            }),
          );
        }),
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  static open(context: vscode.ExtensionContext): void {
    if (NewProjectFlowPanel.instance) {
      NewProjectFlowPanel.instance.panel.reveal(vscode.ViewColumn.One);
    } else {
      NewProjectFlowPanel.instance = new NewProjectFlowPanel(context);
    }
  }

  private async sendState(): Promise<void> {
    const lastBootstrapAt =
      this.context.globalState.get<string>("alp.lastBootstrapAt") ?? null;
    const state = await queryAlpIdeState(lastBootstrapAt, this.context).catch(
      () => emptyAlpIdeState(),
    );

    const stateMsg: ExtToWebviewMessage = {
      type: "stateUpdate",
      _v: PROTOCOL_VERSION,
      state,
    };
    void this.panel.webview.postMessage(stateMsg);

    await this.reloadCatalog();
  }

  /** Re-fetch the template + SoM catalog against a wizard-selected SDK and push
   *  it to the webview, so the Examples/Hardware lists match the SDK the project
   *  will be scaffolded from (an example's `sourceDir` is relative to that SDK's
   *  `examples/`). Without this the lists come from the ambient SDK and
   *  `alp init --from-example` fails with "was not found" on a divergent pick. */
  private async reloadCatalog(sdkPath?: string): Promise<void> {
    const templates = await this.fetchTemplates(sdkPath);
    const catalogMsg: ExtToWebviewMessage = {
      type: "projectTemplatesData",
      templates,
      modules: await this.fetchSomModules(sdkPath),
      ...(this.examplesUnavailableReason
        ? { examplesUnavailableReason: this.examplesUnavailableReason }
        : {}),
    };
    void this.panel.webview.postMessage(catalogMsg);
    this.warnOnceAboutMissingExamples();
  }

  /**
   * Say once, out loud, that the example catalogue is empty because the SDK did
   * not resolve.
   *
   * The wizard also renders the reason where the Examples section would be, but
   * a user who never scrolls to that step would still not know they are picking
   * from a truncated list. Once per panel, not per catalog reload — the wizard
   * re-fetches whenever the SDK selection changes, and a toast per keystroke is
   * its own defect.
   */
  private warnOnceAboutMissingExamples(): void {
    if (!this.examplesUnavailableReason || this.warnedAboutExamples) return;
    this.warnedAboutExamples = true;
    // `planPrecondition` rather than a failure: an unresolved SDK on first run
    // is a state, not a fault, and this kind carries the action that fixes it
    // (Open SDK Manager) — the GUI equivalent of the `--sdk-root` flag tan's
    // own message names. That verbatim message is rendered in the wizard, next
    // to where the examples would have been.
    void notifyAsync(
      planPrecondition("noSdk", {
        operation: "list the SDK's example projects",
        dedupeKey: "newProject.examplesSdkRootUnresolved",
      }),
    );
  }

  /** Push a chosen/default parent directory to the wizard's Location field. */
  private postLocation(dir: string): void {
    const msg: ExtToWebviewMessage = {
      type: "projectLocationPicked",
      path: dir,
    };
    void this.panel.webview.postMessage(msg);
  }

  /** Open a folder picker for the project's parent directory and push the result. */
  private async handlePickLocation(current?: string): Promise<void> {
    const seed = current && fs.existsSync(current) ? current : os.homedir();
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      defaultUri: vscode.Uri.file(seed),
      title: "Choose where to create the project",
      openLabel: "Select Folder",
    });
    if (uris && uris.length > 0) {
      this.postLocation(uris[0].fsPath);
    }
  }

  /** Cached SoM modules from the last `fetchSomModules`, so `createProject` can
   *  resolve the chosen module's cores without re-querying `alp presets`. */
  private somModules: E1mModule[] = [];

  /** Cached templates from the last `fetchTemplates`, so `createProject` can
   *  resolve a chosen example's `sourceDir` without re-querying the CLI. */
  private templates: ProjectTemplate[] = [];

  /** SoM ("Hardware") list from the CLI's `alp presets` (the installed SDK's
   *  actual modules). Falls back to the built-in list when no SDK is resolved
   *  (presets returns an empty `soms`) so New Project works pre-SDK. */
  private async fetchSomModules(sdkPath?: string): Promise<E1mModule[]> {
    // COMMAND FIRST, `--sdk-root` at the tail — the shape, not a style choice.
    // `test/tan.surfaceContract.test.js` can only check an argv whose command
    // is a LEADING string literal; an argv assembled into a variable, or one
    // opening with a conditional spread, reduces to `resolution: "none"` and
    // every assertion in that gate skips it. All five of this panel's tan
    // calls used to sit in that state, which is how `init.invalid-cores`
    // (#528) and the 12 refused template x SoM pairs (#530) both shipped
    // unnoticed by any gate.
    //
    // Verified byte-identical on the pinned tan 0.6.0-rc1 for `presets`,
    // `explain`, `explain --template <id>` and `examples`: `--sdk-root` is a
    // declared option of each of those commands, not merely a root-position
    // global, and `withSdkRoot` tests `args.includes("--sdk-root")` — which is
    // position-independent — so it still declines to inject a second one.
    const root = sdkPath ? ["--sdk-root", sdkPath] : [];
    // `interactive: true`: only reached from `sendState`/`reloadCatalog`,
    // themselves only called on the wizard's own `ready`/`reloadProjectTemplates`
    // messages — i.e. the user opened or is actively driving this wizard, never
    // a background re-derive.
    const { outcome } = await runAlpCommand(
      this.context,
      ["presets", ...root],
      undefined,
      { interactive: true },
    );
    const soms =
      (
        outcome.envelope?.data as
          | {
              soms?: {
                sku: string;
                displayName: string;
                family: string;
                cores?: { id: string; os: string }[];
              }[];
            }
          | undefined
      )?.soms ?? [];
    if (soms.length === 0) {
      // No SDK resolved: `alp presets` returns built-in defaults with an empty
      // `soms` and a `presets.sdk-root-unresolved` warning. Fall back to the
      // static catalog — which carries no `cores`, so a heterogeneous SoM would
      // scaffold as single-core with no IPC. Surface the CLI's (otherwise
      // discarded) warning so that topology gap isn't silent.
      if (
        outcome.envelope?.issues?.some(
          (i) => i.code === "presets.sdk-root-unresolved",
        )
      ) {
        // `reloadCatalog` re-runs on mount AND on every wizard SDK change, so
        // the same warning would stack; `dedupeKey` drops a repeat while one is
        // still on screen. TODO: this is degraded state for the Hardware step
        // and belongs BESIDE that list — it needs a `catalogWarning` field on
        // `projectTemplatesData` (src/ideHub/messages.ts + the webview mirror),
        // which is outside this routing pass.
        notifyAsync(
          planFailure({
            operation: "Loading the hardware list",
            cause:
              "No SDK resolved, so the Hardware list can't report core topology — a multi-core SoM (e.g. E1M-V2N101) will scaffold as single-core with no IPC. Select an SDK for full multi-core scaffolding.",
            severity: "warning",
            dedupeKey: "presets.sdk-root-unresolved",
          }),
        );
      }
      this.somModules = E1M_MODULES;
      return this.somModules;
    }
    this.somModules = soms.map((s) => ({
      id: s.sku,
      displayName: s.displayName || s.sku,
      family: s.family || "other",
      cores: s.cores ?? [],
    }));
    return this.somModules;
  }

  /** Build the template picker from the CLI's real templates (single source of
   *  truth): `alp explain` lists ids, then per-id explain gives title/blurb. */
  private async fetchTemplates(sdkPath?: string): Promise<ProjectTemplate[]> {
    // Command first, `--sdk-root` at the tail — see `fetchSomModules` for why
    // the shape is load-bearing and for the pinned-tan equivalence check.
    const root = sdkPath ? ["--sdk-root", sdkPath] : [];
    // `interactive: true` on all three calls below — see `fetchSomModules`.
    const overview = await runAlpCommand(
      this.context,
      ["explain", ...root],
      undefined,
      { interactive: true },
    );
    if (overview.outcome.envelope === null) {
      // `runAlpCommand` never throws: an unresolvable/failed CLI returns a
      // null-envelope error outcome. Without surfacing it the template step
      // renders blank with no trace (issue #129). The plan reads
      // `outcome.unavailable` so a first-run "tan isn't installed yet" offers
      // Install rather than the alpSdk.cliPath fix for a BROKEN path, and the
      // resolver's raw text goes to the channel as `detail`. A resolved SDK
      // with no templates returns a non-null envelope, so it falls through to
      // the webview's empty-state instead.
      notifyAsync(
        planCliOutcome(overview.outcome, {
          operation: "Loading the project templates",
        }),
      );
      this.templates = [];
      return this.templates;
    }
    const ids =
      (
        overview.outcome.envelope?.data as
          | { available?: { projectTemplates?: string[] } }
          | undefined
      )?.available?.projectTemplates ?? [];

    const templates: ProjectTemplate[] = [];
    for (const id of ids) {
      const detail = await runAlpCommand(
        this.context,
        ["explain", "--template", id, ...root],
        undefined,
        { interactive: true },
      );
      const data = detail.outcome.envelope?.data as
        | { summary?: string; details?: string[] }
        | undefined;
      templates.push({
        id,
        title: data?.summary ?? id,
        description: data?.details?.[0] ?? "",
        category: "starter",
      });
    }

    // Append the SDK's ready-made example projects (`alp examples` → category
    // "example"), so users can scaffold from a real example, not just a starter.
    const examplesRes = await runAlpCommand(
      this.context,
      ["examples", ...root],
      undefined,
      { interactive: true },
    );
    // An unresolved SDK is not a failure here: tan returns exit 0 with
    // `ok: true` and an EMPTY catalogue, naming the reason only in
    // `issues[].code`. That used to render as "no Examples section", so a user
    // whose SDK is unresolved lost every example with nothing saying why. A
    // legitimately empty list (a `--category` that matched nothing) carries no
    // issue and correctly leaves this null.
    this.examplesUnavailableReason = unresolvedSdkReason(
      examplesRes.outcome.envelope,
      EXAMPLES_SDK_ROOT_UNRESOLVED,
    );
    const examples =
      (
        examplesRes.outcome.envelope?.data as
          | {
              examples?: {
                id: string;
                sourceDir: string;
                title?: string;
                description?: string;
                /** Not on the wire as of the pinned tan v0.6.0-rc1 (measured
                 *  against its own published envelope-contract.json), so it is
                 *  optional and `exampleCategory` falls back to `sourceDir`'s
                 *  leading segment. Typed here so the day tan sends one, it
                 *  wins with no further change (#482 §1). */
                category?: string;
              }[];
            }
          | undefined
      )?.examples ?? [];
    for (const ex of examples) {
      // `?? undefined` and not `?? ""`: an example with no category must leave
      // the field ABSENT so the view groups it nowhere, rather than under a
      // heading with an empty name.
      const group = exampleCategory(ex) ?? undefined;
      templates.push({
        id: ex.id,
        title: ex.title || ex.id,
        description: ex.description ?? "",
        category: "example",
        sourceDir: ex.sourceDir,
        group,
      });
    }

    this.templates = templates;
    return templates;
  }

  private async handleMessage(msg: WebviewToExtMessage): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.sendState();
        // Seed the wizard's Location field with a sensible default.
        this.postLocation(os.homedir());
        break;

      case "pickProjectLocation":
        await this.handlePickLocation(msg.current);
        break;

      case "createNewProject":
        await this.createProject(msg);
        break;

      case "reloadProjectTemplates":
        await this.reloadCatalog(msg.sdkPath);
        break;

      case "closePanel":
        void vscode.commands.executeCommand("alp.ideHub.focus");
        this.panel.dispose();
        break;

      case "openUrl":
        if (msg.url.startsWith("https://") || msg.url.startsWith("vscode://")) {
          void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        break;

      case "runCommand":
        runWebviewCommand(msg.command);
        break;
    }
  }

  /**
   * Write the wizard's core layout into the scaffolded project (#534).
   *
   * TWO WRITES, both additive:
   *
   *  1. `board.yaml` gains each assigned core's runtime and `app:`, applied to
   *     the document tan just wrote and serialised back through the SAME
   *     writer the Configurator uses, so comments and key order survive.
   *  2. Every companion app directory that does not already exist is created
   *     with its own `CMakeLists.txt`, `main.c` and `prj.conf` — a Zephyr
   *     application is one CMake project per core, and the root CMakeLists tan
   *     generated is hardcoded to the app core.
   *
   * NEVER OVERWRITES. A directory that already has files is left alone: the app
   * core's `./src` is full of the template's real source, and clobbering it
   * would delete the very thing the customer asked to be scaffolded.
   *
   * Failures are reported, never swallowed — a project that silently came out
   * single-core is the bug this whole feature exists to fix.
   */
  private applyCoreLayout(
    projectDir: string,
    projectName: string,
    assignments: { id: string; os: string; app?: string }[],
  ): void {
    // An os this extension cannot validate is DROPPED by `applyCoreAssignments`
    // rather than written into board.yaml to die later at the SDK's enum check.
    // Dropping it silently would leave a project missing a core the customer
    // configured, so it is said here, before anything is written.
    const unknown = unknownCoreOs(assignments);
    if (unknown.length > 0) {
      log(
        `[new-project] unknown os value(s): ${unknown
          .map((entry) => `${entry.id}=${entry.os}`)
          .join(", ")}`,
      );
      notifyAsync(
        planFailure({
          operation: "Writing the project's core layout",
          cause:
            unknown
              .map((entry) => `${entry.id} asked for "${entry.os}"`)
              .join(", ") +
            ", which this version does not recognise, so those cores were " +
            "left out of board.yaml. Add them from the Board Configurator, or " +
            "update the extension.",
          severity: "warning",
        }),
      );
    }

    const boardPath = path.join(projectDir, "board.yaml");
    let merged: BoardConfig | undefined;
    let overrides: { id: string; requested: string; kept: string }[] = [];
    let orphans: { id: string; app: string; os: string }[] = [];
    try {
      const original = fs.readFileSync(boardPath, "utf8");
      const before = parseBoardConfig(original);
      // Collected BEFORE the merge overwrites the evidence: tan's directory
      // wins (it holds the template's real source), but a customer who renamed
      // it and was silently ignored would find nothing on screen saying so.
      overrides = appDirOverrides(before, assignments);
      orphans = orphanedAppDirs(before, assignments);
      const next = applyCoreAssignments(before, assignments);
      merged = next;
      fs.writeFileSync(boardPath, serializeBoardConfig(next, original), "utf8");
      log(`[new-project] wrote ${assignments.length} core(s) into board.yaml`);
    } catch (err) {
      log(`[new-project] core layout FAILED for ${boardPath}: ${String(err)}`);
      notifyAsync(
        planFailure({
          operation: "Writing the project's core layout",
          cause:
            `Project "${projectName}" was created, but the extra cores could ` +
            "not be written to board.yaml. It has one core configured; add " +
            "the others from the Board Configurator.",
          detail: `${boardPath}: ${String(err)}`,
          severity: "warning",
        }),
      );
      return;
    }

    // A directory tan filled with the template's real source, whose core the
    // customer then took the application away from (#582). Honoured, not
    // prevented — but said out loud, because the code is still on disk and
    // nothing builds it now.
    if (orphans.length > 0) {
      log(
        `[new-project] orphaned app dir(s): ${orphans
          .map((o) => `${o.id} -> ${o.app}`)
          .join(", ")}`,
      );
      notifyAsync(
        planFailure({
          operation: "Assigning the project's core directories",
          cause: orphans
            .map(
              (o) =>
                `${o.id} is set to "${o.os}", so the project template's ` +
                `source in "${o.app}" is not built by any core. Point a ` +
                "Zephyr core at that directory, or delete it.",
            )
            .join(" "),
          severity: "warning",
        }),
      );
    }

    if (overrides.length > 0) {
      notifyAsync(
        planFailure({
          operation: "Assigning the project's core directories",
          cause: overrides
            .map(
              (o) =>
                `${o.id} keeps "${o.kept}" rather than "${o.requested}": the ` +
                "project template's source was scaffolded there. Move the " +
                "files and change board.yaml if you want it elsewhere.",
            )
            .join(" "),
          severity: "info",
        }),
      );
    }

    // KEYED ON THE MERGED BOARD, never on the wizard's raw request. The two
    // disagree wherever tan had already chosen a directory, and scaffolding the
    // requested one would create a directory `board.yaml` does not point at —
    // holding a generated comment that claims it does.
    for (const assignment of assignments) {
      const app = merged?.cores?.[assignment.id]?.app;
      if (!app) continue;
      // Refused, not resolved: `../..` walks out of the project and an absolute
      // path ignores it entirely, and three files land wherever that points.
      // The webview validates too; this is the boundary that counts.
      if (!isSafeAppDir(app)) {
        log(`[new-project] refused app directory outside the project: ${app}`);
        notifyAsync(
          planFailure({
            operation: "Scaffolding a core's application",
            cause:
              `${assignment.id}'s app directory "${app}" is not inside the ` +
              "project, so nothing was written for it. Point it at a path " +
              "under the project root in board.yaml.",
            severity: "warning",
          }),
        );
        continue;
      }
      const dir = path.resolve(projectDir, app);
      // Already scaffolded (the app core's ./src) — leave every file alone.
      if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) continue;
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          path.join(dir, "CMakeLists.txt"),
          companionCmakeLists({ coreId: assignment.id, projectName }),
          "utf8",
        );
        fs.writeFileSync(
          path.join(dir, "main.c"),
          companionMainC({ coreId: assignment.id }),
          "utf8",
        );
        fs.writeFileSync(
          path.join(dir, "prj.conf"),
          companionPrjConf(assignment.id),
          "utf8",
        );
        log(`[new-project] scaffolded ${assignment.id} into ${dir}`);
      } catch (err) {
        log(`[new-project] scaffold FAILED for ${dir}: ${String(err)}`);
        notifyAsync(
          planFailure({
            operation: "Scaffolding a core's application",
            cause:
              `board.yaml declares ${assignment.id} at "${app}", ` +
              "but that directory could not be created. Create it with a " +
              "CMakeLists.txt and main.c, or set the core to off.",
            detail: `${dir}: ${String(err)}`,
            severity: "warning",
          }),
        );
      }
    }
  }

  private async createProject(msg: CreateNewProjectMessage): Promise<void> {
    const {
      templateId,
      moduleId,
      projectName,
      sdkPath,
      destination,
      cores: coreAssignments,
    } = msg;
    const openInCurrentWindow = msg.openInCurrentWindow ?? true;
    // Prefer the location chosen in the wizard; fall back to a picker if absent.
    let parentDir = destination?.trim() ?? "";
    if (!parentDir || !fs.existsSync(parentDir)) {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        title: "Select parent folder for new project",
        openLabel: "Select Folder",
      });
      if (!uris || uris.length === 0) {
        return;
      }
      parentDir = uris[0].fsPath;
    }

    const projectDir = path.join(parentDir, projectName);

    if (fs.existsSync(projectDir)) {
      // The colliding absolute path is channel detail; the sentence names the
      // two fields the user can actually change. TODO: this is Name/Location
      // form validation and belongs beside those fields — it needs its own
      // ExtToWebviewMessage (src/ideHub/messages.ts + the webview mirror),
      // which is outside this routing pass.
      notifyAsync(
        planFailure({
          operation: "Creating the project",
          cause: `A folder named "${projectName}" already exists in that location — pick a different name or location.`,
          detail: projectDir,
        }),
      );
      return;
    }

    // Delegate scaffolding to the CLI. An example template (sourceDir set) is
    // copied verbatim via `alp init --from-example` — it ships its own board.yaml,
    // so --som/--cores don't apply. A starter template is expanded via
    // `alp init --template --som` with the chosen SoM written into board.yaml.
    const sourceDir = this.templates.find(
      (t) => t.id === templateId,
    )?.sourceDir;
    //
    // The argv itself is `planInitArgv`, in core, and it is there so a GATE can
    // read it: assembled inline here it reduced to `resolution: "none"` in
    // `scripts/tan-surface/extract.mjs` and no assertion in
    // `test/tan.surfaceContract.test.js` ever ran on it — which is how #528 and
    // #530 both reached customers. `test/wizard.initArgv.test.js` now enumerates
    // every branch of it against the pinned tan's recorded surface. Keep the
    // assembly there; a flag pushed back onto `initArgs` here is a flag no gate
    // checks again.
    //
    // Heterogeneous SoMs scaffold their companion cores + a default IPC channel
    // via `tan init --cores`, FILTERED through `planInitCores` (#528) — see that
    // module for the contract and for why no core is named as the app core.
    //
    // BOTH the topology AND the customer's answers (#582). They answer
    // different questions — `tan presets` reports which cores the part HAS,
    // the Cores step records which the customer WANTS — and sending only the
    // first meant a core set to "Off (skip core)" still reached `--cores` as an
    // enabled runtime, dragging in, for a Cortex-A companion, a whole `ipc:`
    // stanza nobody asked for. Sending only the second is measurably worse:
    // 276 of 368 answer combinations are then refused with exit 2 /
    // `init.invalid-cores`, against 0 today. `planInitCores` needs both.
    const {
      argv: initArgs,
      zephyrCores: unscaffolded,
      deferredCores,
      unknownCores,
    } = planInitArgv({
      templateId,
      sourceDir,
      projectName,
      parentDir,
      moduleId,
      cores: this.somModules.find((m) => m.id === moduleId)?.cores ?? [],
      coreAssignments,
      sdkPath,
    });
    // `interactive: true`: reached only from the wizard's "Create" button
    // (`createNewProject`) — a direct, explicit user action.
    const { outcome } = await runAlpCommand(this.context, initArgs, undefined, {
      interactive: true,
    });
    if (!outcome.envelope || !outcome.envelope.ok) {
      // Severity comes from the outcome, never from here: `alp init --som` with
      // a bad SKU exits 2 (validation ⇒ warning) and must not read like the
      // spawn failure that exits 1.
      // Two refusals get guidance instead of a bare report (#530): this
      // wizard lets any template be paired with any SoM, and 12 of the 44
      // pairs cannot be scaffolded — `iot-starter` alone is refused on 10 of
      // the 11 SoMs. tan is right to refuse (rendering an Alif tree under an
      // NXP SKU would write another vendor's content into the project), but a
      // raw refusal leaves the customer on a Confirm step whose Create button
      // will fail again, with nothing saying where to go.
      //
      // Classified on the CODE (`@alp-sdk/core/project/initRefusal`), and the
      // two kinds get different sentences on purpose: `init.invalid-som` is
      // fixable by changing the SoM and tan's own message names the SKU that
      // works, while `init.som-unsupported` is not — no SoM change helps when
      // the template ships no tree for that family, so the way out is another
      // template or an example. Examples carry their own board.yaml and
      // scaffold onto any SoM (verified for E1M-NX9101 on the pinned tan).
      const refusal = classifyInitRefusal(outcome.envelope?.issues);
      if (refusal) {
        const advice =
          refusal.kind === "template-pinned-to-som"
            ? "Choose the SoM it names, or go back and pick another project type."
            : "No SoM change helps here — go back and pick another project type, or start from an example, which brings its own board.yaml and scaffolds onto any SoM.";
        const picked = await notify(
          planFailure({
            operation: "Creating the project",
            cause: `${refusal.message ?? "This project type cannot be scaffolded for this SoM."} ${advice}`,
            // The code is an internal identifier, so it travels as channel
            // detail rather than in the sentence.
            detail: `${refusal.code}: ${templateId} + ${moduleId}`,
            severity: "warning",
            actions: [{ id: "chooseProjectType" }],
          }),
        );
        if (picked === "chooseProjectType") {
          const msg: ExtToWebviewMessage = {
            type: "newProjectFlowGoToStep",
            stepId: "template",
          };
          void this.panel.webview.postMessage(msg);
        }
        return;
      }
      notifyAsync(
        planCliOutcome(outcome, { operation: "Creating the project" }),
      );
      return;
    }

    // The one thing the scaffold cannot say for itself (#528): this SoM
    // declares more than one Zephyr core, and `tan init --cores` can only
    // splice companions in APP-LESS, so exactly one of them — the SoM's app
    // core, which tan picks — got the app and the rest are absent from the
    // generated board.yaml. Silently handing a dual-M55 customer a
    // single-core project is the failure this notice exists to prevent.
    //
    // A TOAST, not the default statusBar: `planSuccess` with no actions is a
    // transient status-bar line and `detail` is channel-only, so the fact
    // would never reach the screen. The example named is the shipped one that
    // DOES give a second Zephyr core its own `app:` — something no
    // `--template` + `--cores` combination can express.
    // Only when the second pass did NOT run (#538): with a core layout the
    // wizard configures every core it names, so this toast would contradict the
    // project sitting on disk.
    if (unscaffolded.length > 1 && !coreAssignments?.length) {
      notifyAsync(
        planSuccess(
          `Project "${projectName}" created with one Zephyr core configured. ` +
            `${moduleId} has ${unscaffolded.length} (${unscaffolded.join(", ")}) — ` +
            "to start from a project that uses both, create it from the " +
            "multicore/mproc-mailbox example instead.",
          { actions: [{ id: "showOutput" }] },
        ),
      );
      log(
        `[new-project] ${moduleId}: ${unscaffolded.length} zephyr cores ` +
          `(${unscaffolded.join(", ")}), only the SoM's app core is scaffolded ` +
          "— tan init --cores splices companions app-less",
      );
    }

    // SECOND PASS (#534): give every core the wizard assigned its own app.
    //
    // `tan init --cores` splices companions in APP-LESS, so the scaffold above
    // can only ever have one core with an `app:`. Everything the customer chose
    // beyond that is written here, on top of what tan produced — never instead
    // of it: tan owns `preset:`, `supported_boards:` and the SoM's topology,
    // and this pass re-derives none of them.
    //
    // An answer naming a core this SoM does not declare is DROPPED here, at the
    // boundary (#582). The assignments arrive in a webview message and the
    // declared topology is the authority on which cores exist; writing one the
    // part does not have would produce a board.yaml no SoM can build.
    // `planInitCores` already refused to send it to tan — the second pass has
    // no topology of its own, so the filter belongs here.
    const declaredIds = new Set(
      (this.somModules.find((m) => m.id === moduleId)?.cores ?? []).map(
        (core) => core.id,
      ),
    );
    if (unknownCores.length > 0) {
      log(`[new-project] dropped unknown core(s): ${unknownCores.join(", ")}`);
      notifyAsync(
        planFailure({
          operation: "Writing the project's core layout",
          cause:
            `${moduleId} does not have ${unknownCores.join(", ")}, so ` +
            (unknownCores.length === 1 ? "that core was" : "those cores were") +
            " left out of board.yaml. Pick the hardware again if this is the " +
            "wrong module.",
          severity: "warning",
        }),
      );
    }
    // Channel-only: every one of these IS carried by the second pass below, and
    // the ones that need a sentence get their own (an unrecognised os through
    // `unknownCoreOs`, an orphaned directory through `orphanedAppDirs`). What
    // the log buys is the ability to see, after the fact, which answers
    // `--cores` could not express for a given SoM.
    if (deferredCores.length > 0) {
      log(
        "[new-project] deferred to the second pass: " +
          deferredCores
            .map((core) => `${core.id}=${core.requested}`)
            .join(", "),
      );
    }
    const applicable = (coreAssignments ?? []).filter((core) =>
      declaredIds.has(core.id),
    );
    if (applicable.length > 0) {
      this.applyCoreLayout(projectDir, projectName, applicable);
    }

    // Pin the chosen SDK for the new project so it opens with the right one
    // (workspace-scoped alpSdk.path). Omitted ⇒ the project inherits the global
    // default / auto-resolution.
    let pinError: string | undefined;
    if (sdkPath) {
      const pinned = this.pinProjectSdk(projectDir, sdkPath);
      if (pinned.ok) {
        log(`[new-project] pinned alpSdk.path=${sdkPath} for ${projectDir}`);
      } else {
        pinError = pinned.error;
        log(`[new-project] SDK pin FAILED for ${projectDir}: ${pinned.error}`);
      }
    }

    // Decide whether to open. A pin failure must be surfaced BEFORE (and AS) the
    // open decision — never a plain "Open Project" prompt that lets the user
    // unknowingly open a scaffold with no SDK pinned (F5).
    let shouldOpen = false;
    if (pinError) {
      // The pick GATES the open, so this stays awaited and both actions are
      // caller-handled (no `run` in the presenter's table). `pinError` is
      // `String(err)` off an fs catch — an EACCES/EPERM/ENOENT string with an
      // absolute path — so it and `projectDir` travel as channel `detail`.
      const choice = await notify(
        planFailure({
          operation: "Pinning the project's SDK",
          cause: `Project "${projectName}" was created, but pinning its SDK failed. It will open WITHOUT a pinned SDK until you set "alpSdk.path" in its .vscode/settings.json.`,
          detail: `${projectDir}: ${pinError}`,
          severity: "warning",
          actions: [{ id: "retry", title: "Retry Pin" }, { id: "openAnyway" }],
        }),
      );
      if (choice === "retry") {
        if (sdkPath) {
          const retried = this.pinProjectSdk(projectDir, sdkPath);
          if (retried.ok) {
            log(`[new-project] SDK pin retry OK for ${projectDir}`);
            notifyAsync(planSuccess(`SDK pinned. Opening "${projectName}".`));
          } else {
            log(`[new-project] SDK pin retry FAILED for ${projectDir}`);
            // Still a warning, not an error: the user already chose to open
            // anyway, so the second failure of the same condition is not a
            // worse outcome than the first.
            notifyAsync(
              planFailure({
                operation: "Pinning the project's SDK",
                cause:
                  'Pinning the SDK failed again. Opening without a pinned SDK; set "alpSdk.path" manually.',
                detail: `${projectDir}: ${retried.error}`,
                severity: "warning",
              }),
            );
          }
        }
        shouldOpen = true;
      } else if (choice === "openAnyway") {
        shouldOpen = true;
      }
      // Dismissed ⇒ don't open (safer than the old silent open).
    } else {
      // Pin OK ⇒ auto-open so the new project becomes the ACTIVE project: the
      // extension's project context (board.yaml / build / flash) resolves from
      // the open workspace folder, so a created-but-unopened project is never
      // active. Opens in the CURRENT window (see openProjectFolder) — the user
      // just built this to work on it. Status bar, not a toast: the window
      // replace tears a toast down before it can be read, and the new window
      // IS the feedback.
      notifyAsync(planSuccess(`Project "${projectName}" created — opening…`));
      // Clear the setupOrchestrator's machine-wide "already shown" fingerprint
      // so the freshly-created project's activation re-evaluates readiness and
      // reliably shows the bootstrap nudge — a prior dismissal for the same
      // issue set (e.g. from an earlier project) must not silently suppress it
      // here. globalState is machine-wide, so this survives the window replace.
      await resetSetupNudge(this.context);
      shouldOpen = true;
    }

    if (shouldOpen) {
      // Checkbox unchecked ⇒ open in a NEW window (keep the current workspace);
      // checked (default) ⇒ replace the current window.
      await openProjectFolder(
        vscode.Uri.file(projectDir),
        !openInCurrentWindow,
      );
    }

    this.panel.dispose();
  }

  /** Write the new project's .vscode/settings.json (merging if it exists): pin
   *  `alpSdk.path` to the SDK chosen in the wizard, and point the C/C++ extension
   *  at the west build's compile DB so Zephyr + ALP headers resolve after the
   *  first Build (see buildProjectSettings). Returns the outcome so the caller
   *  can surface a failure BEFORE offering to open the project — never silently
   *  open an unpinned scaffold (F5). */
  private pinProjectSdk(
    projectDir: string,
    sdkPath: string,
  ): { ok: true } | { ok: false; error: string } {
    try {
      const vscodeDir = path.join(projectDir, ".vscode");
      fs.mkdirSync(vscodeDir, { recursive: true });
      const settingsPath = path.join(vscodeDir, "settings.json");
      let existing: Record<string, unknown> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          existing = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
        } catch {
          existing = {};
        }
      }
      const settings = buildProjectSettings(existing, sdkPath);
      fs.writeFileSync(
        settingsPath,
        JSON.stringify(settings, null, 2) + "\n",
        "utf8",
      );
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  private dispose(): void {
    NewProjectFlowPanel.instance = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
