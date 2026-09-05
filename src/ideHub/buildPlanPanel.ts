// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { runAlpCommand, runAlpStreamed } from "../alpCli/vscodeAdapter";
import {
  type ExtToWebviewMessage,
  type SizeReport,
  type WebviewToExtMessage,
} from "./messages";
import { buildWebviewHtml } from "./webviewHtml";
import { buildMemoryView } from "@alp-sdk/core/systemManifest/memoryView";
import type { SystemManifest } from "@alp-sdk/core/systemManifest/models";
import { parseSystemManifest } from "@alp-sdk/core/systemManifest/service";
import { manifestFreshness } from "@alp-sdk/core/systemManifest/staleness";
import { readLastBuild } from "../build/lastBuild";
import { warnIfCliCannotBuildSom } from "../build/somCliFloorGuard";
import {
  BUILD_RUN_NAME,
  FLASH_RUN_NAME,
  isStreamedRunActive,
  log,
  releaseStreamedRun,
  reserveStreamedRun,
} from "../util";
import {
  planCliOutcome,
  planFailure,
  planPrecondition,
  planSuccess,
} from "../notify/service";
import { notifyAsync } from "../notify/vscodeAdapter";
import { collectProjectContext } from "../project/vscodeAdapter";
import {
  deferredBuildOptionMessage,
  retiredBuildOptionMessage,
} from "../alpCli/pinnedSurface";
import {
  MATERIALISE_SHAPE,
  SIZE_REPORT_SHAPE,
  checkTanPayload,
} from "@alp-sdk/core/tanPayloadShape";

/**
 * The manifest file's mtime in epoch ms, or `null` when it cannot be read.
 *
 * `null` rather than a throw or a fallback: a stat that fails is "no claim",
 * and `manifestFreshness` renders that as `unknown`. Substituting `Date.now()`
 * here would make an unreadable file look freshly written, which is the exact
 * shape of the bug #470 is about.
 */
