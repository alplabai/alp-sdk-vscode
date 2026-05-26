// SPDX-License-Identifier: Apache-2.0

import type { BoardSummary } from "@alp-sdk/core/boardSummary/models";

export interface AlpNode {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  command?: string;
  collapsible?: boolean;
  children?: AlpNode[];
}

const DASH = "—";

export function buildProjectNodes(
  summary: BoardSummary | null,
  sdkConnected: boolean,
): AlpNode[] {
  const nodes: AlpNode[] = [];

  if (!sdkConnected) {
    nodes.push({
      id: "setup",
      label: "Setup",
      collapsible: true,
      children: [
        { id: "setup.connect", label: "Connect SDK", icon: "plug", command: "alp.connectSdk" },
      ],
    });
  }

  if (summary?.sku) {
    nodes.push(
      {
        id: "project",
        label: "Project",
        collapsible: true,
        children: [
          { id: "project.som", label: "SoM", description: summary.sku, icon: "circuit-board" },
          { id: "project.preset", label: "Preset", description: summary.preset ?? DASH, icon: "primitive-square" },
        ],
      },
      {
        id: "actions",
        label: "Actions",
        collapsible: true,
        children: [
          { id: "actions.configure", label: "Configure board", icon: "settings-gear", command: "alp.openConfigurator" },
          { id: "actions.validate", label: "Validate board.yaml", icon: "check", command: "alp.validateBoardYaml" },
          { id: "actions.generate", label: "Generate all", icon: "file-code", command: "alp.generateAll" },
          { id: "actions.build", label: "West build", icon: "tools", command: "alp.westBuild" },
          { id: "actions.flash", label: "West flash", icon: "zap", command: "alp.westFlash" },
        ],
      },
      {
        id: "debug",
        label: "Debug",
        collapsible: true,
        children: [
          { id: "debug.doctor", label: "Doctor", icon: "pulse", command: "alp.debugDoctor" },
          { id: "debug.troubleshoot", label: "Troubleshooting panel", icon: "question", command: "alp.openDebugTroubleshootingPanel" },
        ],
      },
    );
  }

  return nodes;
}
