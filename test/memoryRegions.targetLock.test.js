// SPDX-License-Identifier: Apache-2.0
//
// The fail-closed TARGET LOCK on `memory[]` regions (#484, D5 re-taken).
//
// A region may be offered as the target of an edit — an IPC carve-out or a
// storage partition the customer sizes in board.yaml — ONLY when every one of
// these holds, exactly:
//
//   status === "ok"
//   write_authority === "customer_runtime"   (present, exact spelling)
//   base and size_bytes both resolved, size non-zero
//   no overlap with a row that is not customer_runtime; a unique name
//   kind fits the field: ipc → "ram"; storage → "flash" | "unclassified"
//
// Everything else is locked, with a reason. The cost of a wrong unlock is not
// a bad render: on E1M-AEN801 the Secure-Enclave ATOC sits at 0x80578000,
// directly above a customer `storage` band, and writing it can leave the part
// unbootable (alp-sdk#1289). So this file pins the allowlist from both ends:
// against the vendored schema's own enums (a value upstream adds must be
// classified here before it can mean anything), and as a full cartesian
// product, so no combination can drift open without a red test.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildMemoryView,
  regionTargetLock,
  TARGET_LOCK_CLASSIFIED,
} = require("../packages/alp-core/dist/systemManifest/memoryView.js");
const {
  parseSystemManifest,
} = require("../packages/alp-core/dist/systemManifest/service.js");

const REPO = path.join(__dirname, "..");
const schema = JSON.parse(
  fs.readFileSync(
    path.join(REPO, "schemas", "system-manifest-v1.schema.json"),
    "utf8",
  ),
);
const memoryItem = schema.properties.memory.items;

const FIELDS = ["ipc", "storage"];

function fixture(name) {
  const text = fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
  return buildMemoryView(parseSystemManifest(text));
}

function regionNamed(view, name) {
  const found = (view.regions ?? []).filter((r) => r.name === name);
  assert.equal(found.length, 1, `exactly one region named ${name}`);
  return found[0];
}

/** A narrowed region with every field explicit. */
function region(fields) {
  return {
    id: `memory:${fields.name ?? "r"}`,
    name: fields.name ?? "r",
    source: "som_preset",
    kind: fields.kind,
    status: fields.status,
    base: fields.base,
    sizeBytes: fields.sizeBytes,
    writeAuthority: fields.writeAuthority,
    authorityClass: "unstated",
    cores: [],
    reason: null,
  };
}

/** The allowlist, restated independently of the module under test. */
function expectUnlocked(t, field) {
  if (t.status !== "ok") return false;
  if (t.writeAuthority !== "customer_runtime") return false;
  if (t.base === null || t.sizeBytes === null || t.sizeBytes === 0) {
    return false;
  }
  if (field === "ipc") return t.kind === "ram";
  return t.kind === "flash" || t.kind === "unclassified";
}

test("(a) the predicate classifies exactly the schema's enums — a new upstream value reds this", () => {
  const props = memoryItem.properties;
  for (const key of ["write_authority", "kind", "status", "source"]) {
    assert.deepEqual(
      [...TARGET_LOCK_CLASSIFIED[key]].sort(),
      [...props[key].enum].sort(),
      `memory[].${key} enum changed upstream — classify the new value in ` +
        "memoryView/targetLock.ts (it stays LOCKED until you do) and update " +
        "this test in the same reviewed change",
    );
  }
});

test("(b) cartesian: unlocked iff the allowlist tuple, for every field", () => {
  const statuses = [...memoryItem.properties.status.enum, "made_up", ""];
  const authorities = [
    ...memoryItem.properties.write_authority.enum,
    null,
    "made_up",
    "CUSTOMER_RUNTIME",
    "customer_runtime ",
    "__proto__",
    "constructor",
  ];
  const kinds = [...memoryItem.properties.kind.enum, "made_up", ""];
  const bases = [0x80560000, null];
  const sizes = [98304, null, 0];
  let cases = 0;
  let unlocked = 0;
  for (const status of statuses)
    for (const writeAuthority of authorities)
      for (const kind of kinds)
        for (const base of bases)
          for (const sizeBytes of sizes)
            for (const field of FIELDS) {
              const t = { status, writeAuthority, kind, base, sizeBytes };
              const lock = regionTargetLock(region(t), field);
              const want = expectUnlocked(t, field);
              cases += 1;
              if (!lock.locked) unlocked += 1;
              assert.equal(
                lock.locked,
                !want,
                `${JSON.stringify({ ...t, field })} → ${JSON.stringify(lock)}`,
              );
              assert.equal(typeof lock.reason, "string");
              assert.ok(lock.reason.length > 0, "every verdict says why");
            }
  // ipc: one kind (ram); storage: two (flash, unclassified).
  assert.equal(unlocked, 3, "exactly three tuples unlock across both fields");
  assert.ok(cases > 1000);
});

