// SPDX-License-Identifier: Apache-2.0
//
// SDK Manager webview message handlers, extracted from sdkManagerPanel.ts so a
// host panel (the Hub / OverviewPanel) can own the SDK Manager surface without
// a second panel class. `createSdkMessageHandler(deps)` returns a predicate:
// it handles the SDK-specific message types and returns true, or returns false
// so the host handles its own `ready`/`runCommand`/`openUrl`/`closePanel`.
//
// The `handleUninstallSdk` path deletes a folder from disk (`removeSdkTree`,
// which classifies the failure — see that module) after a
// modal confirmation — the confirm, the Alp-managed-vs-external path check, and
// the active-pointer clear are preserved exactly as they were in the panel.

import type { SdkInstallAdapter } from "@alp-sdk/core/sdk/adapterCore";
import type { SdkRelease } from "@alp-sdk/core/sdk/models";
import { installSdkRelease } from "@alp-sdk/core/sdk/service";
import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import { sameUserPath } from "@alp-sdk/core/paths";
import * as vscode from "vscode";
import { proxyEnvAdditions, runAlpCommand } from "../alpCli/vscodeAdapter";
import {
  isCancellation,
  planCliOutcome,
  planConfirm,
  planFailure,
  planSuccess,
} from "../notify/service";
import { notify, notifyAsync } from "../notify/vscodeAdapter";
import {
  clearActiveSdk,
  setActiveSdk,
  warnIfWestManifestDangling,
} from "../sdk/activeSdk";
import { removalFailureMessage, removeSdkTree } from "../sdk/removeTree";
import { writeAlpSetting } from "../sdk/settingsWrite";
import { log as logChannel } from "../util";
import type { ExtToWebviewMessage, WebviewToExtMessage } from "./messages";
import { sdkCacheRoot } from "./vscodeAdapter";

/**
 * How much disk `tan bootstrap` needs, for the sentence offered right after an
 * install. Measured, not guessed: `du -sh ~/.alp/sdk` after a v0.15.0-rc1
 * bootstrap on darwin-arm64 was 2.9G — 1.6G `modules`, 666M `.venv`, 577M
 * `zephyr`, 53M the SDK checkout itself, 11M `bootloader`. Rounded UP, because
 * a customer who frees exactly the number we print must not run out mid-fetch.
 * Excludes a separately installed Zephyr SDK toolchain.
 */
const BOOTSTRAP_DISK_ESTIMATE = "about 3 GB";

export interface SdkHandlerDeps {
  context: vscode.ExtensionContext;
  post: (msg: ExtToWebviewMessage) => void;
  refresh: () => Promise<void>;
}

/**
 * True for the ONE clone failure the customer can act on: `git` is not on
 * PATH, so `cp.spawn` never started a process at all and Node raised the
 * failure on the `error` event with `code: "ENOENT"`.
 *
 * Deliberately narrow. A clone that STARTED and failed — no network, a proxy
 * that refuses CONNECT, a private repo, a tag that does not exist — rejects
 * with the `git clone exited with code <n>` Error built below, which carries no
 * `code` at all. Collapsing the two would tell a customer behind a corporate
 * proxy to install a git they already have, and hide the retry that is their
 * actual fix.
 *
 * A cancelled install is not reached here (`cancelled` is checked first), and
 * an `AbortSignal` kill raises `ABORT_ERR` rather than `ENOENT` regardless.
 *
 * `syscall` is checked as well as `code` so the predicate stays about the SPAWN
 * and not about ENOENT in general — the `git` child is the only process this
 * install path starts today, but a filesystem ENOENT added inside the same
 * `try` later must not silently start telling customers to install git.
 */
function isMissingGit(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const errno = err as NodeJS.ErrnoException;
  return (
    errno.code === "ENOENT" && String(errno.syscall ?? "").startsWith("spawn")
  );
}

/**
 * Build a handler for the SDK Manager webview messages. Returns a function that
 * returns `true` when it consumed the message, `false` otherwise (so the host
 * can handle `ready`/`runCommand`/`openUrl`/`closePanel`).
 */
