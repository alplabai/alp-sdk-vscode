// SPDX-License-Identifier: Apache-2.0

import {
  checkSdkReadiness,
  listLocalSdkEntries,
} from "@alp-sdk/core/sdk/service";
import { sameUserPath, toPosix } from "@alp-sdk/core/paths";
import * as cp from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { isCancellation } from "../notify/service";
import { collectProjectContext } from "../project/vscodeAdapter";
import { isRunActive, log } from "../util";
import {
  resolveWestBinary,
  venvWestExists,
  westWorkspaceInitialized,
} from "../environment/vscodeAdapter";
import { probeTanVersion } from "../alpCli/vscodeAdapter";
import { BOOTSTRAP_RUN_NAME } from "./messages";
import type { AlpIdeState } from "./messages";

/**
 * Open a project folder in the CURRENT window (replaces the open workspace).
 * The extension's New Project / Open Project flows both mean "switch to this
 * project now", so a new window would just leave the old one behind as clutter
 * (the earlier new-window behavior was reported as bad UX). VS Code prompts to
 * save any unsaved editors before replacing, so this is not a silent session
 * loss. Used by the new- and existing-project flows.
 *
 * REPLACING THE WORKSPACE TEARS THIS EXTENSION HOST DOWN — that is the command
 * working, not failing. The host then rejects every pending main-thread reply,
 * this `executeCommand` among them, with a CancellationError whose name and
 * message are both "Canceled". Reported as a failure it becomes "creating the
 * project failed" on the one path where everything succeeded, so it is
 * swallowed HERE, at the single seam every folder-open routes through, rather
 * than in each caller's catch. A genuine `vscode.openFolder` rejection (a
 * deleted directory, a refused URI) still propagates.
 *
 * ONLY in the replacing mode. With `forceNewWindow` the current host SURVIVES
 * — nothing tears it down — so a cancellation there means the folder genuinely
 * did not open, and swallowing it would leave the customer with a created
 * project, no window, a disposed wizard panel and not one word about any of it.
 */
export async function openProjectFolder(
  uri: vscode.Uri,
  forceNewWindow = false,
): Promise<void> {
  try {
    await vscode.commands.executeCommand("vscode.openFolder", uri, {
      forceNewWindow,
    });
  } catch (err) {
    if (!forceNewWindow && isCancellation(err)) {
      log(`[project] window replaced while opening ${uri.fsPath}`);
      return;
    }
    throw err;
  }
}

const execFileAsync = promisify(cp.execFile);

let loginShellPathPromise: Promise<string | undefined> | undefined;

function errText(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { signal?: string };
  if (e.code === "ENOENT") return "not found on PATH";
  if (e.code === "EACCES") return "not executable";
  if (e.signal === "SIGTERM") return "timed out after 3000 ms";
  return e.message ?? String(err);
}

/**
 * The ext-host runs under a non-login PATH, so on Remote-SSH tools that live on
 * the user's `~/.bashrc` (or `~/.zshrc`) PATH read as "Not found" even though the
 * integrated (login) terminal builds fine. Resolve the real login-shell PATH
 * once per window so detection matches execution; on any failure fall back to
 * the inherited env. Windows has no login-shell concept — its process PATH is
 * authoritative there.
 */
function loginShellPath(): Promise<string | undefined> {
  if (process.platform === "win32") return Promise.resolve(undefined);
  if (!loginShellPathPromise) {
    loginShellPathPromise = (async () => {
      const shell = vscode.env.shell;
      if (!shell) return undefined;
      try {
        const { stdout } = await execFileAsync(
          shell,
          ["-l", "-i", "-c", 'printf "%s" "$PATH"'],
          { timeout: 3000 },
        );
        return stdout.trim() || undefined;
      } catch (err) {
        log(
          `alp: could not resolve login-shell PATH from ${shell}: ${errText(err)}`,
        );
        return undefined;
      }
    })();
  }
  return loginShellPathPromise;
}

/**
 * Run `cmd --version` with no shell — a venv path with a space / `$` / backtick
 * is passed as one argv token, not re-parsed — and return the first stdout line,
 * or null. A non-null version already proves availability. On failure the cause
 * is discriminated and logged; the old silent catch reported a proven-present
 * tool as "Not found" with nothing to debug from.
 */
