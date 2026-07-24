// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { runAlpCommand } from "../alpCli/vscodeAdapter";
import {
  emptyAlpIdeState,
  PROTOCOL_VERSION,
  type E1mModule,
  type ExtToWebviewMessage,
  type ProjectTemplate,
  type WebviewToExtMessage,
} from "./messages";
import { E1M_MODULES } from "./projectScaffold";
import { buildProjectSettings } from "./projectSettings";
import { openProjectFolder, queryAlpIdeState } from "./vscodeAdapter";
import { buildWebviewHtml, runWebviewCommand } from "./webviewHtml";
import { log, reportError, showOutput } from "../util";

const PANEL_VIEW_TYPE = "alp-ide.new-project-flow";
const PANEL_TITLE = "Alp IDE — New Project";

export class NewProjectFlowPanel {
  private static instance?: NewProjectFlowPanel;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

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

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => void this.handleMessage(msg),
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
    const catalogMsg: ExtToWebviewMessage = {
      type: "projectTemplatesData",
      templates: await this.fetchTemplates(sdkPath),
      modules: await this.fetchSomModules(sdkPath),
    };
    void this.panel.webview.postMessage(catalogMsg);
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
    const args = sdkPath ? ["--sdk-root", sdkPath, "presets"] : ["presets"];
    const { outcome } = await runAlpCommand(this.context, args);
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
        void vscode.window.showWarningMessage(
          "Alp: no SDK resolved, so the Hardware list can't report core topology — a multi-core SoM (e.g. E1M-V2N101) will scaffold as single-core with no IPC. Select an SDK for full multi-core scaffolding.",
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
    const root = sdkPath ? ["--sdk-root", sdkPath] : [];
    const overview = await runAlpCommand(this.context, [...root, "explain"]);
    if (overview.outcome.envelope === null) {
      // `runAlpCommand` never throws: an unresolvable/failed CLI returns a
      // null-envelope error outcome. Without surfacing it the template step
      // renders blank with no trace (issue #129) — mirror the loader's null
      // check and point the user at the setting / output channel. A resolved
      // SDK with no templates returns a non-null envelope, so it falls through
      // to the webview's empty-state instead.
      log(`[new-project] ${overview.outcome.message}`);
      void this.surfaceTemplateError(overview.outcome.message);
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
      const detail = await runAlpCommand(this.context, [
        ...root,
        "explain",
        "--template",
        id,
      ]);
      const data = detail.outcome.envelope?.data as
        | { summary?: string; details?: string[] }
        | undefined;
      templates.push({
        id,
        title: data?.summary ?? id,
        description: data?.details?.[0] ?? "",
        category: "starter",
        icon: "📦",
      });
    }

    // Append the SDK's ready-made example projects (`alp examples` → category
    // "example"), so users can scaffold from a real example, not just a starter.
    // Empty when no SDK resolves — the picker simply shows no Examples section.
    const examplesRes = await runAlpCommand(this.context, [
      ...root,
      "examples",
    ]);
    const examples =
      (
        examplesRes.outcome.envelope?.data as
          | {
              examples?: {
                id: string;
                sourceDir: string;
                title?: string;
                description?: string;
              }[];
            }
          | undefined
      )?.examples ?? [];
    for (const ex of examples) {
      templates.push({
        id: ex.id,
        title: ex.title || ex.id,
        description: ex.description ?? "",
        category: "example",
        icon: "🧪",
        sourceDir: ex.sourceDir,
      });
    }

    this.templates = templates;
    return templates;
  }

  /** Surface a CLI-unavailable failure from `fetchTemplates` (mirrors the
   *  alpCli adapter's `surfaceResolutionError`, plus a "Show Output" action)
   *  instead of leaving the template step silently blank. */
  private async surfaceTemplateError(message: string): Promise<void> {
    const choice = await vscode.window.showErrorMessage(
      message,
      "Open Settings",
      "Show Output",
    );
    if (choice === "Open Settings") {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "alpSdk.cliPath",
      );
    } else if (choice === "Show Output") {
      showOutput();
    }
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
        await this.createProject(
          msg.templateId,
          msg.moduleId,
          msg.projectName,
          msg.sdkPath,
          msg.destination,
          msg.openInCurrentWindow ?? true,
        );
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

