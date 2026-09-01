// SPDX-License-Identifier: Apache-2.0
//
// The pre-`tan build` warning for a CLI below the Renesas Kconfig floor
// (#502), factored out of `src/west.ts` so every `tan build` spawn site calls
// the SAME check (#606) instead of each carrying its own copy. `warnIfCli-
// CannotBuildSom` used to live only in `west.ts` and was wired to exactly one
// of the four sites that run `tan build` — the Build Plan panel's Materialise
// and Build handlers, and the `preLaunchTask`/Run Task build, all skipped it,
// so a Renesas customer building from any of those three still hit the bare
// Kconfig abort this warning exists to explain.

import * as fs from "fs";
import * as path from "path";
import type * as vscode from "vscode";

import { parseBoardConfig } from "@alp-sdk/core/board/parse";

import { probeTanVersion } from "../alpCli/vscodeAdapter";
import { SUPPORTED_CLI_VERSION } from "../alpCli/service";
import { isRenesasSku, somCliFloorWarning } from "../alpCli/somCliFloor";
import { planFailure } from "../notify/service";
import { notifyAsync } from "../notify/vscodeAdapter";
import { log } from "../util";

/** The SoM SKU declared by the `board.yaml` at `cwd`, or null when there is no
 *  readable project there — no file, unparseable YAML, or a board that declares
 *  no `som`. Every one of those means "say nothing", never "assume a SKU".
 *
 *  The `fs` read lives here while the parse is `@alp-sdk/core`'s, so this file
 *  holds no second copy of the board-config rules. */
function somSkuOf(cwd: string): string | null {
  const boardYaml = path.join(cwd, "board.yaml");
  if (!fs.existsSync(boardYaml)) return null;
  try {
    return (
      parseBoardConfig(fs.readFileSync(boardYaml, "utf8")).som?.sku ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Say so BEFORE a `tan build` this tan cannot configure (#502).
 *
 * Every site that spawns `tan build` (in any of its forms — a bare build, `--
 * materialise`, or the task-provider's delegated build) must call this before
 * dispatching, because the abort this warns about is a `tan build` failure and
 * nothing narrower: the customer is otherwise left with a Kconfig error naming
 * neither their CLI nor their SoM.
 *
 * The probe is deliberately behind the SKU check: `probeTanVersion` spawns the
 * CLI, and there is no reason to pay that on every Alif or NXP build to answer
 * a question only Renesas can fail. Fire-and-forget (`notifyAsync`) — this is
 * an explanation, not a gate, so the build the customer asked for still starts
 * as soon as this resolves.
 *
 * NEVER THROWS, full stop — this is deliberately the ONE place that
 * guarantee lives, rather than a `try`/`catch` at each of the four call
 * sites. None of them currently has one: `buildPlanPanel.ts`'s
 * `handleRunBuild` is dispatched `void` from a message handler, and
 * `tasks/vscodeAdapter.ts`'s `dispatchBuild` awaits this immediately before
 * the real spawn with nothing wrapping either call. A probe failing here
 * (`probeTanVersion`'s `cp.spawn`, a `somCliFloorWarning` that starts
 * throwing) must not cost the customer the build this was only ever meant to
 * explain — an explanation that can cancel the thing it explains is a gate,
 * which is exactly what this function's own doc says it is not.
 */
export async function warnIfCliCannotBuildSom(
  context: vscode.ExtensionContext,
  cwd: string,
): Promise<void> {
  try {
    const sku = somSkuOf(cwd);
    if (!sku || !isRenesasSku(sku)) return;

    const warning = somCliFloorWarning(sku, await probeTanVersion(context));
    if (!warning) return;

    log(`[build] ${warning.detail}`);
    notifyAsync(
      planFailure({
        operation: "Build",
        cause: warning.cause,
        detail: warning.detail,
        severity: "warning",
        actions: [
          { id: "updateCli", title: `Use tan ${SUPPORTED_CLI_VERSION}` },
        ],
        dedupeKey: "som-cli-floor",
      }),
    );
  } catch (error) {
    // Every ordinary "nothing to say" case (non-Renesas SKU, no board.yaml,
    // an unparseable one) already returns above without reaching here — this
    // catches the UNEXPECTED failure, so it is logged rather than dropped
    // silently the way those routine cases are.
    log(
      `[build] som-cli-floor check failed, continuing without it: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
