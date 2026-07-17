// SPDX-License-Identifier: Apache-2.0

import { CompositeTreeProvider } from "./compositeTree";
import { ProjectsTreeProvider } from "./projects";
import type { StateManager } from "./stateManager";
import { WorkspacesTreeProvider } from "./workspaces";

/**
 * The "Projects & Workspaces" Activity Bar view: the Projects section (projects,
 * templates, New/Open) followed by the Workspaces section (west workspaces,
 * Switch).
 */
export class ProjectsWorkspacesTreeProvider extends CompositeTreeProvider {
  constructor(stateMgr: StateManager) {
    super([
      { label: "Projects", view: new ProjectsTreeProvider(stateMgr) },
      { label: "Workspaces", view: new WorkspacesTreeProvider(stateMgr) },
    ]);
  }
}
