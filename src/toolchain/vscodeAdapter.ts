// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "child_process";
import { collectProjectContext } from "../project/vscodeAdapter";
import {
  resolveVenvPython,
  resolveWestBinary,
} from "../environment/vscodeAdapter";
import { ToolchainInputs, ToolProbe } from "@alp-sdk/core/toolchain/doctor";

/** Probe a CLI tool's version; present=false if it isn't on PATH / errors. */
export function probeTool(cmd: string, args: string[]): ToolProbe {
  try {
    const out = execFileSync(cmd, args, { encoding: "utf-8", timeout: 4000 });
    return { present: true, detail: out.trim().split(/\r?\n/)[0] };
  } catch {
    return { present: false };
  }
}

function pythonCmd(): string {
  return process.platform === "win32" ? "python" : "python3";
}

function probePythonDep(pythonBin: string, module: string): boolean {
  try {
    execFileSync(pythonBin, ["-c", `import ${module}`], {
      timeout: 4000,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export function collectToolchainInputs(): ToolchainInputs {
  const context = collectProjectContext();
  // west + Zephyr's Python deps live in the bootstrap venv, not globally — probe
  // there first (shared resolver), falling back to PATH / the system interpreter.
  const westBin = resolveWestBinary(context.westCwd, context.sdkRoot);
  const depPython =
    resolveVenvPython(context.westCwd, context.sdkRoot) ?? pythonCmd();
  return {
    tools: {
      python: probeTool(pythonCmd(), ["--version"]),
      west: probeTool(westBin, ["--version"]),
      cmake: probeTool("cmake", ["--version"]),
      ninja: probeTool("ninja", ["--version"]),
      dtc: probeTool("dtc", ["--version"]),
      gdb: probeTool("gdb", ["--version"]),
      alp: probeTool("alp", ["--help"]),
    },
    pythonDeps: {
      pyyaml: probePythonDep(depPython, "yaml"),
      jsonschema: probePythonDep(depPython, "jsonschema"),
    },
    env: {
      zephyrSdkDir: process.env.ZEPHYR_SDK_INSTALL_DIR || undefined,
      zephyrBase: process.env.ZEPHYR_BASE || undefined,
    },
    sdkConnected: context.sdkRoot !== null,
  };
}
