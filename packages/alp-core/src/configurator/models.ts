// SPDX-License-Identifier: Apache-2.0

import { BoardConfig } from "../board/models";
import { ConfiguratorViewModel } from "./viewModel";

export interface RenderPayload {
  type: "render";
  viewModel: ConfiguratorViewModel;
  board: BoardConfig;
  boardPath: string;
  sdkConnected: boolean;
  theme: "brand" | "vscode";
}

export interface SavedPayload {
  type: "saved";
  boardPath: string;
}

export type ConfiguratorOutboundMessage = RenderPayload | SavedPayload;

export interface UpdateMessage {
  type: "update";
  board: BoardConfig;
}

export interface CommandMessage {
  type: "save" | "reload" | "previewEffectiveConfig";
}

export interface SetThemeMessage {
  type: "setTheme";
  theme: "brand" | "vscode";
}

export type ConfiguratorInboundMessage = UpdateMessage | CommandMessage | SetThemeMessage;
