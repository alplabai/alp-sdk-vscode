// SPDX-License-Identifier: Apache-2.0

import {
    createConnection,
    InitializeParams,
    InitializeResult,
    ProposedFeatures,
    TextDocumentSyncKind,
} from "vscode-languageserver/node";

const connection = createConnection(ProposedFeatures.all);

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
    },
  };
});

connection.onInitialized(() => {
  connection.console.info("ALP SDK language server initialized.");
});

connection.listen();
