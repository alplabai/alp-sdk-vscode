// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import type { AlpIdeState } from "../ideHub/messages";
import { emptyAlpIdeState } from "../ideHub/messages";
import { queryAlpIdeState } from "../ideHub/vscodeAdapter";

export class StateManager implements vscode.Disposable {
  private _state: AlpIdeState = emptyAlpIdeState();
  private readonly _emitter = new vscode.EventEmitter<AlpIdeState>();

  readonly onStateChange = this._emitter.event;

  get state(): AlpIdeState {
    return this._state;
  }

  async refresh(lastBootstrapAt: string | null = null): Promise<void> {
    this._state = await queryAlpIdeState(lastBootstrapAt).catch(() =>
      emptyAlpIdeState(),
    );
    this._emitter.fire(this._state);
  }

  dispose(): void {
    this._emitter.dispose();
  }
}
