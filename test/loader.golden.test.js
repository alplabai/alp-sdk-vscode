const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createLoaderPlan,
  listGenerationTargetSupport,
} = require("@alp-sdk/core/loader/service");

function readGolden(relativePath) {
  const fullPath = path.join(__dirname, "golden", relativePath);
  // Normalize CRLF → LF so the comparison is platform-agnostic.
  return fs.readFileSync(fullPath, "utf8").replace(/\r\n/g, "\n");
}

// Recursively walk a plain object/array/string and replace OS path separators
// with forward slashes in string values.  Must be applied to the value BEFORE
// JSON.stringify so we work on unescaped strings, not JSON-escaped backslashes.
function normalizePathsInValue(value) {
  if (path.sep === "/") return value;
  if (typeof value === "string") return value.split(path.sep).join("/");
  if (Array.isArray(value)) return value.map(normalizePathsInValue);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = normalizePathsInValue(v);
    }
    return out;
  }
  return value;
}

test("generation target catalog matches golden snapshot", () => {
  const actual = `${JSON.stringify(listGenerationTargetSupport(), null, 2)}\n`;
  const expected = readGolden("loader-target-support.json");

  // outputRelativePath values are plain string constants (no OS path joining),
  // so no path normalization is needed here.
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

  // Normalize OS path separators in the plan object values before serializing
  // so the JSON matches the POSIX paths stored in the golden file on every platform.
  const actual = `${JSON.stringify(normalizePathsInValue(plan), null, 2)}\n`;
  const expected = readGolden("loader-plan-zephyr-conf.json");

  assert.equal(actual, expected);
});
