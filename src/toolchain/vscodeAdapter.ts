// SPDX-License-Identifier: Apache-2.0

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
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

/**
 * Locate a Zephyr SDK install without spawning anything. Mirrors the native
 * CLI's `zephyr_sdk_detected()` (cli-rs/crates/alp-cli/src/commands/doctor.rs):
 * honor ZEPHYR_SDK_INSTALL_DIR, else accept the CMake package registry the
 * SDK's setup.sh registers (`~/.cmake/packages/Zephyr-sdk`) — which it does even
 * when it never exports the env var (the Remote-SSH / non-login-shell case) —
 * else a `zephyr-sdk-*` directory under the usual roots (home + `/opt`). Returns
 * the detected path (surfaced as the check's detail), or undefined when none is
 * found. `env`/`homeDir` are injectable so the detection can be unit-tested.
 */
export function detectZephyrSdkDir(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): string | undefined {
  if (env.ZEPHYR_SDK_INSTALL_DIR) {
    return env.ZEPHYR_SDK_INSTALL_DIR;
  }
  const registry = path.join(homeDir, ".cmake", "packages", "Zephyr-sdk");
  if (fs.existsSync(registry)) {
    return registry;
  }
  // install there is correctly reported, not a false positive.
  for (const root of [homeDir, "/opt"]) {
    try {
      const hit = fs
        .readdirSync(root)
        .find((name) => name.startsWith("zephyr-sdk"));
      if (hit) {
        return path.join(root, hit);
      }
    } catch {
      // root absent / unreadable — keep scanning
    }
  }
  return undefined;
}

export function collectToolchainInputs(): ToolchainInputs {
  const context = collectProjectContext();
  // west + Zephyr's Python deps live in the bootstrap venv, not globally — probe
  // there first (shared resolver), falling back to PATH / the system interpreter.
  const westBin = resolveWestBinary(context.westCwd, context.sdkRoot);
  const depPython =
    resolveVenvPython(context.westCwd, context.sdkRoot) ?? context.pythonBinary;
  return {
    tools: {
      python: probeTool(context.pythonBinary, ["--version"]),
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
      zephyrSdkDir: detectZephyrSdkDir(),
      zephyrBase: process.env.ZEPHYR_BASE || undefined,
    },
    sdkConnected: context.sdkRoot !== null,
  };
}