function manifestWrittenAt(file: string): number | null {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

const PANEL_VIEW_TYPE = "alp-ide.buildPlan";
const PANEL_TITLE = "Alp Build Plan";

/**
 * Full-tab preview of the SDK-emitted build plan (`tan build --plan`, ADR 0014).
 *
 * A webview is justified here — the plan is a genuinely visual surface (per-core
 * slices, generated config artefacts, warnings). It is the live home for the
 * build-plan view; the actions (materialise / build) are delegated to the CLI.
 *
 * THREE OF THE FLAGS THIS PANEL WAS BUILT ON ARE DEFERRED AT THE PIN (#541).
 * `--plan`, `--manifest` and `--manifest-from` are all accepted by `tan build`
 * and all do nothing: their shared help wording is "Accepted by other
 * commands; not implemented for `build` yet (tan-cli#427)". So the plan and
 * the system manifest cannot be fetched here at all, and this panel no longer
 * spawns for either — see `postBuildPlanUnavailable`. What it still runs is
 * `build --materialise`, `build` and `size`, all of which are live.
 */
/** The manifest as the customer refers to it, relative to the project root.
 *  Project-relative and never absolute: this string reaches the webview as
 *  error text, and an absolute path there names the developer's home
 *  directory in a panel a customer may screenshot. */
const MANIFEST_DISPLAY_PATH = "build/system-manifest.yaml";

export class BuildPlanPanel {
  private static instance?: BuildPlanPanel;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(private readonly context: vscode.ExtensionContext) {
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
      "build-plan",
    );

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtMessage) => this.handleMessage(msg),
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);

    // Re-derive when board.yaml or the emitted manifest changes under the
    // active workspace (a build refreshes the manifest). `interactive: false`
    // — a file save, not a direct user ask.
    //
    // NOTHING HERE SPAWNS A DEFERRED FLAG ANY MORE (#541). This used to call
    // `handleRequestBuildPlan(false)` and `handleRequestSystemManifest(false)`,
    // so every board.yaml save fired two `tan build` runs whose flags this pin
    // defers — two processes per keystroke-to-disk that could not answer the
    // question they were asked.
    //
    // The two survivors are here for different reasons, and the difference is
    // what decides membership: a watcher exists to re-derive something that
    // CHANGED. `tan size` measures the ELFs, and a build moves them.
    // `postSystemManifest` spawns nothing, but it reports whether
    // `build/system-manifest.yaml` exists and whether the last build wrote it
    // (#470) — both read off the file this watcher is watching. The build-plan
    // message is the one that is genuinely FIXED text, so re-posting it on a
    // save would be churn with no new fact in it; the panel said it when it
    // opened and the answer cannot have moved.
    const refresh = () => {
      this.postSystemManifest();
      void this.handleRequestSliceSizes(false);
    };
    for (const glob of ["**/board.yaml", "**/system-manifest.yaml"]) {
      const watcher = vscode.workspace.createFileSystemWatcher(glob);
      this.disposables.push(
        watcher,
        watcher.onDidChange(refresh),
        watcher.onDidCreate(refresh),
        watcher.onDidDelete(refresh),
      );
    }
  }

  /** Open (or reveal) the build-plan panel. */
  static open(context: vscode.ExtensionContext): void {
    if (BuildPlanPanel.instance) {
      BuildPlanPanel.instance.panel.reveal(vscode.ViewColumn.Active);
    } else {
      BuildPlanPanel.instance = new BuildPlanPanel(context);
    }
  }

  private handleMessage(msg: WebviewToExtMessage): void {
    switch (msg.type) {
      // The view auto-requests the plan on mount, so `ready` needs no push.
      case "ready":
        break;
      case "requestBuildPlan":
        // The view posts this on mount, i.e. the user's explicit "Alp: Build
        // Plan" open — `interactive: true`, unlike the file-watcher `refresh`.
        // Only `handleRequestSliceSizes` spawns anything, so it is the only
        // one that carries the flag.
        this.postBuildPlanUnavailable();
        this.postSystemManifest();
        void this.handleRequestSliceSizes(true);
        break;
      case "materialiseBuildPlan":
        void this.handleMaterialiseBuildPlan();
        break;
      case "runBuild":
        void this.handleRunBuild();
        break;
      case "flashSlice":
        this.handleSliceCommand(msg.coreId);
        break;
      case "openUrl":
        if (msg.url.startsWith("https://") || msg.url.startsWith("vscode://")) {
          void vscode.env.openExternal(vscode.Uri.parse(msg.url));
        }
        break;
      case "closePanel":
        this.panel.dispose();
        break;
    }
  }

  /**
   * Say that this tan cannot produce a build plan, and say why.
   *
   * NO SPAWN. `tan build --plan` is accepted by click and deferred by the
   * implementation (tan-cli#427), so the old call could only ever come back as
   * a failure the panel then had to classify — a process per panel open and
   * per board.yaml save, for an answer the pin already determines.
   *
   * The customer is told at least as much as before. The CLI's own refusal
   * read "`tan build --plan` is deferred and not available in this build (see
   * https://github.com/alplabai/tan-cli/issues/427)."; `deferredBuildOption-
   * Message` carries the flag, the pinned version, that same issue and its
   * URL, plus the one thing the CLI could not say — that nothing ran, so there
   * is no failed subprocess to go looking for in the log.
   *
   * It reaches the view through the SAME `buildPlanData` message with the same
   * `plan: null` + `error` shape the `envelope.ok === false` branch used, so
   * the view's empty state is unchanged.
   *
   * `deferredBuildOptionMessage` checks `--plan` against
   * `DEFERRED_BUILD_OPTIONS` rather than taking this call site's word for it,
   * so the day tan-cli#427 lands this stops saying "deferred" about a flag
   * that works and starts saying the panel does not send it — which by then
   * is the only true half.
   */
  private postBuildPlanUnavailable(): void {
    void this.panel.webview.postMessage({
      type: "buildPlanData",
      plan: null,
      error: deferredBuildOptionMessage("--plan"),
    } satisfies ExtToWebviewMessage);
  }

  /**
   * The system manifest, read from disk (#580).
   *
   * ── Why this stopped waiting on the CLI ───────────────────────────────────
   *
   * It used to post `manifest: null` unconditionally, because `--manifest` and
   * `--manifest-from` are deferred and this panel does not spawn a call the
   * pinned CLI cannot answer. tan-cli#427 has since closed, and it did NOT
   * deliver those flags — it RETIRED them, and named the replacement in the
   * same breath: `build/system-manifest.yaml`, which "a native `tan build`
   * already writes and which is plain YAML a caller can read directly".
   *
   * So the file was never the CLI's to hand over. `src/debug.ts` and
   * `src/flash/gate.ts` have both read it this way the whole time, through the
   * same `parseSystemManifest`, and its doc comment names THIS PANEL as one of
   * the three hand-rolled copies that parser exists to replace. Waiting was the
   * mistake; the renderer for this data has been written, correct and
   * unreachable in `BuildPlanView.tsx` the entire time.
   *
   * `parseSystemManifest` defaults every array it returns (`arr()`), so
   * `manifest.ipc.length` and `manifest.helper_mcus.length` cannot throw on a
   * partial document — the crash-the-panel failure `tanPayloadShape.ts`
   * describes is not reachable from here.
   *
   * ── What is still posted when there is no manifest ────────────────────────
   *
   * `postBuild` and `provenance` are computed FIRST and posted on every path.
   * They are facts about the file on disk — whether it exists, and whether the
   * last build wrote it (#470) — and a parse failure does not unmake them.
   * They are what dates a manifest that IS rendered, so they matter more now
   * than they did when nothing was rendered at all.
   */
  private postSystemManifest(): void {
    // #607: this used to read `workspaceFolders[0]` directly — a DIFFERENT
    // resolver than `requireWorkspace()`'s `collectProjectContext().
    // workspaceRoot`, so on a multi-root workspace this could look at a folder
    // the panel's OWN spawns never wrote to. `docs/ARCHITECTURE_RULES.md` §3
    // is the same rule `requireWorkspace` already follows; this brings the
    // panel's readers into agreement with its writers.
    const cwd = collectProjectContext().workspaceRoot;
    const built = cwd
      ? path.join(cwd, ...MANIFEST_DISPLAY_PATH.split("/"))
      : undefined;
    const postBuild = Boolean(built && fs.existsSync(built));

    // #470: existence is not freshness. `postBuild` above says a manifest is
    // on disk; this says whether it describes the LAST build. With no file
    // there is no provenance to report — there is nothing on disk to date.
    const provenance = postBuild
      ? manifestFreshness({
          writtenAt: manifestWrittenAt(built as string),
          lastBuild: readLastBuild(this.context),
          now: Date.now(),
        })
      : null;

    // Nothing on disk. There is no projection to fall back on either: the
    // pre-build `--manifest` is retired, not pending, so the message names
    // what produces the file rather than a flag to wait for.
    if (!postBuild) {
      void this.panel.webview.postMessage({
        type: "systemManifestData",
        manifest: null,
        postBuild,
        provenance,
        memory: null,
        error: retiredBuildOptionMessage("--manifest"),
      } satisfies ExtToWebviewMessage);
      return;
    }

    let manifest: SystemManifest | null = null;
    let error: string | undefined;
    try {
      manifest = parseSystemManifest(fs.readFileSync(built as string, "utf8"));
    } catch (readError) {
      // Named, not swallowed. `parseSystemManifest` throws on bad YAML and on a
      // `schema_version` this build does not consume, and the second one is a
      // real version-skew message the customer needs — rendering an empty
      // panel instead would hide the one sentence that says what to upgrade.
      const detail =
        readError instanceof Error ? readError.message : String(readError);
      error = `\`${MANIFEST_DISPLAY_PATH}\` could not be read: ${detail}`;
    }

    void this.panel.webview.postMessage({
      type: "systemManifestData",
      manifest,
      postBuild,
      provenance,
      // Derived here, from the manifest that was just parsed, so the webview
      // never re-derives an address off a raw field (#484). Null with no
      // manifest, including on the parse-error path above: there is nothing to
      // place, and an empty map would read as "no memory in use".
      memory: manifest ? buildMemoryView(manifest) : null,
      error,
    } satisfies ExtToWebviewMessage);
  }

  /** Fetch per-slice firmware footprint vs the SoM memory budget from
   *  `tan size --format json` (#359, the memory half of #331).
   *
   *  Post-build only. `tan size` measures the ELF each slice produced, so with
   *  no `build/system-manifest.yaml` every row would read `not-built` — a
   *  subprocess per refresh to render nothing. Posts `report: null` in that
   *  case so the view clears any stale numbers from a previous build.
   *
   *  Never passes `--fail-over-budget`: that flag makes `tan size` exit
   *  non-zero, and this panel reports a footprint, it does not fail anything.
   *  A missing size tool is not an error either — tan falls back to reading
   *  ELF section headers and still returns rows. */
  private async handleRequestSliceSizes(interactive: boolean): Promise<void> {
    // #607: same resolver as `requireWorkspace()`, not `workspaceFolders[0]` —
    // see `postSystemManifest`'s note just above. A build dispatched
    // from this panel always writes under THIS root, so the watcher (which
    // fires on any `**/board.yaml`/`**/system-manifest.yaml` change) and this
    // reader now agree on where to look.
    const cwd = collectProjectContext().workspaceRoot;
    if (!cwd) {
      // `report: null` with no reason at all reads the same as "not built
      // yet" — the two must not be indistinguishable, so this says which one
      // it is. `error` is sourced from the SAME `planPrecondition` call the
      // toast below renders, not a hand-typed copy of its wording — a copy
      // is a second string this could drift from (and it already had:
      // `planPrecondition`'s own `actions: [{id: "openFolder"}]` never
      // reached the panel at all, only the toast).
      const plan = planPrecondition("noWorkspace", {
        operation: "see slice sizes",
      });
      notifyAsync(plan);
      void this.panel.webview.postMessage({
        type: "sliceSizesData",
        report: null,
        error: plan.message,
      } satisfies ExtToWebviewMessage);
      return;
    }
    const built = path.join(cwd, "build", "system-manifest.yaml");
    if (!fs.existsSync(built)) {
      // "No system manifest", not "no build output" — this checks for ONE
      // file, `build/system-manifest.yaml`, which is exactly what `--manifest`
      // / `--manifest-from` are deferred for at this pin (tan-cli#427). The
      // sibling reader ten lines up posts `deferredBuildOptionMessage
      // ("--manifest")` for the very same reason, into the same "System
      // manifest" section — "no build output" here would tell a project that
      // HAS built that it has not, right beside a message saying the manifest
      // flag is merely deferred.
      void this.panel.webview.postMessage({
        type: "sliceSizesData",
        report: null,
        error: `No system manifest at ${built}.`,
      } satisfies ExtToWebviewMessage);
      return;
    }

    // `interactive` comes from the caller: `true` for the webview's own
    // `requestBuildPlan` (posted on mount — the user opened this panel),
    // `false` for the constructor's file watcher (a board.yaml save is not a
    // direct ask, and an interactive resolution there would pop ADR 0021's
    // consent modal out of a file save). This is now the ONLY handler here
    // that spawns, so it is the only one the distinction still applies to.
    const { outcome } = await runAlpCommand(this.context, ["size"], cwd, {
      interactive,
    });
    const envelope = outcome.envelope;
    const shapeError =
      envelope && envelope.ok
        ? checkTanPayload(envelope.data, SIZE_REPORT_SHAPE, "size")
        : null;
    const msg: ExtToWebviewMessage =
      envelope && envelope.ok && !shapeError
        ? { type: "sliceSizesData", report: envelope.data as SizeReport }
        : {
            type: "sliceSizesData",
            report: null,
            error:
              shapeError ?? envelope?.issues?.[0]?.message ?? outcome.message,
          };
    void this.panel.webview.postMessage(msg);
  }

  /** The workspace root every spawning handler must have, or `undefined` after
   *  telling the customer why nothing ran.
   *
   *  `cwd` is optional all the way down to `child_process.spawn`, and no layer
   *  substitutes a default — so an unguarded handler with no folder open runs
   *  tan against the EXTENSION HOST's working directory (on Windows, the VS
   *  Code install directory), and `build --materialise` writes the plan's
   *  generated files there. `alp.showBuildPlan` has no `when`/`enablement`, so
   *  the panel really does open with no folder. `src/west.ts` refuses the same
   *  shape with the same precondition.
   *
   *  Resolution goes through `collectProjectContext`, NOT
   *  `workspaceFolders[0]` — `docs/ARCHITECTURE_RULES.md` §3 forbids
   *  reimplementing root resolution per slice, and the two disagree on a
   *  multi-root workspace: folder[0] can be a docs folder while the board.yaml
   *  project is folder[1]. Reading folder[0] here would leave the panel's
   *  Build button and the palette Build running in different directories, and
   *  if folder[0] carries its own `board.yaml` the panel would materialise
   *  into the wrong project while passing this very guard. */
  private requireWorkspace(operation: string): string | undefined {
    const cwd = collectProjectContext().workspaceRoot;
    if (!cwd) {
      notifyAsync(planPrecondition("noWorkspace", { operation }));
      return undefined;
    }
    return cwd;
  }

  private async handleMaterialiseBuildPlan(): Promise<void> {
    const cwd = this.requireWorkspace("materialise the build plan");
    if (!cwd) return;
    // #606/#9: BEFORE the reservation below, not inside it.
    // `warnIfCliCannotBuildSom` can spawn `tan --version`
    // (`probeTanVersion` -> `readResolvedCliVersion`, a 3s-timeout child
    // process) — reserving `BUILD_RUN_NAME` first would refuse the Build
    // button with `"Alp Build" is still running` for that whole window while
    // nothing is actually running yet. `--materialise` is still `tan build`
    // under the Kconfig abort #502 warns about, and this handler was one of
    // the three sites that skipped the warning entirely.
    await warnIfCliCannotBuildSom(this.context, cwd);
    // Envelope mode, but it WRITES into the build tree, so it takes the build
    // reservation like a build does — materialising underneath a running build
    // rewrites the very files that build is consuming.
    if (!reserveStreamedRun(BUILD_RUN_NAME)) {
      notifyAsync(
        planFailure({
          severity: "warning",
          operation: "Materialising the build plan",
          cause: `"${BUILD_RUN_NAME}" is still running.`,
          detail: "Wait for it to finish before materialising the plan.",
          actions: [
            isStreamedRunActive(BUILD_RUN_NAME)
              ? { id: "showOutput" }
              : { id: "showTerminal", arg: BUILD_RUN_NAME },
          ],
        }),
      );
      return;
    }
    try {
      // `interactive: true`: reached only from the "Materialise" button click
      // (`materialiseBuildPlan`), never from the file-watcher `refresh()` in
      // the constructor — unlike `handleRequestSliceSizes` below, which that
      // same watcher calls and must stay non-interactive.
      const { outcome } = await runAlpCommand(
        this.context,
        ["build", "--materialise"],
        cwd,
        { interactive: true },
      );
      const envelope = outcome.envelope;
      if (envelope && envelope.ok) {
        // Shape-check before reading, like the `size` reader below. This path
        // needs it MORE, not less: `size` spells its access
        // `report.slices.map`, which throws and blanks a section when tan
        // renames a field. This one spells it `written ?? []`, so the same
        // drift reports "Materialised 0 file(s)" as a SUCCESS — indistinguish-
        // able from a legitimate no-op, and the user acts on it.
        const shapeError = checkTanPayload(
          envelope.data,
          MATERIALISE_SHAPE,
          "build --materialise",
        );
        if (shapeError) {
          notifyAsync(
            planFailure({
              operation: "Materialising the build plan",
              cause: shapeError,
            }),
          );
          return;
        }
        const written = (envelope.data as { written: string[] }).written;

        // An ok run that wrote NOTHING is not a success to report as one. Every
        // project tan will plan for has at least one enabled slice, and each
        // contributes at least its own `alp.conf` — a real materialise of the
        // sample project writes five files. Zero means the run did not do its
        // job, and the caller is about to build against whatever was already on
        // disk. Related and NOT fixed here: tan-cli#505 item 3 — a PARTIAL loss
        // (one slice demoted, its `configArtefacts` dropped) still arrives as
        // `ok: true`, `issues: []`, exit 0, with no demotion signal anywhere in
        // the envelope. This extension cannot detect that until tan reports it;
        // listing the paths below is what lets a user see five become three.
        if (written.length === 0) {
          notifyAsync(
            planFailure({
              operation: "Materialising the build plan",
              cause: "tan reported success but wrote no files.",
              detail:
                "The build tree was not updated, so a build now would use " +
                "whatever is already on disk. Check the Alp SDK log, then " +
                "re-run Materialise.",
              actions: [{ id: "showOutput" }],
            }),
          );
          return;
        }

        // The paths, not just the count: a silently dropped slice shows up here
        // as a missing `build/<core>-<backend>/alp.conf` and nowhere else.
        log(
          `[buildPlan] materialised ${written.length} file(s): ` +
            written.join(", "),
        );
        // Any issue tan reported on a SUCCESSFUL run — warnings are discarded
        // by an `ok`-only branch, which is how #477's `sdk.network-required`
        // went unseen.
        for (const issue of envelope.issues ?? []) {
          log(`[buildPlan] materialise ${issue.severity}: ${issue.message}`);
        }

        // Status bar, not a toast: the very next line re-requests the plan, so
        // the panel the user is looking at already reports the new on-disk
        // state.
        notifyAsync(
          planSuccess(
            `Materialised ${written.length} file(s) under the build tree.`,
          ),
        );
        // The plan view reflects on-disk state, so a materialise would
        // normally re-request it. There is nothing to re-request at this pin —
        // `build --plan` is deferred (tan-cli#427) — and the sizes DO move,
        // because materialising rewrites the build tree the ELFs sit in.
        // `interactive: true`: the direct follow-through of the "Materialise"
        // click just above, not a background re-derive.
        await this.handleRequestSliceSizes(true);
      } else {
        // Severity comes from the outcome: the most common materialise failure
        // is a board.yaml validation error (exit 2 ⇒ warning), which must not
        // read like the write failure that exits 3.
        notifyAsync(
          planCliOutcome(outcome, {
            operation: "Materialising the build plan",
          }),
        );
      }
    } finally {
      releaseStreamedRun(BUILD_RUN_NAME);
    }
  }

  private async handleRunBuild(): Promise<void> {
    const cwd = this.requireWorkspace("build");
    if (!cwd) return;
    // #606: the Build button was one of the three `tan build` sites that
    // skipped #502's Renesas CLI-floor warning.
    await warnIfCliCannotBuildSom(this.context, cwd);
    // Stream to the "Alp SDK" channel (persistent), not a terminal that dies on
    // exit — same reason as the Build/Flash orchestrator commands (util.ts).
    await runAlpStreamed(this.context, ["build"], {
      name: BUILD_RUN_NAME,
      cwd,
    });
  }

  /** Flash a single manifest slice — `tan flash --core <id>`. The view only
   *  shows the button when the manifest says the slice supports it. Streams to
   *  the "Alp SDK" channel (persistent) instead of a terminal that dies on exit:
   *  a `tan flash --core` that fails (e.g. `west` not on PATH) otherwise left
   *  only "failed to launch (exit 1)" with the real reason gone.
   *  There is no per-slice build equivalent: `tan build` has no `--core`
   *  option (only `flash`/`run` do), so the Build button only runs the whole
   *  plan (`runBuild`). */
  private handleSliceCommand(coreId: string): void {
    const cwd = this.requireWorkspace("flash this slice");
    if (!cwd) return;
    // FLASH_RUN_NAME, not a per-core name: a second core is a second write to
    // the same board, so per-core names would be two reservations and two
    // programmers at once. The core is in the logged command line.
    //
    // `--confirm` is deliberately absent — but it is NOT what makes this argv
    // safe: three of tan's six backends write on a bare `tan flash`
    // (tan-cli#796). `gateFlashDispatch` (`src/flash/gate.ts`) is what spawns
    // nothing until the customer accepts, and that dialog is the one place
    // they learn what `--core` costs them — tan's own help for it is "skips
    // every other slice AND all helpers", so this button leaves the rest of
    // the board on its old images.
    void runAlpStreamed(this.context, ["flash", "--core", coreId], {
      name: FLASH_RUN_NAME,
      cwd,
    });
  }

  private dispose(): void {
    BuildPlanPanel.instance = undefined;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
  }
}