async function commandVersion(
  cmd: string,
  env: NodeJS.ProcessEnv,
  timeout = 3000,
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, ["--version"], {
      timeout,
      env,
    });
    const firstLine = stdout.trim().split("\n")[0] ?? "";
    // Reduce to the bare MAJOR.MINOR[.PATCH] — `--version` output usually
    // carries a tool-name/prose prefix ("Python 3.9.0", "West version: v1.5.0")
    // that would otherwise double up with the UI's own "Python"/"west" label.
    const version = firstLine.match(/\d+\.\d+(?:\.\d+)?/);
    return version ? version[0] : firstLine || null;
  } catch (err) {
    log(`alp: probe "${cmd} --version" failed: ${errText(err)}`);
    return null;
  }
}

/** Default directory for versioned SDK installations. */
export function sdkCacheRoot(): string {
  return path.join(os.homedir(), ".alp", "sdk");
}

/**
 * THE PROBE (the only impure half of the readiness fix): is a bootstrap still
 * executing right now? Its answer travels to the surfaces in
 * `SetupStatus.bootstrapRunning` (below), and the decision that uses it is
 * pure and lives in `@alp-sdk/core/statusReadiness/service`.
 *
 * No timer, no extra bookkeeping: `runInTerminal` already reserves the name
 * synchronously at dispatch and releases it on the real task-end event, so
 * this is exact for the whole run — including the not-yet-confirmed-started
 * window, which is precisely when a naive "is the terminal open?" check would
 * say no.
 */
export function bootstrapRunning(): boolean {
  return isRunActive(BOOTSTRAP_RUN_NAME);
}

