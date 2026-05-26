// SPDX-License-Identifier: Apache-2.0

import { ALL_EMIT_MODES, createLoaderPlan } from "../loader/service";
import { createValidatorPlan } from "../validation/service";
import {
    WestBuildInput,
    WestBuildPreparation,
    WestCommandPlan,
    WestPlanKind,
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
    "build",
  );
}

export function createWestBuildPreparation(
  context: WestWorkspaceContext,
  input: WestBuildInput,
): WestBuildPreparation {
  const boardYamlPath = requireBoardYamlPath(context.boardYamlPath);

  return {
    validatorPlan: createValidatorPlan(context, boardYamlPath),
    loaderPlans: ALL_EMIT_MODES.map((emit) => createLoaderPlan(context, emit)),
    westPlan: createWestBuildPlan(context, input),
  };
}

export function createWestFlashPlan(
  context: WestWorkspaceContext,
): WestCommandPlan {
  return createWestCommandPlan(context, "alp · west flash", "west flash", "flash");
}

export function createWestNativeRunPlan(
  context: WestWorkspaceContext,
): WestCommandPlan {
  return createWestCommandPlan(context, "alp · west run", "west build -t run", "run");
}

function createWestCommandPlan(
  context: WestWorkspaceContext,
  terminalName: string,
  command: string,
  kind: WestPlanKind,
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
    kind,
  };
}

function requireBoardYamlPath(boardYamlPath: string | null): string {
  if (!boardYamlPath) {
    throw new Error("Alp: board.yaml path is unresolved.");
  }

  return boardYamlPath;
}
