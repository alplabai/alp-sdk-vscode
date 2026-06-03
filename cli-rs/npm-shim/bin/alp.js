#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Thin launcher: forwards argv to the native `alp` binary placed by
// postinstall.js, inheriting stdio and the exit code.

const path = require("path");
const { spawnSync } = require("child_process");

const binName = process.platform === "win32" ? "alp.exe" : "alp";
const binPath = path.join(__dirname, "..", "binary", binName);

const result = spawnSync(binPath, process.argv.slice(2), { stdio: "inherit" });

if (result.error) {
  const hint =
    result.error.code === "ENOENT"
      ? "alp-sdk: native binary not found — reinstall the package to re-run its postinstall step."
      : `alp-sdk: failed to launch native binary: ${result.error.message}`;
  console.error(hint);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
