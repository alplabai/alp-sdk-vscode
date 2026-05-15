// SPDX-License-Identifier: Apache-2.0

import { SpawnSyncLike } from "@alp-sdk/core/validation/adapterCore";
import * as cp from "child_process";
import * as fs from "fs";
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
  const result = executeCli({
    argv,
    cwd: process.cwd(),
    platform: process.platform,
    pathExists: fs.existsSync,
    spawnSync,
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
