// SPDX-License-Identifier: Apache-2.0

import {
  checkSdkReadiness,
  listLocalSdkEntries,
} from "@alp-sdk/core/sdk/service";
import * as cp from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { collectProjectContext } from "../project/vscodeAdapter";
import { log } from "../util";
import {
  resolveWestBinary,
  westWorkspaceInitialized,
} from "../environment/vscodeAdapter";
import type { AlpIdeState } from "./messages";

/**
 * Open a project folder without disrupting the user's current session: if a
 * workspace is already open, open in a NEW window; otherwise reuse the current
 * (empty) window. Used by the new- and existing-project flows.
 */
export async function openProjectFolder(uri: vscode.Uri): Promise<void> {
  const hasWorkspaceOpen = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  await vscode.commands.executeCommand("vscode.openFolder", uri, {
    forceNewWindow: hasWorkspaceOpen,
  });
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
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(cmd, ["--version"], {
      timeout: 3000,
      env,
    });
    return stdout.trim().split("\n")[0] ?? null;
  } catch (err) {
    log(`alp: probe "${cmd} --version" failed: ${errText(err)}`);
    return null;
  }
}

/** Default directory for versioned SDK installations. */
export function sdkCacheRoot(): string {
  return path.join(os.homedir(), ".alp", "sdk");
}

export async function queryAlpIdeState(
  lastBootstrapAt: string | null = null,
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
    removable: path
      .resolve(entry.path)
      .startsWith(cacheRootResolved + path.sep),
  }));

  const boardYamlPath = actualWorkspaceRoot
    ? path.join(actualWorkspaceRoot, "board.yaml")
    : null;

  const pyCmd = projectContext.pythonBinary;
  const westBin = resolveWestBinary(
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
      commandVersion(westBin, probeEnv),
      commandVersion("cmake", probeEnv),
      commandVersion("ninja", probeEnv),
    ]);
  const pythonAvailable = pythonVersion !== null;
  const westAvailable = westVersion !== null;

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
      lastBootstrapAt,
      toolVersions: {
        python: pythonVersion,
        west: westVersion,
        cmake: cmakeVersion,
        ninja: ninjaVersion,
      },
    },
    workspace: {
      workspaceRoot: actualWorkspaceRoot,
      boardYamlExists: boardYamlPath ? fs.existsSync(boardYamlPath) : false,
      boardYamlValid: false,
      boardIssueCount: 0,
      westInitialized: westWorkspaceInitialized(
        projectContext.westCwd,
        projectContext.sdkRoot,
      ),
    },
  };
}
