const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

// sha256 of metadata/schemas/system-manifest-v1.schema.json at the alp-sdk
// v0.7.0 tag. THE drift gate (same policy as board.schema): any local edit,
// forward drift (re-vendoring from submodule dev HEAD), or upstream change
// fails here. To bump the vendored schema intentionally:
//   git -C alp-sdk-upstream show <tag>:metadata/schemas/system-manifest-v1.schema.json \
//     > schemas/system-manifest-v1.schema.json
// then recompute over the LF-normalized file — portable + Windows-safe:
//   node -e "const s=require('fs').readFileSync('schemas/system-manifest-v1.schema.json','utf-8').replace(/\r\n/g,'\n');console.log(require('crypto').createHash('sha256').update(s,'utf-8').digest('hex'))"
const VENDORED_SCHEMA_SHA256 =
  "4b231d756e57f9822dc9ac12b327d6ed10685863d879f02c89f070fe77bf2326";

test("system-manifest-v1 schema is vendored from alp-sdk v0.7.0 (drift gate)", () => {
  const p = path.join(
    __dirname,
    "..",
    "schemas",
    "system-manifest-v1.schema.json",
  );
  assert.ok(
    fs.existsSync(p),
    "schemas/system-manifest-v1.schema.json must exist",
  );
  const raw = fs.readFileSync(p, "utf-8");
  const schema = JSON.parse(raw);

  assert.match(String(schema.$id ?? ""), /system-manifest-v1\.schema\.json/);
  // schema_version is the dispatch key, pinned const 1 (additive-only major).
  assert.equal(schema.properties?.schema_version?.const, 1);
  // The contract's required top-level keys (the IDE reads slices/ipc/etc.).
  assert.deepEqual(schema.required, [
    "schema_version",
    "generated_by",
    "hw_info",
    "slices",
    "ipc",
    "helper_mcus",
    "boot_order",
  ]);

  // Byte-exact pin to the SDK tag the copy was vendored from. Normalize CRLF→LF
  // first so a Windows checkout (core.autocrlf=true smudges to CRLF) hashes the
  // same LF blob git stores.
  const normalized = raw.replace(/\r\n/g, "\n");
  const hash = crypto
    .createHash("sha256")
    .update(normalized, "utf-8")
    .digest("hex");
  assert.equal(
    hash,
    VENDORED_SCHEMA_SHA256,
    "vendored system-manifest schema drifted — re-vendor from the pinned tag + update the hash",
  );
});
