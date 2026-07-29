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

/**
 * The extractor binaries `patoolib` shells out to for a `.7z`, in its own probe
 * order.
 *
 * `west sdk install` — the only way to get the `arm-zephyr-eabi` cross
 * toolchain on native Windows — delegates `.7z` extraction to `patoolib`, and
 * `patoolib` has NO pure-Python `.7z` fallback. So on Windows this is a HARD
 * prerequisite of the Zephyr SDK install, and it is one nothing else in this
 * repo looks for: it exists upstream only as prose in alp-sdk's
 * `metadata/bootstrap.json` `manualInstallHints.windows.note`, rendered by
 * `tan bootstrap`'s text output and by nothing this extension shows.
 *
 * Any one of them is enough — patoolib takes the first it finds.
 */
const SEVEN_ZIP_BINARIES: readonly string[] = [
  "7z",
  "7za",
  "7zr",
  "7zz",
  "7zzs",
  "unar",
];

/**
 * One extractor candidate, present/absent.
 *
 * NOT `probeTool`: that reads ANY spawn failure as absent, and these binaries
 * are exactly the ones that reject a `--version`-style probe. Only `ENOENT`
 * (nothing of that name on PATH) is absence here — a non-zero exit means the
 * binary RAN, which is the whole question. Driven on Windows 11: a bogus switch
 * to a real `7z` exits `status: 7` with no `code`, while an absent `7zz` throws
 * `code: "ENOENT"`.
 *
 * Invoked with NO arguments on purpose: every 7-Zip-family binary answers a
 * bare call with its banner, and the switch vocabulary differs between 7-Zip,
 * p7zip, NanaZip and `unar`. `args` exists only so the test can drive the two
 * outcomes against a real child process on any runner; production never passes
 * it.
 */
export function probeExtractor(
  cmd: string,
  args: readonly string[] = [],
): ToolProbe {
  try {
    const out = execFileSync(cmd, args, { encoding: "utf-8", timeout: 4000 });
    return { present: true, detail: out.trim().split(/\r?\n/)[0] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { present: false };
    }
    // It ran and complained. Present; its own name is all the detail there is.
    return { present: true, detail: cmd };
  }
}

/**
 * Whether ANY `.7z` extractor west can drive is on PATH.
 *
 * `probe` and `names` are injectable so the ENOENT-vs-non-zero rule can be
 * tested without a real 7-Zip on the runner.
 */
export function probeSevenZip(
  probe: (cmd: string) => ToolProbe = probeExtractor,
  names: readonly string[] = SEVEN_ZIP_BINARIES,
): ToolProbe {
  for (const name of names) {
    const result = probe(name);
    if (result.present) return result;
  }
  return { present: false };
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
 * CLI's `zephyr_sdk_detected()` (tan-cli `crates/tan-cli/src/commands/doctor.rs`):
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
      tan: probeTool("tan", ["--help"]),
      // Only load-bearing on native Windows (`west sdk install` -> patoolib),
      // but probed on every host: the answer is a fact about the machine, and
      // gating the probe on the platform is how a fact grows two versions.
      sevenZip: probeSevenZip(),
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
