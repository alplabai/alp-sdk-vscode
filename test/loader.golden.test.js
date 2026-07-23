const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createLoaderPlan,
  listGenerationTargetSupport,
} = require("../packages/alp-core/dist/loader/service.js");

function readGolden(relativePath) {
  const fullPath = path.join(__dirname, "golden", relativePath);
  // Normalize CRLF -> LF: on Windows the golden .json files can smudge to CRLF
  // on checkout (autocrlf) while JSON.stringify emits LF.
  return fs.readFileSync(fullPath, "utf8").replace(/\r\n/g, "\n");
}

test("generation target catalog matches golden snapshot", () => {
  const actual = `${JSON.stringify(listGenerationTargetSupport(), null, 2)}\n`;
  const expected = readGolden("loader-target-support.json");

  assert.equal(actual, expected);
});

test("zephyr loader plan matches golden snapshot", () => {
  const plan = createLoaderPlan(
    {
      workspaceRoot: "/workspace/app",
      sdkRoot: "/workspace/sdk",
      boardYamlPath: "/workspace/app/board.yaml",
      westCwd: "/workspace/app",
      pythonBinary: "python3",
    },
    "zephyr-conf",
  );

  // No comparison-side backslash masking here: outputPath/scriptPath/commandLine
  // are forward-slash at the source (toPosix in loader/service.ts), so this
  // assertion actually covers Windows-host determinism instead of laundering it.
  const actual = `${JSON.stringify(plan, null, 2)}\n`;
  const expected = readGolden("loader-plan-zephyr-conf.json");

  assert.equal(actual, expected);
});
