const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  VENDORED_SDK_TAG,
  SYSTEM_MANIFEST_SCHEMA_SHA256,
} = require("./vendored-sdk-tag");
const {
  sha256OfSchemaText,
} = require("@alp-sdk/core/validation/schemaProvenance");

// sha256 of metadata/schemas/system-manifest-v1.schema.json at the alp-sdk
// VENDORED_SDK_TAG tag. THE drift gate (same policy as board.schema): any local
// edit, forward drift (re-vendoring from submodule dev HEAD), or upstream change
// fails here. The tag and both vendored-schema hashes live in
// packages/alp-core/src/validation/vendoredSchemas.ts (./vendored-sdk-tag.js
// re-exports them, and the extension reads them at runtime), so the board and
// system-manifest copies can never green while disagreeing on tag. To bump the
// vendored schema intentionally:
//   git -C alp-sdk-upstream show <tag>:metadata/schemas/system-manifest-v1.schema.json \
//     > schemas/system-manifest-v1.schema.json
// then recompute over the LF-normalized file — portable + Windows-safe — and
// update packages/alp-core/src/validation/vendoredSchemas.ts:
//   node -e "const s=require('fs').readFileSync('schemas/system-manifest-v1.schema.json','utf-8').replace(/\r\n/g,'\n');console.log(require('crypto').createHash('sha256').update(s,'utf-8').digest('hex'))"

test(`system-manifest-v1 schema is vendored from alp-sdk ${VENDORED_SDK_TAG} (drift gate)`, () => {
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
  assert.equal(
    sha256OfSchemaText(raw),
    SYSTEM_MANIFEST_SCHEMA_SHA256,
    "vendored system-manifest schema drifted — re-vendor from the pinned tag " +
      "and update packages/alp-core/src/validation/vendoredSchemas.ts (NOT " +
      "test/vendored-sdk-tag.js, which only re-exports it)",
  );
});
