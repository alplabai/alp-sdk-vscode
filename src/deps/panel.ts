// SPDX-License-Identifier: Apache-2.0
//
// The dependency panel. Replaces the Toolchain Doctor panel (deleted) rather
// than sitting beside it: two surfaces answering "is my machine ready?" is how
// they end up disagreeing.

import type { DependencyReport } from "@alp-sdk/core/deps/planner";
import * as vscode from "vscode";

import { danglingWestManifest } from "../environment/vscodeAdapter";
import type {
  ExtToWebviewMessage,
  WebviewToExtMessage,
} from "../ideHub/messages";
import { buildWebviewHtml } from "../ideHub/webviewHtml";
import { isCancellation } from "../notify/service";
import { collectProjectContext } from "../project/vscodeAdapter";
import { offerBootstrapFix } from "../toolchain";
import { log } from "../util";
import type { StateManager } from "../views/stateManager";
import {
  buildDependencyReport,
  runDependencyAction,
  withLatestSdk,
} from "./vscodeAdapter";

const PANEL_VIEW_TYPE = "alp-ide.dependencies";
const PANEL_TITLE = "Alp Dependencies";
/** Written to `<body data-alp-mode>`; `packages/alp-webview/src/App.tsx`
 *  routes this exact string to `DependenciesView`. */
const WEBVIEW_MODE = "dependencies";

/**
 * Start a main-thread call nobody awaits, WITH a rejection handler.
 *
 * `void promise` attaches none, so any rejection is an unhandled one — and at
 * window teardown VS Code's RPC rejects every pending main-thread reply with
 * `Canceled`, which is not a failure and must not reach the customer's
 * channel. Anything else gets one line that names what was being done, because
 * a bare `Canceled: Canceled` in the host log names nothing (#368).
 */
function fireAndForget(work: Thenable<unknown>, what: string): void {
  Promise.resolve(work).then(undefined, (err: unknown) => {
    if (!isCancellation(err)) log(`[deps] ${what} failed: ${err}`, "warn");
  });
}