test("(b) an unlocked verdict never rests on source or name alone", () => {
  for (const source of ["som_preset", "soc_derived", "made_up"]) {
    for (const name of ["storage", "nvs", "data", "ipc_shm"]) {
      const lock = regionTargetLock(
        {
          ...region({
            name,
            status: "ok",
            writeAuthority: null,
            kind: "flash",
            base: 0x80560000,
            sizeBytes: 98304,
          }),
          source,
        },
        "storage",
      );
      assert.equal(lock.locked, true, `${source}/${name}`);
      assert.match(lock.reason, /write authority not declared/);
    }
  }
});

test("(b) a locked verdict names what locked it", () => {
  const base = {
    status: "ok",
    writeAuthority: "customer_runtime",
    kind: "flash",
    base: 1,
    sizeBytes: 1,
  };
  const reasonOf = (over, field = "storage") =>
    regionTargetLock(region({ ...base, ...over }), field).reason;
  assert.match(
    reasonOf({ writeAuthority: "secure_enclave" }),
    /secure_enclave/,
  );
  assert.match(
    reasonOf({ writeAuthority: "secure_enclave" }),
    /Secure Enclave/,
  );
  assert.match(reasonOf({ writeAuthority: "vendor_image" }), /vendor_image/);
  assert.match(reasonOf({ writeAuthority: "made_up" }), /not recognised/);
  assert.match(reasonOf({ status: "unresolved" }), /unresolved/);
  assert.match(reasonOf({ base: null }), /base/);
  assert.match(reasonOf({ sizeBytes: null }), /size/);
  assert.match(reasonOf({ sizeBytes: 0 }), /zero-size region/);
  assert.match(reasonOf({}, "ipc"), /ram/);
});

test("(c) write_authority is not schema-required — so absence must lock, and does", () => {
  assert.equal(
    memoryItem.required.includes("write_authority"),
    false,
    "memory[].write_authority became REQUIRED upstream. Review #484 D5: " +
      "required-ness must NOT unlock anything by itself — the allowlist in " +
      "memoryView/targetLock.ts still keys on the exact value. Update this " +
      "assertion deliberately once that is re-checked.",
  );
  assert.deepEqual([...memoryItem.required].sort(), [
    "kind",
    "name",
    "source",
    "status",
  ]);
});

test("(d) AEN fixture: only `storage` is a storage target; atoc and mram_main lock for both", () => {
  const view = fixture("system-manifest.rpmsg-aen.memory.yaml");
  for (const name of [
    "atoc",
    "mram_main",
    "reserved",
    "mcuboot",
    "he_slot0",
    "hp_slot0",
  ]) {
    const r = regionNamed(view, name);
    for (const field of FIELDS) {
      assert.equal(r.targetLock[field].locked, true, `${name}.${field}`);
    }
  }
  assert.match(
    regionNamed(view, "atoc").targetLock.storage.reason,
    /secure_enclave/,
  );
  const storage = regionNamed(view, "storage");
  assert.equal(storage.targetLock.storage.locked, false);
  assert.equal(
    storage.targetLock.ipc.locked,
    true,
    "flash is not an ipc target",
  );
});

test("(d) V2N fixture: soc_derived rows with no authority all lock", () => {
  const view = fixture("system-manifest.rpmsg-v2n.memory.yaml");
  assert.ok((view.regions ?? []).length > 0);
  for (const r of view.regions) {
    for (const field of FIELDS) {
      assert.equal(r.targetLock[field].locked, true, `${r.name}.${field}`);
      assert.match(r.targetLock[field].reason, /write authority not declared/);
    }
  }
});

/** A manifest with exactly these `memory[]` rows. */
function manifestWith(rows, extra = {}) {
  // Built directly, not parsed: `parseSystemManifest` already refuses an
  // unknown schema_version, and the guard under test is the defence-in-depth
  // behind it, so it has to be reached without that first gate.
  return buildMemoryView({
    schema_version: 1,
    generated_by: "scripts/alp_orchestrate.py",
    hw_info: { sku: "E1M-AEN801" },
    slices: [],
    ipc: [],
    helper_mcus: [],
    boot_order: [],
    storage: [],
    ...(rows === undefined ? {} : { memory: rows }),
    ...extra,
  });
}

