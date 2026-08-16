// SPDX-License-Identifier: Apache-2.0
//
// Pure builder for a newly-scaffolded project's .vscode/settings.json contents.
// No `vscode`/`fs` here so it's unit-testable — the panel owns the
// read/merge/write IO (see NewProjectFlowPanel.pinProjectSdk).

/** Path the MS C/C++ extension reads for IntelliSense include/define resolution.
 *  `west build` (Zephyr sets CMAKE_EXPORT_COMPILE_COMMANDS) writes it under the
 *  default `build/` dir. For a heterogeneous/sysbuild project the per-domain DB
 *  lives at `build/<domain>/compile_commands.json`; point it there if needed. */
const DEFAULT_COMPILE_COMMANDS =
  "${workspaceFolder}/build/compile_commands.json";

/**
 * Merge the wizard's choices into any existing settings: pin the chosen SDK
 * (`alpSdk.path`) so the project opens with the right one, and point the C/C++
 * extension at the west build's compile DB so Zephyr + ALP headers resolve after
 * the first Build. A fresh Zephyr project genuinely can't resolve its includes
 * until a build generates `compile_commands.json` (the include graph is produced
 * at CMake configure time, per board/config) — so this wires IntelliSense up,
 * and building once clears the squiggles. Never clobbers a `compileCommands`
 * value the CLI scaffold or the user already set.
 */
export function buildProjectSettings(
  existing: Record<string, unknown>,
  sdkPath: string,
): Record<string, unknown> {
  const settings: Record<string, unknown> = {
    ...existing,
    "alpSdk.path": sdkPath,
  };
  if (settings["C_Cpp.default.compileCommands"] === undefined) {
    settings["C_Cpp.default.compileCommands"] = DEFAULT_COMPILE_COMMANDS;
  }
  return settings;
}
