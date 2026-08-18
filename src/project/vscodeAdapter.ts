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