test("(e) #1289: rows NAMED storage/nvs/data without customer_runtime stay locked", () => {
  const rows = ["storage", "nvs", "data"].flatMap((name) => [
    {
      name,
      source: "som_preset",
      kind: "flash",
      status: "ok",
      base: 1,
      size_bytes: 4096,
    },
    {
      name: `${name}_ram`,
      source: "soc_derived",
      kind: "ram",
      status: "ok",
      base: 1,
      size_bytes: 4096,
    },
    {
      name: `${name}_se`,
      source: "som_preset",
      kind: "flash",
      status: "ok",
      base: 1,
      size_bytes: 4096,
      write_authority: "secure_enclave",
    },
  ]);
  const view = manifestWith(rows);
  assert.equal(view.regions.length, rows.length);
  for (const r of view.regions) {
    for (const field of FIELDS) {
      assert.equal(r.targetLock[field].locked, true, `${r.name}.${field}`);
    }
  }
});

test("whole-pane guard: an unknown schema_version locks every row", () => {
  const row = {
    name: "storage",
    source: "som_preset",
    kind: "flash",
    status: "ok",
    base: 2153119744,
    size_bytes: 98304,
    write_authority: "customer_runtime",
  };
  const open = manifestWith([row]);
  assert.equal(open.regions[0].targetLock.storage.locked, false);
  for (const version of [2, 0, "1", null]) {
    const view = manifestWith([row], { schema_version: version });
    for (const field of FIELDS) {
      const lock = view.regions[0].targetLock[field];
      assert.equal(lock.locked, true, `schema_version ${version}`);
      assert.match(lock.reason, /schema_version/);
    }
  }
});

test("whole-pane guard: no memory[] pane means no region can be a target", () => {
  const view = manifestWith(undefined);
  assert.equal(view.regions, undefined);
});

// ── Cross-row locks: a row is only as open as its neighbours allow ─────────

/** The AEN `storage` and `atoc` rows, with `storage` sized `storageSize`. */
function aenTail(storageSize) {
  return [
    {
      name: "storage",
      source: "som_preset",
      kind: "flash",
      status: "ok",
      base: 0x80560000,
      size_bytes: storageSize,
      write_authority: "customer_runtime",
    },
    {
      name: "atoc",
      source: "som_preset",
      kind: "flash",
      status: "ok",
      base: 0x80578000,
      size_bytes: 32768,
      write_authority: "secure_enclave",
    },
  ];
}

test("a customer_runtime row reaching ONE byte into atoc is locked for both fields", () => {
  const view = manifestWith(aenTail(98305));
  const storage = regionNamed(view, "storage");
  for (const field of FIELDS) {
    assert.equal(storage.targetLock[field].locked, true, field);
    assert.match(
      storage.targetLock[field].reason,
      /overlaps atoc \(secure_enclave\)/,
    );
  }
});

test("exactly adjacent to atoc (half-open) stays a storage target", () => {
  const storage = regionNamed(manifestWith(aenTail(98304)), "storage");
  assert.equal(storage.targetLock.storage.locked, false);
});

test("an overlap with a row of undeclared authority locks too, and says so", () => {
  const rows = aenTail(98304);
  rows.push({
    name: "shadow",
    source: "soc_derived",
    kind: "flash",
    status: "ok",
    base: 0x80560000 + 4096,
    size_bytes: 4096,
  });
  const storage = regionNamed(manifestWith(rows), "storage");
  assert.equal(storage.targetLock.storage.locked, true);
  assert.match(
    storage.targetLock.storage.reason,
    /overlaps shadow \(write authority not declared\)/,
  );
});

test("two customer_runtime rows overlapping each other do not lock each other", () => {
  const rows = aenTail(98304);
  rows.push({
    ...rows[0],
    name: "storage_b",
    base: 0x80560000 + 4096,
    size_bytes: 4096,
  });
  const view = manifestWith(rows);
  assert.equal(regionNamed(view, "storage").targetLock.storage.locked, false);
  assert.equal(regionNamed(view, "storage_b").targetLock.storage.locked, false);
});

test("a region name that occurs more than once locks every row of that name", () => {
  const [storage, atoc] = aenTail(98304);
  const twin = { ...storage, base: 0x90000000 };
  const view = manifestWith([storage, atoc, twin]);
  const named = view.regions.filter((r) => r.name === "storage");
  assert.equal(named.length, 2);
  for (const r of named) {
    for (const field of FIELDS) {
      assert.equal(r.targetLock[field].locked, true);
      assert.match(r.targetLock[field].reason, /region name is ambiguous/);
    }
  }
});
