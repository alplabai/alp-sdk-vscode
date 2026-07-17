// SPDX-License-Identifier: Apache-2.0

import { LoaderPlan } from "../loader/models";
import { ProjectContext } from "../project/models";
import { ValidatorPlan } from "../validation/models";

export type WestWorkspaceContext = ProjectContext;

export interface WestBuildInput {
  board: string;
  example: string;
}

export interface WestCommandPlan {
  terminalName: string;
  args: string[];
  westCwd: string | null;
  env: Record<string, string>;
}

export interface WestBuildPreparation {
  validatorPlan: ValidatorPlan;
  loaderPlans: LoaderPlan[];
  westPlan: WestCommandPlan;
}
