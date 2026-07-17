// SPDX-License-Identifier: Apache-2.0

import { CompositeTreeProvider } from "./compositeTree";
import { SdkTreeProvider } from "./sdk";
import { SetupTreeProvider } from "./setup";
import type { StateManager } from "./stateManager";

/**
 * The "Environment" Activity Bar view: the Setup section (toolchain readiness,
 * Doctor, Bootstrap) followed by the SDK section (installed SDKs, active SDK,
 * Install/Switch/Remove).
 */
export class EnvironmentTreeProvider extends CompositeTreeProvider {
  constructor(stateMgr: StateManager) {
    super([
      { label: "Setup", view: new SetupTreeProvider(stateMgr) },
      { label: "SDK", view: new SdkTreeProvider(stateMgr) },
    ]);
  }
}
