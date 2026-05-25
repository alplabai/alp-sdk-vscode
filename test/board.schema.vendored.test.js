const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("board.schema.json is vendored and structurally valid", () => {
  const p = path.join(__dirname, "..", "schemas", "board.schema.json");
  assert.ok(fs.existsSync(p), "schemas/board.schema.json must exist");
  const schema = JSON.parse(fs.readFileSync(p, "utf-8"));
  assert.match(String(schema.$id ?? ""), /board\.schema\.json/);
  assert.deepEqual(schema.required, ["som", "cores"]);
});

test("package.json yamlValidation points at the vendored schema", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8"),
  );
  const entry = pkg.contributes.yamlValidation.find(
    (e) => e.fileMatch === "board.yaml",
  );
  assert.ok(entry, "a yamlValidation entry for board.yaml is required");
  assert.equal(entry.url, "./schemas/board.schema.json");
});
