// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import { proxyEnvAdditions } from "../alpCli/vscodeAdapter";
import { collectProjectContext } from "../project/vscodeAdapter";
import { log, runInTerminal } from "../util";
import { planConfirm } from "../notify/service";
import { notify } from "../notify/vscodeAdapter";
import {
  WestCommandPlan,
  WestWorkspaceContext,
} from "@alp-sdk/core/west/models";
import { isWestFlashPlan } from "@alp-sdk/core/west/service";

export function collectWestWorkspaceContext(): WestWorkspaceContext {
  return collectProjectContext();
}

/** True when the project already carries the native_sim GPIO overlay that
 *  `alp generate --target native-sim-overlay` writes, so a native_sim run can
 *  skip regenerating it. */
export function nativeSimOverlayExists(workspaceRoot: string): boolean {
  return fs.existsSync(
    path.join(workspaceRoot, "boards", "native_sim_native_64.overlay"),
  );
}

/**
 * Locate the `west` from the workspace's bootstrap venv (`<dir>/.venv/bin/west`,
 * searched from the west cwd upward). `alp bootstrap` installs west into a venv
 * rather than globally, so the plain-west commands must run that hermetic west
 * — not whatever (possibly broken) west happens to be on PATH. Returns
 * undefined when no venv is found, in which case we fall back to PATH `west`.
 */
function findWorkspaceVenvWest(
  westCwd: string | null | undefined,
): string | undefined {
  if (!westCwd) return undefined;
  const rel =
    process.platform === "win32"
      ? path.join("Scripts", "west.exe")
      : path.join("bin", "west");
  let dir = westCwd;
  for (;;) {
    const candidate = path.join(dir, ".venv", rel);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Ask before a plain `west flash` programs the board.
 *
 * The tan-side gate cannot cover this path: `alp.westFlash` runs in a TERMINAL
 * and never reaches `runAlpStreamed` (#549). Wired INSIDE the shared executor
 * rather than in `westFlash()`, for the same reason the tan gate lives inside
 * `runAlpStreamed` — a gate a call site opts into is a gate the next call site
 * forgets.
 *
 * It names less than the tan dialog does, and deliberately so: there is no
 * `system-manifest.yaml` on this path, so there is no target list to show.
 * What it CAN name is the workspace and the build directory the runner will
 * take its image from, which is the whole of what `west flash` decides from.
 */
async function confirmWestFlash(plan: WestCommandPlan): Promise<boolean> {
  const picked = await notify(
    planConfirm({
      message: "Program the attached device now?",
      modalDetail:
        `This runs \`${plan.args.join(" ")}\` and writes the board that is ` +
        "connected right now. It starts immediately — there is no preview " +
        "step.\n\n" +
        `Workspace: ${plan.westCwd ?? "(none resolved)"}\n\n` +
        "west picks the image from that workspace's build directory, so an " +
        "out-of-date build is programmed exactly as readily as a fresh one. " +
        "Build first if you are not sure.",
      confirm: { id: "flashDevice" },
    }),
  );
  return picked === "flashDevice";
}

export async function executeWestPlan(plan: WestCommandPlan): Promise<void> {
  // The hardware-consent gate for the terminal path (#549). Before anything
  // else, and before the venv substitution below, so the dialog quotes the
  // command the customer asked for rather than an absolute interpreter path.
  if (isWestFlashPlan(plan.args) && !(await confirmWestFlash(plan))) {
    log("[west] flash declined at the consent gate — nothing was run");
    return;
  }
  return executeWestPlanUnchecked(plan);
}

function executeWestPlanUnchecked(plan: WestCommandPlan): void {
  // No "still running" pre-check here on purpose. `runInTerminal` refuses a
  // live run under the same terminal name itself (issue #146: never terminate
  // a flash mid-write to start a fresh one) with the byte-identical warning
  // and the same "Show Terminal" action, so a second copy of that toast in
  // this file only ever meant two places to keep in sync.

  // Prefer the workspace venv's west over PATH (hermetic; see findWorkspaceVenvWest).
  const venvWest = findWorkspaceVenvWest(plan.westCwd);
  const argv =
    venvWest && plan.args[0] === "west"
      ? [venvWest, ...plan.args.slice(1)]
      : plan.args;
  runInTerminal({
    name: plan.terminalName,
    argv,
    cwd: plan.westCwd ?? undefined,
    // `west update` clones and fetches from GitHub, so it is as proxy-dependent
    // as `tan` is and this task inherits the extension host's environment, not
    // a login shell's. The plan's own vars win on a key clash: the proxy
    // additions never write EXTRA_ZEPHYR_MODULES, so today there is none.
    env: { ...proxyEnvAdditions(), ...plan.env },
  });
}