export class DependencyPanel {
  private static instance?: DependencyPanel;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  /** Aborted on dispose so a doctor / `sdk list` child outlives nothing. */
  private readonly aborter = new AbortController();
  /** The report the webview is currently showing — the ONLY thing a `runAction`
   *  message is resolved against, so no string from the webview is ever run. */
  private lastReport: DependencyReport | null = null;
  /** Monotonic: a slow earlier refresh must not overwrite a newer report. */
  private generation = 0;
  /** The #349 offer is once per panel, not once per refresh — the state manager
   *  fires on every window focus, and a toast per focus is a nag. */
  private offeredBootstrap = false;
  /** A state change that landed while this panel was hidden, owed a refresh
   *  when it comes back. Refreshing here is a `tan doctor --build` SPAWN, and
   *  `retainContextWhenHidden` keeps the panel (and this subscription) alive
   *  for as long as the tab exists — so without the gate every window focus
   *  spawned a doctor for a table nobody was looking at. */
  private staleWhileHidden = false;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly stateMgr: StateManager,
  ) {
    this.panel = vscode.window.createWebviewPanel(
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

    this.panel.webview.html = buildWebviewHtml(
      this.panel.webview,
      context.extensionUri,
      WEBVIEW_MODE,
    );

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => this.handleMessage(msg),
      undefined,
      this.disposables,
    );

    // The shared state, not a seventh readiness query of our own: it already
    // re-derives on window focus, on an `alpSdk` settings edit, and at both
    // ends of a bootstrap run — which is every moment this table can change.
    // Gated on visibility, and caught up exactly once when the tab returns.
    this.disposables.push(
      this.stateMgr.onStateChange(() => {
        if (!this.panel.visible) {
          this.staleWhileHidden = true;
          return;
        }
        this.refresh();
      }),
      this.panel.onDidChangeViewState(() => {
        if (!this.panel.visible || !this.staleWhileHidden) return;
        this.staleWhileHidden = false;
        this.refresh();
      }),
    );

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  /** Open (or reveal) the dependency panel. */
  static open(context: vscode.ExtensionContext, stateMgr: StateManager): void {
    if (DependencyPanel.instance) {
      DependencyPanel.instance.panel.reveal(vscode.ViewColumn.Active);
      DependencyPanel.instance.refresh();
      return;
    }
    DependencyPanel.instance = new DependencyPanel(context, stateMgr);
  }

  /** `WebviewToExtMessage` is the whole protocol union, so every case this
   *  panel does not own falls through to a deliberate no-op rather than being
   *  narrowed away — one `default` beats a second, drifting union here. */
  private handleMessage(msg: WebviewToExtMessage): void {
    switch (msg.type) {
      case "ready":
        this.refresh();
        break;
      case "refreshDependencies":
        // The user asked, so this is the one path allowed to spend a GitHub
        // request on the latest-SDK lookup regardless of the cache TTL.
        this.refresh({ refreshLatestSdk: true });
        break;
      case "runDependencyAction":
        this.runRowAction(msg.name);
        break;
      case "openUrl":
        if (msg.url.startsWith("https://") || msg.url.startsWith("vscode://")) {
          fireAndForget(
            vscode.env.openExternal(vscode.Uri.parse(msg.url)),
            "opening a link",
          );
        }
        break;
      case "closePanel":
        this.panel.dispose();
        break;
      default:
        break;
    }
  }

  private refresh(options: { refreshLatestSdk?: boolean } = {}): void {
    const generation = ++this.generation;
    void this.runRefresh(generation, options.refreshLatestSdk === true).catch(
      (err: unknown) => {
        // Superseded, gone, or the window is tearing down — none of those is a
        // failure to report, and repainting over a newer answer is worse.
        if (generation !== this.generation || this.aborter.signal.aborted) {
          return;
        }
        if (isCancellation(err)) return;
        // Whatever it was — `collectProjectContext`, a memento write, an
        // aborted child — the view must be told. Left uncaught, the panel sat
        // on "Running checks…" with Refresh disabled forever while the
        // rejection surfaced as a nameless `Canceled: Canceled`.
        log(`[deps] the dependency check failed: ${err}`, "warn");
        this.post(
          generation,
          null,
          "The dependency check did not finish. See the Alp SDK output channel.",
        );
      },
    );
  }

  /**
   * One refresh: the doctor table first, the remote "latest" cell second.
   *
   * TWO posts, deliberately. The view re-renders on every push and the
   * generation guard already orders them, so there is no reason for ten rows
   * of parsed data to wait on a live GitHub call that fills one cell.
   */
  private async runRefresh(
    generation: number,
    refreshLatestSdk: boolean,
  ): Promise<void> {
    const { report, error } = await buildDependencyReport(
      this.context,
      this.stateMgr.state,
      // `refreshLatestSdk` doubles as "the user explicitly clicked Refresh" —
      // the one direct ask among this function's callers (`ready`,
      // `onStateChange`, and this) — so it also decides whether a fresh tan
      // CLI download may show ADR 0021's consent dialog.
      { signal: this.aborter.signal, interactive: refreshLatestSdk },
    );
    if (!this.post(generation, report, error) || !report) return;
    this.maybeOfferBootstrap(report);
    const filled = await withLatestSdk(this.context, report, {
      signal: this.aborter.signal,
      refreshLatestSdk,
    });
    if (filled) this.post(generation, filled);
  }

  /** Post one report to the view. Dropped (returning false) when a later
   *  refresh has already answered or the panel is gone — posting then would
   *  put stale rows back on screen. */
  private post(
    generation: number,
    report: DependencyReport | null,
    error?: string,
  ): boolean {
    if (generation !== this.generation || this.aborter.signal.aborted) {
      return false;
    }
    this.lastReport = report;
    const message: ExtToWebviewMessage = {
      type: "dependencyReport",
      report,
      error,
    };
    fireAndForget(
      this.panel.webview.postMessage(message),
      "posting the dependency report",
    );
    return true;
  }

  /**
   * #349: a Zephyr workspace that is absent — or present with a `.west/config`
   * manifest naming a directory that is gone — is the one gap in this table
   * with no per-row fix, because `tan bootstrap` is the fix and it is a whole
   * terminal run. Offered from the report already in hand, so it costs no
   * second CLI run.
   */
  private maybeOfferBootstrap(report: DependencyReport): void {
    if (this.offeredBootstrap) return;
    const project = collectProjectContext();
    // `tan bootstrap` CREATES a venv and a west workspace in its working
    // directory, so with no folder open there is nowhere safe to run and the
    // offer is withheld entirely.
    const root = project.workspaceRoot;
    if (!root) return;
    // Local filesystem probe — true even when tan's own `workspace` check
    // passes, which it does whenever an ambient `$ZEPHYR_BASE` resolves.
    const dangling = danglingWestManifest(project.sdkRoot);
    const workspaceMissing = report.rows.some(
      (row) => row.name === "workspace" && row.status === "fail",
    );
    if (!dangling && !workspaceMissing) return;
    this.offeredBootstrap = true;
    // Its own handler: this awaits a toast, and an unanswered toast is the
    // likeliest main-thread call pending when the window goes away.
    fireAndForget(
      offerBootstrapFix(this.context, root, dangling),
      "the Zephyr workspace offer",
    );
  }

  /**
   * Resolve a row id against the report the webview is currently showing and
   * run whatever action THAT row carries. The webview names a row; it never
   * hands over a command to execute.
   */
  private runRowAction(name: string): void {
    const row = this.lastReport?.rows.find(
      (candidate) => candidate.name === name,
    );
    if (!row?.action) return;
    // tan's own `sevenZip` row status (`this.lastReport` already holds it) —
    // the Zephyr SDK dispatch reads it for its post-install notice and must
    // not re-probe the host for it.
    const sevenZip = this.lastReport?.rows.find(
      (candidate) => candidate.name === "sevenZip",
    );
    runDependencyAction({
      action: row.action,
      rowName: row.name,
      cwd: collectProjectContext().workspaceRoot ?? undefined,
      sevenZipStatus: sevenZip?.status,
    });
  }

  private dispose(): void {
    DependencyPanel.instance = undefined;
    this.aborter.abort();
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }
}
