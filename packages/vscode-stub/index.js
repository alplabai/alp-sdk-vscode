// SPDX-License-Identifier: Apache-2.0
// Minimal vscode stub for Node.js unit tests.
// The real vscode module is provided by the VS Code extension host at runtime.
"use strict";

const noop = () => {};
const noopChannel = { appendLine: noop, show: noop, dispose: noop };

module.exports = {
  window: {
    createOutputChannel: () => noopChannel,
    showInformationMessage: async () => undefined,
    showWarningMessage: async () => undefined,
  },
  workspace: {
    getConfiguration: () => ({ get: () => undefined }),
  },
  commands: {
    registerCommand: noop,
    executeCommand: async () => undefined,
  },
  Uri: { file: (p) => ({ fsPath: p, toString: () => p }) },
  EventEmitter: class { fire() {} event = noop; },
};
