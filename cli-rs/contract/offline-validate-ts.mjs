#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Offline TypeScript validator contract runner.
//
// This intentionally targets `validateBoardYamlLocally`, not the public TS
// `alp validate` command. The public command shells out to the Python SDK
// validator and is covered by the Rust migration plan's Phase 5.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);

const boardYaml = process.argv[2];
if (!boardYaml) {
  console.error("usage: offline-validate-ts.mjs <board.yaml>");
  process.exit(5);
}

const { validateBoardYamlLocally } = require("../../packages/alp-core/dist/validation/service.js");

const EXIT = {
  success: 0,
  validationFailure: 2,
  internalFailure: 5,
};

function envelope(data, issues, exitCode) {
  return {
    command: "validate",
    ok: exitCode === EXIT.success,
    exitCode,
    project: {
      root: ".",
      boardYaml,
    },
    data,
    issues,
  };
}

function issueCode(outcome) {
  return `validate.${outcome}`;
}

try {
  const result = validateBoardYamlLocally(readFileSync(boardYaml, "utf8"));
  const exitCode = result.outcome === "clean" ? EXIT.success : EXIT.validationFailure;
  const issues = result.issues.map((issue) => ({
    code: issueCode(result.outcome),
    severity: issue.severity,
    message: issue.message,
  }));
  const data = {
    schemaVersion: "1",
    outcome: result.outcome,
    issueCount: issues.length,
    commandLine: "",
    boardYamlPath: boardYaml,
  };

  console.log(JSON.stringify(envelope(data, issues, exitCode)));
  process.exit(exitCode);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const issues = [{ code: "validate.internal-failure", severity: "error", message }];
  const data = {
    schemaVersion: "1",
    outcome: "failed",
    issueCount: 1,
    commandLine: "",
    boardYamlPath: boardYaml,
  };

  console.log(JSON.stringify(envelope(data, issues, EXIT.internalFailure)));
  process.exit(EXIT.internalFailure);
}
