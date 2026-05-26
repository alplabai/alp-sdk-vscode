const test = require("node:test");
const assert = require("node:assert/strict");
const cp = require("node:child_process");
const path = require("node:path");

// The CLI moved out of the extension build into its own package; its bin
// ("alp") is packages/alp-cli/dist/cli/main.js.
const cliMain = path.join(__dirname, "..", "packages", "alp-cli", "dist", "cli", "main.js");

function runCli(args) {
  return cp.spawnSync(process.execPath, [cliMain, ...args], {
    encoding: "utf8",
  });
}

test("cli main emits completion script to stdout in text mode", () => {
  const result = runCli(["completion", "--shell", "fish"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /complete -c alp/);
});

test("cli main emits JSON envelope in json mode", () => {
  const result = runCli(["completion", "--shell", "bash", "--format", "json"]);

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "completion");
  assert.equal(payload.ok, true);
  assert.equal(payload.data.shell, "bash");
});

test("cli main returns unsupported command envelope", () => {
  const result = runCli(["unknown-command", "--format", "json"]);

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, "unknown-command");
  assert.equal(payload.ok, false);
  assert.equal(payload.issues[0].code, "cli.unsupported-command");
});
