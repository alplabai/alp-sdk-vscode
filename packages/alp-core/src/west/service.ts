// SPDX-License-Identifier: Apache-2.0
//
// Only the raw `west` commands with no native-CLI equivalent live here (see
// src/west.ts) — build/image/flash/clean/renode now delegate to the `alp`
// CLI's orchestrator instead of hand-built `west build -b` / `west alp-*`
// command strings.

import { WestCommandPlan, WestWorkspaceContext } from "./models";

export function createWestFlashPlan(
  context: WestWorkspaceContext,
): WestCommandPlan {
  return createWestCommandPlan(context, "alp · west flash", ["west", "flash"]);
}

export function createWestUpdatePlan(
  context: WestWorkspaceContext,
): WestCommandPlan {
  return createWestCommandPlan(context, "alp · west update", [
    "west",
    "update",
  ]);
}

export function createWestNativeRunPlan(
  context: WestWorkspaceContext,
): WestCommandPlan {
  return createWestCommandPlan(context, "alp · west run", [
    "west",
    "build",
    "-t",
    "run",
  ]);
}

function createWestCommandPlan(
  context: WestWorkspaceContext,
  terminalName: string,
  args: string[],
): WestCommandPlan {
  const env: Record<string, string> = {};
  if (context.sdkRoot) {
    env.EXTRA_ZEPHYR_MODULES = context.sdkRoot;
  }

  return {
    terminalName,
    args,
    westCwd: context.westCwd,
    env,
  };
}
