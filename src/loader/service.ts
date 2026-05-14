// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import {
    EmitMode,
    GenerationTargetSupport,
    LoaderBatchEntry,
    LoaderBatchSummary,
    LoaderPlan,
    LoaderWorkspaceContext,
} from "./models";

const GENERATION_TARGET_CATALOG: readonly GenerationTargetSupport[] = [
  {
    emit: "zephyr-conf",
    displayName: "Zephyr config",
    outputRelativePath: "build/generated/alp.conf",
    preview: {
      label: "Zephyr config preview",
      languageId: "properties",
    },
  },
  {
    emit: "dts-overlay",
    displayName: "Devicetree overlay",
    outputRelativePath: "build/generated/alp.overlay",
    preview: {
      label: "Devicetree overlay preview",
      languageId: "dts",
    },
  },
  {
    emit: "cmake-args",
    displayName: "CMake args",
    outputRelativePath: "build/generated/alp-cmake-args.txt",
    preview: {
      label: "CMake args preview",
      languageId: "plaintext",
    },
  },
  {
    emit: "yocto-conf",
    displayName: "Yocto config",
    outputRelativePath: "build/generated/alp-yocto.conf",
    preview: {
      label: "Yocto config preview",
      languageId: "properties",
    },
  },
];

const GENERATION_TARGETS_BY_EMIT: Readonly<
  Record<EmitMode, GenerationTargetSupport>
> = Object.freeze(
  GENERATION_TARGET_CATALOG.reduce(
    (acc, target) => {
      acc[target.emit] = target;
      return acc;
    },
    {} as Record<EmitMode, GenerationTargetSupport>,
  ),
);

export const ALL_EMIT_MODES: readonly EmitMode[] = [
  ...GENERATION_TARGET_CATALOG.map((target) => target.emit),
];

export function listGenerationTargetSupport(): readonly GenerationTargetSupport[] {
  return GENERATION_TARGET_CATALOG;
}

export function getGenerationTargetSupport(
  emit: EmitMode | string,
): GenerationTargetSupport {
  const target = (
    GENERATION_TARGETS_BY_EMIT as Record<string, GenerationTargetSupport>
  )[emit];
  if (!target) {
    throw new Error(`Alp: unsupported generation target '${emit}'.`);
  }

  return target;
}

export function createLoaderPlan(
  context: LoaderWorkspaceContext,
  emit: EmitMode,
): LoaderPlan {
  const target = getGenerationTargetSupport(emit);
  const workspaceRoot = requireWorkspaceRoot(context.workspaceRoot);
  const sdkRoot = requireSdkRoot(context.sdkRoot);
  const boardPath = requireBoardYamlPath(context.boardYamlPath);
  const outputPath = path.join(workspaceRoot, target.outputRelativePath);
  const scriptPath = path.join(sdkRoot, "scripts", "alp_project.py");
  const args = ["--input", boardPath, "--emit", emit, "--output", outputPath];

  return {
    emit,
    outputPath,
    scriptPath,
    args,
    commandLine: `${context.pythonBinary} ${scriptPath} ${args.join(" ")}`,
  };
}

export function summarizeLoaderBatch(
  workspaceRoot: string,
  entries: readonly LoaderBatchEntry[],
): LoaderBatchSummary {
  const written: string[] = [];
  const failed: EmitMode[] = [];

  for (const entry of entries) {
    if (entry.exists && entry.size > 0) {
      written.push(path.relative(workspaceRoot, entry.outputPath));
    } else {
      failed.push(entry.emit);
    }
  }

  return { written, failed };
}

function requireWorkspaceRoot(workspaceRoot: string | null): string {
  if (!workspaceRoot) {
    throw new Error("Alp: no workspace folder is open.");
  }
  return workspaceRoot;
}

function requireSdkRoot(sdkRoot: string | null): string {
  if (!sdkRoot) {
    throw new Error(
      "Alp: alp-sdk root is unresolved. Set `alpSdk.path` to the directory that contains scripts/alp_project.py (required when workspace layout is ambiguous).",
    );
  }
  return sdkRoot;
}

function requireBoardYamlPath(boardYamlPath: string | null): string {
  if (!boardYamlPath) {
    throw new Error("Alp: no workspace folder is open.");
  }
  return boardYamlPath;
}
