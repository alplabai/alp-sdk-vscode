const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { BOARD_KEY_ORDER } = require("@alp-sdk/core/board/models");

// sha256 of metadata/schemas/board.schema.json at the alp-sdk v0.6.0 tag.
// THE drift gate: any local edit, forward drift (re-vendoring from submodule
// dev HEAD instead of the pinned tag), or upstream change fails here. To bump
// the vendored schema intentionally: copy it from the NEW pinned tag
// (`git -C alp-sdk-upstream show <tag>:metadata/schemas/board.schema.json`),
// then recompute this hash over the LF-normalized file — portable + Windows-safe
// (avoid `shasum`, which isn't on Windows):
//   node -e "const s=require('fs').readFileSync('schemas/board.schema.json','utf-8').replace(/\r\n/g,'\n');console.log(require('crypto').createHash('sha256').update(s,'utf-8').digest('hex'))"
const VENDORED_SCHEMA_SHA256 =
  "a3710fc52d5b079f789ad3c28be463eb142b86ba901e4d70f5de245f17e213de";

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

  // Byte-exact pin to the SDK tag the copy was vendored from. The key checks
  // above only catch regressions to a PRE-v0.6 schema; this catches local
  // edits and forward drift (e.g. re-vendoring from submodule dev HEAD) too.
  // Normalize CRLF→LF first: with core.autocrlf=true (the Windows default) the
  // checkout smudges the file to CRLF on disk, but the pin is the LF blob git
  // stores — so a pristine Windows clone would otherwise fail here.
  const normalized = raw.replace(/\r\n/g, "\n");
  const hash = crypto
    .createHash("sha256")
    .update(normalized, "utf-8")
    .digest("hex");
  assert.equal(
    hash,
    VENDORED_SCHEMA_SHA256,
    "schemas/board.schema.json differs from the pinned SDK tag — if the bump " +
      "is intentional, re-vendor from the new tag and update VENDORED_SCHEMA_SHA256",
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

test("BOARD_KEY_ORDER covers every vendored-schema top-level property (C1 recurrence gate)", () => {
  // parseBoardConfig + serializeBoardConfig whitelist top-level keys on
  // BOARD_KEY_ORDER and silently DROP anything not listed — the C1 data-loss
  // bug (`models` was dropped). This fails the moment the vendored schema gains
  // a top-level block the configurator would drop on round-trip; the fix is to
  // add the key to BOARD_KEY_ORDER (packages/alp-core/src/board/models.ts).
  const p = path.join(__dirname, "..", "schemas", "board.schema.json");
  const schema = JSON.parse(fs.readFileSync(p, "utf-8"));
  const schemaKeys = Object.keys(schema.properties ?? {});
  const covered = new Set(BOARD_KEY_ORDER);
  const dropped = schemaKeys.filter((k) => !covered.has(k));
  assert.deepEqual(
    dropped,
    [],
    `BOARD_KEY_ORDER omits schema top-level key(s) [${dropped.join(", ")}] — the ` +
      "configurator would drop them on round-trip (C1). Add them to BOARD_KEY_ORDER.",
  );
});
