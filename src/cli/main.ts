#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0

import * as cp from "child_process";
import * as fs from "fs";
import { SpawnSyncLike } from "../validation/adapterCore";
import { executeCli } from "./service";

const spawnSync: SpawnSyncLike = (command, args, options) => {
  const result = cp.spawnSync(command, args, options);
  return {
    status: result.status,
    stdout: (result.stdout as string | null) ?? "",
    stderr: (result.stderr as string | null) ?? "",
  };
};

const result = executeCli({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  platform: process.platform,
  pathExists: fs.existsSync,
  spawnSync,
});

if (result.format === "json") {
  process.stdout.write(`${JSON.stringify(result.envelope, null, 2)}\n`);
} else if (result.textLines.length > 0) {
  process.stderr.write(`${result.textLines.join("\n")}\n`);
}

process.exitCode = result.exitCode;
