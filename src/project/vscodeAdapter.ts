// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  ProjectContext,
  ProjectResolutionInput,
  ProjectSettings,
} from "@alp-sdk/core/project/models";
import { resolveProjectContext } from "@alp-sdk/core/project/service";

export function collectProjectContext(): ProjectContext {
  return resolveProjectContext(createResolutionInput(), fs.existsSync, (p) => {
    try {
      return fs.readFileSync(p, "utf8");
    } catch {
      return "";
    }
  });
}

/**
 * The directory a READ-ONLY, project-scoped `tan` command should run in —
 * `collectProjectContext().workspaceRoot` when one resolves, `os.tmpdir()`
 * otherwise (#605).
 *
 * NO FOLDER OPEN IS NOT A REFUSAL for a command like `tan sdk list --online`
 * or `tan doctor`: neither writes anything, and refusing them would break a
 * customer browsing SDK releases before they have a project at all —
 * `buildDependencyReport` (`src/deps/vscodeAdapter.ts`) already draws this
 * line for `doctor`, using `os.tmpdir()` rather than leaving `cwd` `undefined`
 * (which reaches `child_process.spawn` unset and inherits the extension
 * host's own directory — on Windows, the VS Code install directory) or `""`
 * (empty is not "no preference", it can resolve to a directory of its own).
 * `os.tmpdir()` exists on every host and is nobody's project, so every answer
 * that depends on it is honestly "no project", not a guess about one nobody
 * chose.
 *
 * NOT for a command that WRITES — `build`, `flash`, `build --materialise`
 * and friends must refuse outright with `planPrecondition("noWorkspace", …)`
 * rather than land in a scratch directory; see `requireWorkspace`
 * (`ideHub/buildPlanPanel.ts`) for that shape.
 *
 * DOES NOT WITHHOLD A PROJECT-SCOPED ANSWER, unlike `buildDependencyReport`'s
 * own `withheldProjectChecks`. `doctor` can withhold because each of its
 * checks carries its own `"scope": "project" | "host"` field to filter on;
 * `sdk list`'s `envelope.issues[]` carries no such field, so there is
 * nothing here to filter BY — building one would mean this extension
 * hardcoding which `sdk.*` issue codes are project-scoped, a classification
 * tan itself does not currently publish for this command. The two codes that
 * would need it, `sdk.project-pin-unresolved` and `sdk.discovery-divergent`,
 * are `"status": "reserved"` / `"consumer": "none"` in
 * `test/golden/tan-contract/envelope-contract.json`. Read that status
 * correctly: `reserved` means NOTHING IN THIS EXTENSION BINDS THE CODE, so
 * tan may still rename it — it does NOT mean tan never emits it. The
 * registry's own note is explicit that every code python/tan emits must
 * appear in it at some status, and both carry an `emittedBy`
 * (`python/tan/commands/sdk_cmd.py` and `python/tan/commands/build_cmd.py`
 * respectively). So an issue on this path is logged verbatim by the callers
 * with no scope filtering. Whether a folder-less `sdk list --online` actually
 * surfaces one is UNMEASURED: `sdk.project-pin-unresolved` fires when
 * `.alp/sdk-path` names a checkout that no longer resolves, and a temp
 * directory has no `.alp/sdk-path` to be stale — so the fallback more likely
 * suppresses the answer than invents one. Measure before relying on either
 * reading.
 *
 * ALSO NOT SANDBOXED FROM OTHER LOCAL USERS. On Linux `os.tmpdir()` is
 * ordinarily the world-writable `/tmp`, so a folder-less `sdk list --online`
 * now resolves against a directory any local account on the machine can drop
 * a `board.yaml` into. Pre-existing at the `doctor` call site this fallback
 * was copied from; noted here rather than fixed because fixing it (a
 * per-user scratch directory, say) is a larger change than a cwd-resolution
 * bug fix should carry, and `doctor` already accepted the same exposure.
 */
