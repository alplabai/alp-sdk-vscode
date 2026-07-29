// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import type { AlpIdeState } from "../ideHub/messages";
import { emptyAlpIdeState } from "../ideHub/messages";
import { queryAlpIdeState } from "../ideHub/vscodeAdapter";
import { isCancellation } from "../notify/service";
import { log } from "../util";

export class StateManager implements vscode.Disposable {
  private _state: AlpIdeState = emptyAlpIdeState();
  private _stale = false;
  private readonly _emitter = new vscode.EventEmitter<AlpIdeState>();

  readonly onStateChange = this._emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  get state(): AlpIdeState {
    return this._state;
  }

  /**
   * True when the last `refresh` did not complete, so `state` is the previous
   * good snapshot rather than a fresh read of the machine. Callers that want
   * to mark their rendering provisional read this; nobody has to, because the
   * state itself is still the last thing that was actually true.
   */
  get stale(): boolean {
    return this._stale;
  }

  async refresh(lastBootstrapAt: string | null = null): Promise<void> {
    try {
      this._state = await queryAlpIdeState(lastBootstrapAt, this.context);
      this._stale = false;
    } catch (err) {
      // A failed query is NOT "you have nothing installed". Replacing the last
      // good state with `emptyAlpIdeState()` here repainted a fully
      // provisioned machine as empty on a transient spawn hiccup — SDK gone,
      // Build and Flash hidden — and the customer's next move is to reinstall
      // something that was never missing. Keep what was last true and mark it
      // stale; the next refresh (any command, any terminal finish) corrects it.
      this._stale = true;
      const canceled = isCancellation(err);
      log(
        canceled
          ? "Alp IDE state refresh abandoned, window closing"
          : `Alp IDE state refresh failed; keeping the last known state: ${err}`,
        canceled ? "info" : "warn",
      );
    }
    this._emitter.fire(this._state);
  }

  dispose(): void {
    this._emitter.dispose();
  }
}
