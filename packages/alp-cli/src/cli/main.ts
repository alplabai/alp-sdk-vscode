// SPDX-License-Identifier: Apache-2.0

import { SpawnSyncLike } from "@alp-sdk/core/validation/adapterCore";
import * as cp from "child_process";
import * as fs from "fs";
import * as path from "path";
import { resolveInteractiveArgv } from "./prompt";
import { executeCli } from "./service";

const spawnSync: SpawnSyncLike = (command, args, options) => {
  const result = cp.spawnSync(command, args, options);
  return {
    status: result.status,
    stdout: (result.stdout as string | null) ?? "",
    stderr: (result.stderr as string | null) ?? "",
  };
};

async function runCli(): Promise<void> {
  const argv = await resolveInteractiveArgv(process.argv.slice(2));
  const result = await executeCli({
    argv,
    cwd: process.cwd(),
    platform: process.platform,
    pathExists: fs.existsSync,
    spawnSync,
    readFile: (filePath) => fs.readFileSync(filePath, "utf8"),
    writeFile: (filePath, content) =>
      fs.writeFileSync(filePath, content, "utf8"),
    mkdirP: (dirPath) => {
      fs.mkdirSync(dirPath, { recursive: true });
    },
    readdir: (dirPath) => fs.readdirSync(dirPath),
    httpFetch: async (url, headers) => {
      const response = await fetch(url, {
        headers: {
          "User-Agent": `alp-cli/${process.env["npm_package_version"] ?? "0"}`,
          ...headers,
        },
      });
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText} — ${url}`,
        );
      }
      return response.json() as Promise<unknown>;
    },
    sdkInstall: async (version, destPath) => {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      const result = cp.spawnSync(
        "git",
        [
          "clone",
          "--branch",
          version,
          "--depth",
          "1",
          "https://github.com/alplabai/alp-sdk.git",
          destPath,
        ],
        { stdio: "inherit" },
      );
      if ((result.status ?? 1) !== 0) {
        throw new Error(
          `Alp: git clone failed with exit code ${result.status ?? "unknown"}.`,
        );
      }
    },
  });

  if (result.format === "json") {
    process.stdout.write(`${JSON.stringify(result.envelope, null, 2)}\n`);
  } else if (result.textLines.length > 0) {
    if (result.envelope.command === "completion") {
      process.stdout.write(`${result.textLines.join("\n")}\n`);
    } else {
      process.stderr.write(`${result.textLines.join("\n")}\n`);
    }
  }

  process.exitCode = result.exitCode;
}

void runCli().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`cli: internal failure\n${message}\n`);
  process.exitCode = 5;
});