export function readOnlyProjectCwd(): string {
  return collectProjectContext().workspaceRoot ?? os.tmpdir();
}

function createResolutionInput(): ProjectResolutionInput {
  return {
    workspaceFolders: workspaceFolderPaths(),
    settings: readProjectSettings(),
    platform: process.platform,
    installedSdkRoots: installedSdkRoots(),
  };
}

/**
 * SDK installs under the ~/.alp/sdk cache, newest version first (best-effort
 * numeric sort on the version-named dirs). Lowest-precedence fallback for SDK
 * resolution — see resolveProjectContext in @alp-sdk/core.
 */
function installedSdkRoots(): string[] {
  const cacheRoot = path.join(os.homedir(), ".alp", "sdk");
  let names: string[];
  try {
    names = fs.readdirSync(cacheRoot);
  } catch {
    return [];
  }
  return names
    .map((name) => path.join(cacheRoot, name))
    .filter((candidate) => {
      try {
        return fs.statSync(candidate).isDirectory();
      } catch {
        return false;
      }
    })
    .sort((a, b) =>
      path.basename(b).localeCompare(path.basename(a), undefined, {
        numeric: true,
      }),
    );
}

// Resource-scoped so a multi-root folder's .vscode/settings.json can override
// a setting like boardYamlPath; falls back to window scope when no editor is
// active. The one `alpSdk` config lookup in this file — `readSvdPath` below
// reuses it rather than opening a second, differently-scoped one.
function alpSdkConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(
    "alpSdk",
    vscode.window.activeTextEditor?.document.uri,
  );
}

function readProjectSettings(): ProjectSettings {
  const config = alpSdkConfig();
  return {
    sdkPath: config.get<string>("path", ""),
    pythonPath: config.get<string>("pythonPath", ""),
    boardYamlPath: config.get<string>("boardYamlPath", "board.yaml"),
    westCwd: config.get<string>("westCwd", ""),
  };
}

/**
 * The `alpSdk.svdPath` setting, read the same resource-scoped way as the rest
 * of `alpSdk.*` (see `alpSdkConfig`). Deliberately NOT a field on
 * `ProjectSettings`/`ProjectContext`: those feed `resolveProjectContext`
 * (`@alp-sdk/core/project/service`), which is consumed far outside the debug
 * slice (the LSP server, board.yaml validation, the new-project flow) where
 * an SVD path has no meaning, and `resolveProjectContext` RESOLVES every
 * field it owns (joins against workspaceRoot, checks existence). This value
 * is handed to `tan debug-config --svd` verbatim otherwise — see
 * `debugConfigArgs` (`src/debug/service.ts`) for why: tan owns the facts
 * about the path, this extension does not re-derive them.
 *
 * `.trim()` IS applied, matching every sibling human-typed path setting
 * (`configuredSdkPath.trim()` / `configuredWestCwd.trim()` /
 * `configuredPythonPath.trim()` in `packages/alp-core/src/project/
 * service.ts`) — the one normalization this reader does perform, because a
 * whitespace value is never a real filesystem path and the pinned tan treats
 * it as a HARD failure rather than an absent one: `--svd "   "` exits 5 with
 * `"Alp: --svd was given an empty path."`, and a trailing-space paste
 * (`--svd "dummy.svd "`) exits 5 reporting the padded, unreadable filename —
 * neither falls back to dropping the key, so an untrimmed value can turn
 * "cleared the setting by typing a space" into "Configure Debug Profile and
 * F5 stopped working" (#340 review). `debugConfigArgs` trims again on its own
 * before deciding whether to push `--svd` at all, so its push/omit decision
 * is correct independent of this call site.
 */
export function readSvdPath(): string {
  return alpSdkConfig().get<string>("svdPath", "").trim();
}

function workspaceFolderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map(
    (folder) => folder.uri.fsPath,
  );
}
