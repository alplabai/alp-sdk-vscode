// SPDX-License-Identifier: Apache-2.0

import { LoaderPlan } from "../loader/models";
import { ProjectContext } from "../project/models";
import { ValidatorPlan } from "../validation/models";

export type WestWorkspaceContext = ProjectContext;

export interface WestBuildInput {
  board: string;
  example: string;
}

export type WestPlanKind = "build" | "flash" | "run";

export interface WestCommandPlan {
  terminalName: string;
  command: string;
  westCwd: string | null;
  env: Record<string, string>;
  kind: WestPlanKind;
}

export interface WestBuildPreparation {
  validatorPlan: ValidatorPlan;
  loaderPlans: LoaderPlan[];
  westPlan: WestCommandPlan;
}