  private async createProject(
    templateId: string,
    moduleId: string,
    projectName: string,
    sdkPath?: string,
    destination?: string,
    openInCurrentWindow: boolean = true,
  ): Promise<void> {
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
      void vscode.window.showErrorMessage(
        `Folder already exists: ${projectDir}`,
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
    const initArgs = sourceDir
      ? [
          "init",
          "--from-example",
          sourceDir,
          "--name",
          projectName,
          "--destination",
          parentDir,
          "--non-interactive",
        ]
      : [
          "init",
          "--template",
          templateId,
          "--name",
          projectName,
          "--destination",
          parentDir,
          "--som",
          moduleId,
          "--non-interactive",
        ];
    // Heterogeneous SoMs (≥2 cores) scaffold every core + a default IPC channel
    // via `alp init --cores` (requires the CLI's --cores support; see
    // SUPPORTED_CLI_VERSION). Single-core SoMs keep the plain --som path.
    if (!sourceDir) {
      const cores = this.somModules.find((m) => m.id === moduleId)?.cores ?? [];
      if (cores.length >= 2) {
        initArgs.push("--cores", cores.map((c) => `${c.id}:${c.os}`).join(","));
      }
    }
    // Examples copy their own board.yaml verbatim; when the user picks a SoM,
    // retarget the copied board.yaml to it (alp init --from-example --som), so an
    // example can be scaffolded onto the user's SoM instead of its default.
    if (sourceDir && moduleId) {
      initArgs.push("--som", moduleId);
    }
    // Source the scaffold from the SDK the user picked in the wizard (the same one
    // pinned below), overriding runAlpCommand's active-SDK injection — so an
    // example is copied from, and validated against, the selected SDK rather than
    // whatever SDK happens to be globally active.
    if (sdkPath) {
      initArgs.push("--sdk-root", sdkPath);
    }
    const { outcome } = await runAlpCommand(this.context, initArgs);
    if (!outcome.envelope || !outcome.envelope.ok) {
      await reportError(`Alp: ${outcome.message}`);
      return;
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
      const retry = "Retry Pin";
      const openAnyway = "Open Anyway";
      const choice = await vscode.window.showWarningMessage(
        `Alp: project "${projectName}" was created at ${projectDir}, but pinning its SDK failed — ${pinError}. It will open WITHOUT a pinned SDK until you set "alpSdk.path" in its .vscode/settings.json.`,
        retry,
        openAnyway,
      );
      if (choice === retry) {
        if (sdkPath) {
          const retried = this.pinProjectSdk(projectDir, sdkPath);
          if (retried.ok) {
            log(`[new-project] SDK pin retry OK for ${projectDir}`);
            void vscode.window.showInformationMessage(
              `Alp: SDK pinned. Opening "${projectName}".`,
            );
          } else {
            log(
              `[new-project] SDK pin retry FAILED for ${projectDir}: ${retried.error}`,
            );
            void reportError(
              `Alp: pinning the SDK failed again — ${retried.error}. Opening without a pinned SDK; set "alpSdk.path" manually.`,
            );
          }
        }
        shouldOpen = true;
      } else if (choice === openAnyway) {
        shouldOpen = true;
      }
      // Dismissed ⇒ don't open (safer than the old silent open).
    } else {
      // Pin OK ⇒ auto-open so the new project becomes the ACTIVE project: the
      // extension's project context (board.yaml / build / flash) resolves from
      // the open workspace folder, so a created-but-unopened project is never
      // active. Opens in the CURRENT window (see openProjectFolder) — the user
      // just built this to work on it. Fire-and-forget toast for feedback;
      // opening no longer needs a click.
      void vscode.window.showInformationMessage(
        `Project "${projectName}" created — opening…`,
      );
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
