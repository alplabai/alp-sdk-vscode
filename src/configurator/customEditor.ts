// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as vscode from "vscode";
import type { BoardConfig } from "@alp-sdk/core/board/models";
import { parseBoardConfig } from "@alp-sdk/core/board/parse";
import { serializeBoardConfig } from "@alp-sdk/core/board/serialize";
import { buildConfiguratorViewModel } from "@alp-sdk/core/configurator/viewModel";
import {
  type ExtToWebviewMessage,
  type WebviewToExtMessage,
} from "../ideHub/messages";
import { buildWebviewHtml } from "../ideHub/webviewHtml";
import { collectProjectContext } from "../project/vscodeAdapter";
import { loadSdkCatalogue } from "../sdkCatalogue/vscodeAdapter";
import { log } from "../util";

const VIEW_TYPE = "alp.boardConfigurator";
const EMPTY_BOARD: BoardConfig = { som: { sku: "" }, cores: {} };

/**
 * Document-backed visual editor for `board.yaml`.
 *
 * Registered with priority "option" (see package.json contributes.customEditors)
 * so the text editor stays the default; users opt in via
 * "Reopen Editor With… → Alp Board Configurator". Edits flow through the
 * TextDocument (WorkspaceEdit), so VS Code's native dirty/save/undo applies —
 * no bespoke file IO. The webview message contract is identical to the former
 * command-launched panel, so the React view is unchanged.
 */
class ConfiguratorEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel,
  ): void {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(
          this.context.extensionUri,
          "packages",
          "alp-webview",
          "dist",
        ),
      ],
    };
    panel.webview.html = buildWebviewHtml(
      panel.webview,
      this.context.extensionUri,
      "configurator",
    );

    // The text we last wrote ourselves — lets us ignore the change-event echo
    // of a webview edit so it doesn't clobber the user's input focus.
    let lastWrittenText: string | null = null;

    const parse = (): BoardConfig => {
      try {
        return parseBoardConfig(document.getText());
      } catch {
        return EMPTY_BOARD;
      }
    };

    const postRender = (board: BoardConfig): void => {
      const project = collectProjectContext();
      const catalogue = loadSdkCatalogue(project.sdkRoot ?? null, (m) =>
        log(m),
      );
      const message: ExtToWebviewMessage = {
        type: "configuratorRender",
        viewModel: buildConfiguratorViewModel(board, catalogue),
        board,
        boardPath: document.uri.fsPath,
        sdkConnected: catalogue.soms.length > 0,
      };
      void panel.webview.postMessage(message);
    };

    const writeBoard = async (board: BoardConfig): Promise<void> => {
      const next = serializeBoardConfig(board);
      if (next === document.getText()) return;
      lastWrittenText = next;
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length),
      );
      edit.replace(document.uri, fullRange, next);
      await vscode.workspace.applyEdit(edit);
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
      // Skip the echo of our own webview-driven edit; re-render on external ones
      // (e.g. the user editing the YAML in a side-by-side text editor).
      if (document.getText() === lastWrittenText) return;
      postRender(parse());
    });

    // Reset the webview's dirty baseline whenever the document is saved —
    // whether via the webview's Save button or a native Ctrl+S.
    const saveSub = vscode.workspace.onDidSaveTextDocument((saved) => {
      if (saved.uri.toString() !== document.uri.toString()) return;
      const msg: ExtToWebviewMessage = {
        type: "configuratorSaved",
        boardPath: document.uri.fsPath,
      };
      void panel.webview.postMessage(msg);
    });

    panel.webview.onDidReceiveMessage((msg: WebviewToExtMessage) => {
      switch (msg.type) {
        case "ready":
          postRender(parse());
          break;
        case "configuratorUpdate":
          void writeBoard(msg.board).then(() => {
            // Refresh the view-model only; the webview keeps its local board
            // (it set expectEcho), preserving input focus.
            postRender(msg.board);
          });
          break;
        case "saveBoardConfig": {
          const notifySaved = () =>
            void vscode.window.showInformationMessage(
              `Saved ${vscode.workspace.asRelativePath(document.uri)}`,
            );
          // Native save when there are unsaved edits (onDidSaveTextDocument posts
          // the configuratorSaved ack). When the document is already clean —
          // webview edits are written to the doc on every change, so a valid
          // unchanged board is already persisted — document.save() no-ops and
          // never acks, leaving the user with no feedback. Ack directly instead.
          if (document.isDirty) {
            void document.save().then((ok) => {
              if (ok) notifySaved();
            });
          } else {
            const ack: ExtToWebviewMessage = {
              type: "configuratorSaved",
              boardPath: document.uri.fsPath,
            };
            void panel.webview.postMessage(ack);
            notifySaved();
          }
          break;
        }
        case "reloadConfigurator":
          postRender(parse());
          break;
        case "previewEffectiveConfig":
          void vscode.commands.executeCommand("alp.previewEffectiveConfig");
          break;
        case "openUrl":
          if (
            msg.url.startsWith("https://") ||
            msg.url.startsWith("vscode://")
          ) {
            void vscode.env.openExternal(vscode.Uri.parse(msg.url));
          }
          break;
      }
    });

    panel.onDidDispose(() => {
      changeSub.dispose();
      saveSub.dispose();
    });
  }
}

/**
 * Open a `board.yaml` with the configurator. Backs the `alp.openConfigurator`
 * command (an alternate entry to the editor). When invoked from the editor
 * title bar or the explorer context menu, VS Code passes the clicked resource;
 * from the command palette it falls back to the active project's board.yaml.
 */
function openConfigurator(resource?: vscode.Uri): void {
  const target = resource?.fsPath ?? collectProjectContext().boardYamlPath;
  if (!target || !fs.existsSync(target)) {
    void vscode.window.showErrorMessage(
      "Alp: no board.yaml found — open a workspace folder with a board.yaml, or create a project first.",
    );
    return;
  }
  void vscode.commands.executeCommand(
    "vscode.openWith",
    vscode.Uri.file(target),
    VIEW_TYPE,
  );
}

export function registerConfiguratorEditor(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  return [
    vscode.window.registerCustomEditorProvider(
      VIEW_TYPE,
      new ConfiguratorEditorProvider(context),
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      },
    ),
    vscode.commands.registerCommand("alp.openConfigurator", openConfigurator),
  ];
}
