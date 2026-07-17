// SPDX-License-Identifier: Apache-2.0

import { ProjectContext } from "../project/models";

export type WestWorkspaceContext = ProjectContext;

export interface WestCommandPlan {
  terminalName: string;
  command: string;
  westCwd: string | null;
  env: Record<string, string>;
}
