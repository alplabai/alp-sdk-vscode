const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("board.schema.json is the vendored v0.6 schema (drift/staleness gate)", () => {
  const p = path.join(__dirname, "..", "schemas", "board.schema.json");
  assert.ok(fs.existsSync(p), "schemas/board.schema.json must exist");
  const raw = fs.readFileSync(p, "utf-8");
  const schema = JSON.parse(raw);
  assert.match(String(schema.$id ?? ""), /board\.schema\.json/);
  assert.deepEqual(schema.required, ["som", "cores"]);

  // Staleness gate: the vendored copy must carry the v0.6 structure. `models`
  // and `supported_boards` are top-level blocks added in v0.6; a regression to a
  // pre-v0.6 schema (which lacked them) fails here — re-vendor from the SDK
  // (`git -C alp-sdk-upstream show v0.6.0:metadata/schemas/board.schema.json`).
  const props = schema.properties ?? {};
  for (const key of ["som", "cores", "ipc", "models", "supported_boards"]) {
    assert.ok(
      props[key],
      `vendored schema must define top-level '${key}' — re-vendor from the SDK`,
    );
  }
  // IPC carve-outs use carve_out_kb (the legacy size_kib field was renamed).
  assert.ok(
    raw.includes("carve_out_kb"),
    "ipc carve-outs must use carve_out_kb",
  );
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
