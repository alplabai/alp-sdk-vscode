// SPDX-License-Identifier: Apache-2.0
//
// The `.vscode/launch.json` filesystem seam — read, write, nothing else.
//
// Extracted out of `./vscodeAdapter.ts` for the same reason
// `src/alpCli/download.ts` was: it imports `vscode`, so nothing in it can be
// exercised under `node --test`. These two functions are the ONLY place the
// extension touches a launch.json on disk, and "the repaired file is byte-shaped
// like tan's own output" / "a JSONC file is refused, not reformatted" are
// claims that have to be provable against a real file, not asserted in prose.
//
// `fs` and `path` only. Read `./service.ts` before adding anything here — it
// holds why the extension writes this file at all, and what bounds it.

import * as fs from "fs";
import * as path from "path";

export function launchJsonPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".vscode", "launch.json");
}

/**
 * `.vscode/launch.json` parsed as STRICT JSON — `null` when there is no file,
 * it does not parse, or it is not an object. All three are normal and none may
 * throw; every caller treats them alike as "nothing to do".
 *
 * Strict is a REFUSAL, not a limitation. launch.json is JSONC in the wild —
 * VS Code's own "Add Configuration" template opens with `//` lines — and the
 * only lossless thing to do with a file this extension cannot re-emit
 * byte-for-byte is to leave it alone. Stripping comments to parse it and
 * writing strict JSON back would delete the customer's own annotations in
 * order to repair their file, which is a worse loss than the one being
 * repaired. It costs nothing in practice either: tan strips comments when IT
 * writes (`strip_jsonc`), so any launch.json carrying the duplicate
 * `./service.ts` exists for is already strict JSON.
 */
export function readLaunchJsonDocument(workspaceRoot: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(launchJsonPath(workspaceRoot), "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Write a repaired launch.json back — the one place this extension mutates a
 * file the customer owns. `./service.ts` holds why that is a bounded exception
 * to #387's one-writer rule and not a second author of debug configurations;
 * read it before adding a second caller.
 *
 * Two-space indent plus a trailing newline is what tan's own writer emits
 * (`serde_json::to_string_pretty` + `\n`), so a repaired file is shaped exactly
 * like the file tan would have written and the next `tan debug-config` produces
 * no formatting churn.
 */
export function writeLaunchJsonDocument(
  workspaceRoot: string,
  document: unknown,
): void {
  fs.writeFileSync(
    launchJsonPath(workspaceRoot),
    `${JSON.stringify(document, null, 2)}\n`,
    "utf-8",
  );
}