export async function queryAlpIdeState(
  lastBootstrapAt: string | null = null,
  context?: vscode.ExtensionContext,
): Promise<AlpIdeState> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  const actualWorkspaceRoot: string | null =
    workspaceFolders?.[0]?.uri.fsPath ?? null;

  // Active SDK = the unified project/CLI resolution (alpSdk.path → sibling →
  // newest cache install), so the SDK Manager UI agrees with what `--sdk-root`
  // sends to the CLI.
  const projectContext = collectProjectContext();
  const sdkPath = projectContext.sdkRoot;

  let sdkReadiness: AlpIdeState["sdk"]["readiness"] = "unknown";
  let sdkVersion: string | null = null;

  if (sdkPath) {
    const report = checkSdkReadiness(
      sdkPath,
      (p) => fs.existsSync(p),
      (p) => fs.readFileSync(p, "utf8"),
    );
    sdkReadiness = report.state;
    sdkVersion = report.version;
  }

  const cacheRoot = sdkCacheRoot();
  const searchRoots = [cacheRoot];
  if (actualWorkspaceRoot) {
    searchRoots.push(actualWorkspaceRoot);
    // The documented sibling layout: an SDK checked out next to the project.
    searchRoots.push(path.resolve(actualWorkspaceRoot, "..", "alp-sdk"));
  }
  // Always include the resolved active SDK so the picker and SDK Manager list
  // the SDK the extension is actually driving, even when it lives outside the
  // cache and workspace (sibling checkout or an alpSdk.path pin). Seeding it as
  // a root keeps localEntries in step with the resolution chain; listLocalSdkEntries
  // de-dupes via its `seen` set and the removable flag below keys off the cache
  // prefix, so an external checkout lands as non-removable.
  if (sdkPath) searchRoots.push(sdkPath);

  const discoveredEntries = listLocalSdkEntries(
    searchRoots,
    (p) => fs.existsSync(p),
    (p) => fs.readFileSync(p, "utf8"),
    (p) => {
      try {
        return fs.readdirSync(p);
      } catch {
        return [];
      }
    },
  );

  // Only Alp-installed SDKs (under the ~/.alp/sdk cache) are removable; external
  // SDKs (sibling checkouts / Browse) are the user's own folders.
  const cacheRootResolved = path.resolve(cacheRoot);
  const localEntries = discoveredEntries.map((entry) => ({
    ...entry,
    // Normalize to forward-slash like `activePath` (sdkRoot is toPosix'd in
    // resolveProjectContext). listLocalSdkEntries returns native path.resolve()
    // output — backslash on Windows — so a raw `local.path === activePath`
    // compare in the SDK Manager (buildRows) never matched, and the "Active"
    // badge / Use→Deactivate flip never fired on Windows. removable keys off the
    // pre-normalized native path (path.resolve re-normalizes posix input fine).
    removable: path
      .resolve(entry.path)
      .startsWith(cacheRootResolved + path.sep),
    path: toPosix(entry.path),
    // The single place "is this the active SDK" is decided (#361). `activePath`
    // may originate in a hand-typed `alpSdk.path`, so a raw `===` misses on a
    // case or trailing-separator difference and the badge never appears.
    active:
      projectContext.sdkRoot !== null &&
      sameUserPath(entry.path, projectContext.sdkRoot, process.platform),
  }));

  const pyCmd = projectContext.pythonBinary;
  const westBin = resolveWestBinary(
    projectContext.westCwd,
    projectContext.sdkRoot,
  );
  // Deterministic availability: a bootstrap-venv west existing on disk means
  // west IS available regardless of whether the `west --version` probe below
  // wins its race — this is the fix for the card flip-flopping to "Missing"
  // when the probe times out under load (Windows CPython cold-start).
  const venvWest = venvWestExists(
    projectContext.westCwd,
    projectContext.sdkRoot,
  );

  // One env, one parallel batch: the probes no longer block the event loop (they
  // were up to six synchronous spawns per window-focus / save / settings edit)
  // and detection uses the same PATH the build will.
  const shellPath = await loginShellPath();
  const probeEnv: NodeJS.ProcessEnv = shellPath
    ? { ...process.env, PATH: shellPath }
    : process.env;
  const [pythonVersion, westVersion, cmakeVersion, ninjaVersion] =
    await Promise.all([
      commandVersion(pyCmd, probeEnv),
      commandVersion(westBin, probeEnv, 10000), // roomier: venv west cold-start
      commandVersion("cmake", probeEnv),
      commandVersion("ninja", probeEnv),
    ]);
  const pythonAvailable = pythonVersion !== null;
  // Availability from the deterministic on-disk check OR a successful probe, so a
  // timed-out version probe alone never downgrades an installed west to "Missing".
  const westAvailable = venvWest || westVersion !== null;
  // Not part of the probeEnv batch above: it resolves its own binary via the
  // cliPath/bundled/localBuild/cached/PATH ladder and must never download.
  const tanVersion = context ? await probeTanVersion(context) : null;

  return {
    sdk: {
      activePath: sdkPath,
      version: sdkVersion,
      readiness: sdkReadiness,
      localEntries,
    },
    setup: {
      pythonAvailable,
      westAvailable,
      // Probed on every refresh so ONE state carries it to every surface (the
      // status bar, the Build & Flash tree, the Hub) — the gate is only worth
      // anything where the action lives, and re-probing per surface is how
      // they drift. Refreshed at both ends of a run: src/extension.ts
      // re-derives state on the task-start and terminal-finish events.
      bootstrapRunning: bootstrapRunning(),
      lastBootstrapAt,
      toolVersions: {
        python: pythonVersion,
        west: westVersion,
        tan: tanVersion,
        cmake: cmakeVersion,
        ninja: ninjaVersion,
      },
    },
    workspace: {
      // Resolved project context (the folder holding board.yaml + the configured
      // boardYamlPath), NOT workspaceFolders[0] + a hardcoded "board.yaml" —
      // otherwise a multi-root project (in folder[1]) or a custom alpSdk.boardYamlPath
      // reports boardYamlExists=false and the hub/tree wrongly offer "New Project".
      workspaceRoot: projectContext.workspaceRoot,
      boardYamlExists: projectContext.boardYamlPath
        ? fs.existsSync(projectContext.boardYamlPath)
        : false,
      westInitialized: westWorkspaceInitialized(
        projectContext.westCwd,
        projectContext.sdkRoot,
      ),
    },
  };
}
