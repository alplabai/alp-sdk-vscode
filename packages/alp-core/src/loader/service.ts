// SPDX-License-Identifier: Apache-2.0

import * as path from "path";
import { parseBoardModel } from "../configurator/service";
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
    // native_sim GPIO emulation. Unlike the build/generated artefacts this
    // lands in the app source tree (boards/), where Zephyr auto-discovers it
    // for `west build -b native_sim/native/64`.
    emit: "native-sim-overlay",
    displayName: "native_sim overlay",
    outputRelativePath: "boards/native_sim_native_64.overlay",
    preview: {
      label: "native_sim overlay preview",
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
  {
    // Board-level carrier netlist + BOM handoff (alp-sdk#419) Alp Studio
    // consumes -- a deterministic export, not a per-core build config. Listed
    // here so the shared support lookup never throws when `generate --all`
    // reports it among `failed` (e.g. on an SDK too old to emit it).
    emit: "carrier-netlist",
    displayName: "Carrier netlist",
    outputRelativePath: "build/generated/carrier-netlist.json",
    preview: {
      label: "Carrier netlist preview",
      languageId: "json",
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

// The build-config emits regenerated together (the build-prep fallback set +
// "generate all"'s build outputs). `native-sim-overlay` and `carrier-netlist`
// are deliberately excluded: the former is a source-tree board overlay for
// native_sim only, the latter a board-level Studio export -- neither is part of
// a silicon build's generated config; both are `generate`-only targets.
export const ALL_EMIT_MODES: readonly EmitMode[] =
  GENERATION_TARGET_CATALOG.filter(
    (target) =>
      target.emit !== "native-sim-overlay" && target.emit !== "carrier-netlist",
  ).map((target) => target.emit);

/**
 * Resolves the set of emit modes that are actually needed for the given
 * board.yaml content.  For schema v1, the top-level `os:` field governs
 * which outputs to produce.  For schema v2, the union of all non-`off`
 * core OSes determines the relevant targets, avoiding spurious "failed"
 * batch entries when, e.g., a zephyr-only v2 board has no yocto core.
 *
 * Falls back to ALL_EMIT_MODES when the schema version or os fields
 * cannot be determined.
 */
export function resolveEmitModesForBoardYaml(
  boardYamlText: string,
): EmitMode[] {
  const model = parseBoardModel(boardYamlText);

  let osSet: Set<string>;

  if (model.schema_version >= 2 && model.cores) {
    osSet = new Set<string>(
      Object.values(model.cores)
        .map((c) => (c as { os?: string }).os ?? "")
        .filter((os) => os && os !== "off"),
    );
  } else if (typeof model.os === "string" && model.os) {
    osSet = new Set<string>([model.os]);
  } else {
    return [...ALL_EMIT_MODES];
  }

  const modeSet = new Set<EmitMode>();
  if (osSet.has("zephyr")) {
    modeSet.add("zephyr-conf");
    modeSet.add("dts-overlay");
    modeSet.add("cmake-args");
  }
  if (osSet.has("baremetal")) {
    modeSet.add("cmake-args");
  }
  if (osSet.has("yocto")) {
    modeSet.add("yocto-conf");
  }
  const modes = [...modeSet];
  // Unknown OS values — include all modes as a safe fallback
  if (modes.length === 0) {
    return [...ALL_EMIT_MODES];
  }

  return modes;
}

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