export function createSdkMessageHandler(
  deps: SdkHandlerDeps,
): (msg: WebviewToExtMessage) => boolean {
  const { context, post, refresh } = deps;

  async function handleSelectSdkPath(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: "Select Alp SDK root directory",
    });
    if (!uris || uris.length === 0) return;
    await handleSwitchSdk(uris[0].fsPath);
  }

  async function handleSwitchSdk(sdkPath: string): Promise<void> {
    try {
      await setActiveSdk(sdkPath);
    } catch (err) {
      // `setActiveSdk` awaits a toast and `alp.views.refresh` — both
      // main-thread RPCs — so at window teardown it rejects with a
      // CancellationError. The SDK switch was abandoned with the window; a
      // "couldn't set the active SDK" toast there tells the customer their
      // machine is broken when in fact their window closed.
      if (isCancellation(err)) {
        logChannel("[sdk] active-SDK switch abandoned, window closing");
        return;
      }
      // setActiveSdk already toasts its own not-an-SDK-root case and
      // writeAlpSetting its unsaved-settings case, so anything reaching here is
      // an unrelated throw: state the operation, keep the raw text in `detail`.
      // Fire-and-forget — the `refresh()` below must not wait on a toast.
      notifyAsync(
        planFailure({
          operation: "Setting the active SDK",
          cause: "Alp: couldn't set the active SDK.",
          detail: String(err),
          actions: [{ id: "openSettings", arg: "alpSdk.path" }],
        }),
      );
    }
    await refresh();
  }

  /** Delete a local SDK's folder from disk (after confirmation). Works for any
   *  local SDK — Alp-managed (~/.alp/sdk) or external (Browse / a checkout); the
   *  confirm spells out the path and warns when it isn't Alp-managed. Clears the
   *  active pointer if it pointed at the removed install. */
  async function handleUninstallSdk(sdkPath: string): Promise<void> {
    const cacheRoot = path.resolve(sdkCacheRoot());
    const target = path.resolve(sdkPath);
    const alpManaged =
      target === cacheRoot || target.startsWith(cacheRoot + path.sep);

    const name = path.basename(target);
    const detail = alpManaged
      ? `This permanently deletes ${target}.`
      : `${target} is not an Alp-managed install (added via Browse or a ` +
        `checkout). Permanently delete this folder from disk? This cannot be undone.`;
    // Audit verdict `keep`. `modalDetail` — not the channel-only `detail` — is
    // what keeps the absolute path and the "cannot be undone" warning ON the
    // dialog; routing it anywhere else would turn an irreversible delete
    // confirm into a dismissible toast. `deleteFromDisk` has no `run`, so the
    // pick still comes back and gates the fs.rmSync below.
    const confirm = await notify(
      planConfirm({
        message: `Remove SDK ${name}?`,
        modalDetail: detail,
        confirm: { id: "deleteFromDisk" },
      }),
    );
    if (confirm !== "deleteFromDisk") return;

    // NOT a bare `fs.rmSync`, and not for the reason first written here — see
    // `removeSdkTree`'s header, which records the measurement that corrected
    // it. Node already chmods and retries on Windows; what this buys is a
    // POSIX read-only DIRECTORY (which Node does not touch) and, mainly, a
    // failure message that names the cause instead of telling every failure to
    // close an editor.
    const removal = removeSdkTree(target);
    if (removal.ok) {
      if (removal.clearedAttributes) {
        // Channel only. The user asked for a delete and got one; how many
        // read-only bits it took is a fact for whoever reads a report later.
        logChannel(
          `[sdk] removed ${target} after clearing read-only attributes`,
        );
      }
    } else {
      notifyAsync(
        planFailure({
          operation: "Removing the SDK",
          // The cause is DECIDED, not guessed: the advice differs per cause,
          // and telling someone to close an editor over a permissions problem
          // is a wrong instruction, not merely an unhelpful one.
          cause: removalFailureMessage(removal.cause ?? "other"),
          detail: `${target}: ${removal.error ?? "unknown error"}`,
        }),
      );
      return;
    }

    // Clear the active SDK setting if it pointed at the removed install, so
    // nothing dangles after removal. The folder is already gone, so a failure
    // to clear the pointer must not abort the flow — it is caught and reported
    // instead of thrown (a throw on this fire-and-forget handler would become
    // an unhandled rejection and skip the refresh).
    const cfg = vscode.workspace.getConfiguration("alpSdk");
    const inspected = cfg.inspect<string>("path");
    // `sameUserPath`, not `===` (#361): these settings are HAND-TYPED, and
    // `path.resolve` normalises separators without folding case or dropping a
    // trailing slash. A setting of `c:\...0.13.0\` against a `target` of
    // `C:\...0.13.0` left the pointer naming an SDK that no longer exists —
    // the same dangling-pointer failure as #349, reached from the other side.
    const needWorkspace = Boolean(
      inspected?.workspaceValue &&
      sameUserPath(
        path.resolve(inspected.workspaceValue),
        target,
        process.platform,
      ),
    );
    const needGlobal = Boolean(
      inspected?.globalValue &&
      sameUserPath(
        path.resolve(inspected.globalValue),
        target,
        process.platform,
      ),
    );

    try {
      if (needWorkspace) {
        await writeAlpSetting(
          "path",
          undefined,
          vscode.ConfigurationTarget.Workspace,
        );
      }
      if (needGlobal) {
        await writeAlpSetting(
          "path",
          undefined,
          vscode.ConfigurationTarget.Global,
        );
      }
    } catch (err) {
      // Only an UNRELATED throw lands here. A `false` return means the settings
      // file was dirty, and `writeAlpSetting` has already said so — with Open
      // Settings + Retry on it — so notifying on that gave one Remove click two
      // toasts for one cause. `dedupeKey` could not have suppressed the second:
      // the pair is SEQUENTIAL (the first toast is awaited and already gone, so
      // its key is out of the presenter's on-screen set), and dedupe only drops
      // a plan whose key is on screen right now. Same rule as the Deactivate
      // path in `sdk/activeSdk.ts`.
      notifyAsync(
        planFailure({
          operation: "Clearing the active-SDK setting",
          cause:
            "Alp: the removed SDK is still named as the active one — clear " +
            "alpSdk.path, or use Deactivate to finish.",
          detail: String(err),
          severity: "warning",
          actions: [{ id: "openSettings", arg: "alpSdk.path" }],
        }),
      );
    }

    // The removal itself is transient news about a panel that re-renders one
    // line below — status bar, not a toast to dismiss. Fire-and-forget:
    // awaiting it would delay the repaint behind a user's click.
    notifyAsync(planSuccess(`Alp: removed SDK ${name}.`));
    await vscode.commands.executeCommand("alp.views.refresh");
    await refresh();

    // #349: deleting a version the west workspace's `.west/config` still names
    // is exactly how the reported breakage is created. This is the earliest
    // possible signal — `target` is gone, but `dirname(target)` is still the
    // topdir whose manifest pointer now dangles.
    warnIfWestManifestDangling(target);
  }

  /** Deactivate — clear the active SDK without deleting anything. */
  async function handleDeactivateSdk(): Promise<void> {
    try {
      await clearActiveSdk();
    } catch (err) {
      // Same seam as handleSwitchSdk: `clearActiveSdk` awaits
      // `alp.views.refresh`, so a closing window rejects it with a
      // CancellationError. Nothing failed — the deactivate was abandoned.
      if (isCancellation(err)) {
        logChannel("[sdk] active-SDK deactivate abandoned, window closing");
        return;
      }
      // writeAlpSetting handles (and explains) the dirty-settings case without
      // throwing, so a throw here is unrelated — plain sentence, raw text to
      // the channel.
      notifyAsync(
        planFailure({
          operation: "Deactivating the SDK",
          cause: "Alp: couldn't deactivate the SDK.",
          detail: String(err),
          actions: [{ id: "openSettings", arg: "alpSdk.path" }],
        }),
      );
    }
    await refresh();
  }

  async function handleRequestSdkReleases(): Promise<void> {
    // Delegate the GitHub releases fetch to `tan sdk list --online --format json`.
    //
    // `--online` is REQUIRED, not a nicety. Since tan v0.5.0 the GitHub
    // releases API query is gated behind it, and a plain `sdk list` answers
    // from nothing at all: `ok: true`, `exitCode: 0`, `"releases": []`, plus a
    // warning issue `sdk.network-required` whose message ends "Add --online to
    // fetch them." A success-shaped empty answer is indistinguishable from
    // "upstream has published no releases", so the panel rendered a
    // permanently empty Install list with no error on any surface. This
    // handler exists only to report what upstream published — the offline
    // mode has no caller here.
    //
    // `interactive: true`: reached only from the SDK Manager view's own mount
    // effect and its explicit Refresh button (`requestSdkReleases`), both
    // downstream of the user explicitly opening this panel — never a
    // background re-derive.
    const { outcome } = await runAlpCommand(
      context,
      ["sdk", "list", "--online"],
      undefined,
      {
        interactive: true,
      },
    );
    const envelope = outcome.envelope;
    if (!envelope || !envelope.ok) {
      // One planner call replaces both old branches: severity now comes from
      // `outcome.severity`, a missing binary offers Install tan CLI (the
      // `unavailable.reason` discriminant) instead of blaming the network, and
      // the envelope's own issues are named instead of being discarded.
      //
      // Fire-and-forget, never awaited: the `post` below is what stops the
      // webview's "Loading SDK list…" spinner, and a toast the user never
      // dismisses would otherwise hang the panel forever.
      notifyAsync(
        planCliOutcome(outcome, { operation: "Fetching the SDK list" }),
      );
      // Resolve the webview's "Loading SDK list…" spinner even on failure — the
      // toast explains why; an empty list drops the user to the actionable empty
      // state (Browse to a local SDK) instead of spinning forever.
      post({ type: "sdkReleasesLoaded", releases: [] });
      return;
    }
    // A successful envelope can still carry issues, and `sdk list` is the one
    // command whose warnings are the only explanation for an EMPTY but
    // successful result. Dropping them is what left the empty Install list
    // with no recorded cause on any surface — the channel line is the record
    // that survives the panel closing. Channel, not toast: this runs on every
    // panel mount, and the list itself is the primary signal.
    for (const issue of envelope.issues ?? []) {
      logChannel(`[sdk-list] ${issue.severity}: ${issue.message}`);
    }
    const releases =
      (envelope.data as { releases?: SdkRelease[] }).releases ?? [];
    post({ type: "sdkReleasesLoaded", releases });
  }

  async function handleRequestSdkInstall(version: string): Promise<void> {
    const cacheRoot = sdkCacheRoot();
    fs.mkdirSync(cacheRoot, { recursive: true });

    // Already installed → say so instead of a silent, instant no-op. Installs
    // are side-by-side under ~/.alp/sdk/<version>, so this never overwrites.
    const installed = path.join(cacheRoot, version);
    if (fs.existsSync(installed)) {
      // Carry the one-click Activate rather than sending the user to another
      // tab of the panel that raised this. `custom` has no `run` in the
      // presenter's table, so the pick comes back and this handler does the
      // work — chained off the promise instead of awaited, because the
      // `refresh()` below must not wait on a toast.
      void notify({
        severity: "info",
        channel: "toast",
        message: `Alp: SDK ${version} is already installed.`,
        actions: [{ id: "custom", title: "Activate" }],
      }).then((picked) => {
        if (picked === "custom") void handleSwitchSdk(installed);
      });
      await refresh();
      // Same #349 signal as the install below: this branch is the likelier one
      // to hit it, since re-pressing Install is what a user does when the
      // workspace is already misbehaving.
      warnIfWestManifestDangling(installed);
      return;
    }

    // Cloning the SDK is the longest operation this panel starts (minutes on a
    // slow link), so it is cancellable. The controller lives out here so the
    // adapter closure can hand its signal to `cp.spawn` — cancelling has to
    // kill the actual `git` child, not just stop awaiting it.
    const installAbort = new AbortController();
    let cancelled = false;
    const gitInstallAdapter: SdkInstallAdapter = (ver, destPath) =>
      new Promise<void>((resolve, reject) => {
        const proc = cp.spawn(
          "git",
          [
            "clone",
            "--branch",
            ver,
            "--depth",
            "1",
            "https://github.com/alplabai/alp-sdk.git",
            destPath,
          ],
          // Same proxy gap-fill as the tan seams: git reads HTTPS_PROXY, and a
          // corporate machine that needs a proxy to reach GitHub fails this
          // clone for the identical reason `tan sdk list` failed. `env`
          // REPLACES the environment for `cp.spawn`, hence the spread — which
          // is also what carries NO_PROXY and PATH through untouched.
          {
            signal: installAbort.signal,
            env: { ...process.env, ...proxyEnvAdditions() },
          },
        );
        proc.on("exit", (code) =>
          code === 0
            ? resolve()
            : reject(new Error(`git clone exited with code ${code}`)),
        );
        proc.on("error", reject);
      });

    const sendProgress = (
      log: string,
      done: boolean,
      success?: boolean,
    ): void => {
      // Tee every install-progress line into the "Alp SDK" channel so the
      // transcript survives the panel closing (P1.2). The param is named `log`
      // (the webview message field), so the channel logger is aliased.
      logChannel(`[sdk-install] ${log}`);
      post({ type: "sdkInstallProgress", log, done, success });
    };

    sendProgress(`Installing SDK ${version}…`, false);

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Alp: Installing SDK ${version}`,
        cancellable: true,
      },
      async (_progress, token) => {
        const sub = token.onCancellationRequested(() => {
          cancelled = true;
          installAbort.abort();
        });
        try {
          await installSdkRelease(
            version,
            cacheRoot,
            gitInstallAdapter,
            (p) => fs.existsSync(p),
            (p) => {
              try {
                return fs.readFileSync(p, "utf8");
              } catch {
                return "";
              }
            },
          );
          // #349: installing a version does NOT repair a `.west/config` whose
          // `[manifest] path` still names a removed one — west reads that file
          // directly and independently of the active-SDK pointer, so the
          // workspace stays broken and a plain "installed successfully" reads
          // as "nothing left to do". The switch and uninstall paths already
          // give this signal; Install is the button the original report used.
          //
          // Unlike `setActiveSdk`, the done/success message is still sent: the
          // webview's install panel resolves its progress state on it, and
          // suppressing it would leave the spinner running. The wording carries
          // the caveat instead.
          const dangling = warnIfWestManifestDangling(
            path.join(cacheRoot, version),
          );
          sendProgress(
            dangling
              ? `SDK ${version} installed, but the west workspace still points at a removed SDK — run Bootstrap to reconcile it.`
              : `SDK ${version} installed successfully.`,
            true,
            true,
          );
          // The install is only half the setup. Without `tan bootstrap` there
          // is no west, and `tan build` plans every slice and then skips every
          // one of them — "skipped: m55_hp [zephyr] -- tool `west` not found",
          // "error: no slice was built -- every slice was skipped". Offering
          // the next step here is what stops that being discovered from a
          // failed build.
          //
          // OFFERED, never automatic, and the size is IN the sentence:
          // bootstrap fetches the Zephyr workspace and builds a venv, which is
          // minutes of network and `BOOTSTRAP_DISK_ESTIMATE` of disk. Spending
          // that without asking is not this handler's call — especially on a
          // laptop or a metered link — so the click stays the customer's.
          void notify({
            severity: "info",
            channel: "toast",
            message:
              `Alp: SDK ${version} installed. Bootstrap sets up its build ` +
              `environment (west, Zephyr modules, Python venv) and needs ` +
              `${BOOTSTRAP_DISK_ESTIMATE} of disk.`,
            actions: [{ id: "custom", title: "Bootstrap now" }],
          }).then((picked) => {
            if (picked === "custom")
              void vscode.commands.executeCommand("alp.installDependencies");
          });
          await refresh();
        } catch (err) {
          if (cancelled) {
            // Killing `git clone` leaves a half-written <cacheRoot>/<version>
            // behind, and git refuses to clone into a non-empty directory — so
            // without this the NEXT install of the same version fails with an
            // error that has nothing to do with what the user did. Remove it.
            const partial = path.join(cacheRoot, version);
            try {
              fs.rmSync(partial, { recursive: true, force: true });
            } catch (cleanupErr) {
              logChannel(
                `[sdk-install] could not remove the partial clone at ${partial}: ${String(cleanupErr)}`,
              );
            }
            // `done: true` is required even here: the webview install panel
            // resolves its spinner on it, so skipping it hangs the panel.
            sendProgress(`SDK ${version} install cancelled.`, true, false);
            notifyAsync(planSuccess(`SDK ${version} install cancelled.`));
            return;
          }
          // No git on the box. This is walkthrough step 1 on a clean Windows
          // 11 install, and it used to end at "Alp: couldn't install SDK
          // <version>." with a single Retry — a button that re-spawned a binary
          // that does not exist, which reads as "transient" and is the worst
          // possible advice. The CUSTOMER sentence names git; the errno stays
          // in `detail`, i.e. the channel.
          //
          // `notifyAsync`, and no Retry: retrying cannot work until git is
          // installed, and installing it is not something this handler can
          // observe.
          //
          // Neither sentence says git is absent from the MACHINE — all this
          // handler knows is that its own process could not resolve `git`, and
          // those differ in the state its own advice creates. Installing git
          // while VS Code is running leaves the running editor blind to it:
          // Windows delivers a new `PATH` only to processes started afterwards,
          // and a window reload does not help either, because the extension
          // host is forked from a main process whose environment was captured
          // at launch (VS Code skips shell-environment resolution on Windows
          // outright). So the advice is to reopen VS Code, not to press Install
          // again — a re-press in the same window reproduces this exact ENOENT.
          if (isMissingGit(err)) {
            sendProgress(
              `Install failed: Alp couldn't find Git. Alp fetches the SDK ` +
                `with git clone, so install Git, then close VS Code completely ` +
                `and reopen it — a new install isn't visible to an editor that ` +
                `was already running.`,
              true,
              false,
            );
            notifyAsync(
              planFailure({
                operation: "Installing the SDK",
                cause:
                  `Alp: installing SDK ${version} needs Git, and Alp couldn't ` +
                  `find Git.`,
                detail: String(err),
                actions: [{ id: "downloadGit" }],
              }),
            );
            return;
          }
          sendProgress(`Install failed: ${String(err)}`, true, false);
          // The raw reject text ("git clone exited with code 3") is already
          // inline in the panel above and in the channel via `detail` — it does
          // not belong in the toast. The Retry pick is wired here, since a
          // `retry` action the presenter hands back to nobody would be a button
          // that does nothing. Everything reaching this branch is a clone that
          // RAN, so retrying is a real fix (the flaky link, the proxy that came
          // back, the VPN that reconnected).
          void notify(
            planFailure({
              operation: "Installing the SDK",
              cause: `Alp: couldn't install SDK ${version}.`,
              detail: String(err),
              actions: [{ id: "retry" }],
            }),
          ).then((picked) => {
            if (picked === "retry") void handleRequestSdkInstall(version);
          });
        } finally {
          sub.dispose();
        }
      },
    );
  }

  return (msg: WebviewToExtMessage): boolean => {
    switch (msg.type) {
      case "selectSdkPath":
        void handleSelectSdkPath();
        return true;
      case "requestSdkReleases":
        void handleRequestSdkReleases();
        return true;
      case "requestSdkInstall":
        void handleRequestSdkInstall(msg.version);
        return true;
      case "switchSdk":
        void handleSwitchSdk(msg.sdkPath);
        return true;
      case "uninstallSdk":
        void handleUninstallSdk(msg.sdkPath);
        return true;
      case "deactivateSdk":
        void handleDeactivateSdk();
        return true;
      default:
        return false;
    }
  };
}
