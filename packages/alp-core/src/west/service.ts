// SPDX-License-Identifier: Apache-2.0

import {
  ALL_EMIT_MODES,
  createLoaderPlan,
  resolveEmitModesForBoardYaml,
} from "../loader/service";
import { createValidatorPlan } from "../validation/service";
import {
  WestBuildInput,
  WestBuildPreparation,
  WestCommandPlan,
  WestWorkspaceContext,
} from "./models";

export function createWestBuildPlan(
  context: WestWorkspaceContext,
  input: WestBuildInput,
): WestCommandPlan {
  return createWestCommandPlan(context, "Alp · Build", [
    "west",
    "build",
    "-b",
    input.board,
    input.example,
    "-p",
    "auto",
  ]);
}

export function createWestBuildPreparation(
  context: WestWorkspaceContext,
  input: WestBuildInput,
  boardYamlText?: string,
): WestBuildPreparation {
  const boardYamlPath = requireBoardYamlPath(context.boardYamlPath);
  const emitModes = boardYamlText
    ? resolveEmitModesForBoardYaml(boardYamlText)
    : [...ALL_EMIT_MODES];

  return {
    validatorPlan: createValidatorPlan(context, boardYamlPath),
    loaderPlans: emitModes.map((emit) => createLoaderPlan(context, emit)),
    westPlan: createWestBuildPlan(context, input),
  };
}

export function createWestFlashPlan(
  context: WestWorkspaceContext,
): WestCommandPlan {
  return createWestCommandPlan(context, "Alp · Flash", ["west", "flash"]);
}

export function createWestUpdatePlan(
  context: WestWorkspaceContext,
): WestCommandPlan {
  return createWestCommandPlan(context, "Alp · Update", ["west", "update"]);
}

export function createWestAlpImagePlan(
  context: WestWorkspaceContext,
  appPath: string,
): WestCommandPlan {
  return createWestCommandPlan(context, "Alp · Build image", [
    "west",
    "alp-image",
    appPath,
  ]);
}

export function createWestAlpFlashPlan(
  context: WestWorkspaceContext,
  appPath: string,
): WestCommandPlan {
  return createWestCommandPlan(context, "Alp · Flash (all slices)", [
    "west",
    "alp-flash",
    appPath,
  ]);
}

export function createWestAlpCleanPlan(
  context: WestWorkspaceContext,
  appPath: string,
): WestCommandPlan {
  return createWestCommandPlan(context, "Alp · Clean", [
    "west",
    "alp-clean",
    appPath,
  ]);
}

export function createWestAlpRenodePlan(
  context: WestWorkspaceContext,
  appPath: string,
): WestCommandPlan {
  return createWestCommandPlan(context, "Alp · Renode", [
    "west",
    "alp-renode",
    appPath,
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

function requireBoardYamlPath(boardYamlPath: string | null): string {
  if (!boardYamlPath) {
    throw new Error("Alp: board.yaml path is unresolved.");
  }

  return boardYamlPath;
}
