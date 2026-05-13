// SPDX-License-Identifier: Apache-2.0

import {
    WestBuildInput,
    WestCommandPlan,
    WestWorkspaceContext,
} from "./models";

export function createWestBuildPlan(
  context: WestWorkspaceContext,
  input: WestBuildInput,
): WestCommandPlan {
  return createWestCommandPlan(
    context,
    "alp · west build",
    `west build -b ${input.board} ${input.example} -p auto`,
  );
}

export function createWestFlashPlan(
  context: WestWorkspaceContext,
): WestCommandPlan {
  return createWestCommandPlan(context, "alp · west flash", "west flash");
}

export function createWestNativeRunPlan(
  context: WestWorkspaceContext,
): WestCommandPlan {
  return createWestCommandPlan(context, "alp · west run", "west build -t run");
}

function createWestCommandPlan(
  context: WestWorkspaceContext,
  terminalName: string,
  command: string,
): WestCommandPlan {
  const env: Record<string, string> = {};
  if (context.sdkRoot) {
    env.EXTRA_ZEPHYR_MODULES = context.sdkRoot;
  }

  return {
    terminalName,
    command,
    westCwd: context.westCwd,
    env,
  };
}
