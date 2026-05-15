// SPDX-License-Identifier: Apache-2.0
//
// Compatibility test: verify that the esbuild bundle (standalone npm artifact)
// produces identical JSON envelopes to the tsc-compiled version.
//
// Run conditions:
//   - tsc path:    packages/alp-cli/dist/cli/main.js  (after pnpm run compile)
//   - bundle path: packages/alp-cli/dist/cli/main.js  (after pnpm --filter alp-sdk run bundle)
//
// In CI the bundle step overwrites the tsc output, so this test runs as part
// of release-cli.yml AFTER the bundle step to verify contract parity.
// Locally it is skipped if the bundle is not present.

const test = require("node:test");
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const bundlePath = path.join(
  __dirname,
  "..",
  "packages",
  "alp-cli",
  "dist",
  "cli",
  "main.js",
);

const bundleExists = fs.existsSync(bundlePath);

// Determine if the file at bundlePath is actually an esbuild bundle (has the
// shebang injected by esbuild --banner). tsc output does not have a shebang,
// so tests that require the esbuild artifact are skipped when only the tsc
// output is present (i.e. after pnpm run compile but before pnpm run bundle).
function isBundled() {
  if (!bundleExists) return false;
  const fd = fs.openSync(bundlePath, "r");
  const buf = Buffer.alloc(20);
  fs.readSync(fd, buf, 0, 20, 0);
  fs.closeSync(fd);
  return buf.toString("utf8").startsWith("#!");
}

const bundleReady = isBundled();

function runBundle(args) {
  return cp.spawnSync(process.execPath, [bundlePath, ...args], {
    encoding: "utf8",
  });
}

// Verify the bundle responds to --help with expected header text.
test("bundle --help contains ALP CLI header", { skip: !bundleReady }, () => {
  const result = runBundle(["--help"]);
  assert.equal(
    result.status,
    0,
    `exit code ${result.status}: ${result.stderr}`,
  );
  assert.match(result.stdout + result.stderr, /ALP CLI|Usage: alp|Commands:/i);
});

// Verify completion command produces a valid JSON envelope with correct keys.
test(
  "bundle completion JSON envelope is contract-compliant",
  { skip: !bundleReady },
  () => {
    const result = runBundle([
      "completion",
      "--shell",
      "bash",
      "--format",
      "json",
    ]);
    assert.equal(result.status, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(typeof payload.command, "string", "envelope.command missing");
    assert.equal(typeof payload.ok, "boolean", "envelope.ok missing");
    assert.equal(payload.command, "completion");
    assert.equal(payload.ok, true);
    assert.equal(payload.data.shell, "bash");
  },
);

// Verify failure envelope structure is preserved in the bundle.
test(
  "bundle unknown command returns failure envelope",
  { skip: !bundleReady },
  () => {
    const result = runBundle(["unknown-command", "--format", "json"]);
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "unknown-command");
    assert.equal(payload.ok, false);
    assert.ok(
      Array.isArray(payload.issues),
      "envelope.issues must be an array",
    );
    assert.equal(payload.issues[0].code, "cli.unsupported-command");
  },
);

// Verify the bundle shebang line is present (required for npx / global install).
test("bundle has #!/usr/bin/env node shebang", { skip: !bundleReady }, () => {
  const fd = fs.openSync(bundlePath, "r");
  const buf = Buffer.alloc(32);
  fs.readSync(fd, buf, 0, 32, 0);
  fs.closeSync(fd);
  assert.ok(
    buf.toString("utf8").startsWith("#!/usr/bin/env node"),
    "bundle must start with #!/usr/bin/env node for npx compatibility",
  );
});
