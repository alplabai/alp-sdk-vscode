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

/**
 * Does this plan program a device?
 *
 * `alp.westFlash` runs `west flash` in a TERMINAL, so it never passes through
 * `runAlpStreamed` and the tan-side consent gate (`src/flash/gate.ts`) cannot
 * see it (#549). It is a real write all the same — `west flash` programs the
 * attached board the moment it starts — so the terminal dispatcher asks first,
 * and this is what it asks about.
 *
 * ERRS TOWARD ASKING. Any argument that is exactly `flash` counts, not only
 * `args[1]`: this runs before an irreversible write, and the cost of a wrong
 * yes is a dialog nobody needed, while the cost of a wrong no is a board
 * programmed without being asked. `west` has no other subcommand spelled
 * `flash`, and a path element equal to the bare word is not a shape this repo
 * builds.
 */
export function isWestFlashPlan(args: readonly string[]): boolean {
  return args.includes("flash");
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
