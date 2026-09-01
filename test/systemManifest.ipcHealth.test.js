// SPDX-License-Identifier: Apache-2.0
//
// Which IPC links a finished build must speak up about, and the words for it
// (#553).
//
// The defect: `tan init --cores` scaffolds a default `ipc:` channel, on an AEN
// SoM it resolves `status: blocked` with a concrete `reason`, the build reports
// success and exits 0, and nothing anywhere says so. The reason is real
// information the customer never sees — measured on tan `0.6.0` /
// alp-sdk `v0.16.0-rc1`:
//
//   reason: memory_map.base is TBD for region 'mram_main' in SoM E1M-AEN801;
//     this SoM hasn't been HW-mapped yet so IPC carve-outs cannot be
//     allocated. ...
//
// `parseSystemManifest` already carries `status` and `reason` through
// (`systemManifest/service.ts` casts the whole `ipc` array, it does not rebuild
// it field by field), so this is a surfacing gap, not a parse gap. What is
// pinned here is the RULE for which links count and the text for them.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  unhealthyIpcLinks,
  describeUnhealthyIpc,
} = require("../packages/alp-core/dist/systemManifest/ipcHealth.js");

/** The link the wizard ships on a dual-M55 AEN project, verbatim from a
 *  generated `build/system-manifest.yaml`. */
const BLOCKED = Object.freeze({
  name: "alp_default_rpmsg",
  kind: "rpmsg",
  endpoints: ["m55_hp", "a32_cluster"],
  status: "blocked",
  reason:
    "memory_map.base is TBD for region 'mram_main' in SoM E1M-AEN801; this " +
    "SoM hasn't been HW-mapped yet so IPC carve-outs cannot be allocated.",
});

const manifestWith = (...ipc) => ({ ipc });

// ---------------------------------------------------------------------------
// Which links count

test("a blocked link is reported", () => {
  assert.deepEqual(unhealthyIpcLinks(manifestWith(BLOCKED)), [BLOCKED]);
});

test("an ok link is not reported", () => {
  assert.deepEqual(
    unhealthyIpcLinks(manifestWith({ ...BLOCKED, status: "ok" })),
    [],
  );
});

test("a link with no status at all is not reported", () => {
  // Absent means the manifest said nothing, not that something is wrong.
  // Reporting it would put a warning on every project that has an IPC block.
  const { status, reason, ...noStatus } = BLOCKED;
  assert.deepEqual(unhealthyIpcLinks(manifestWith(noStatus)), []);
});

test("any status other than ok counts, not just blocked", () => {
  // Same rule the Build Plan renderer already uses (`link.status &&
  // link.status !== "ok"`). `degraded` is a real value — it is the one the
  // webview render test feeds — and a rule that only knew `blocked` would let
  // it through silently.
  for (const status of ["degraded", "partial", "unknown", "whatever"]) {
    assert.equal(
      unhealthyIpcLinks(manifestWith({ ...BLOCKED, status })).length,
      1,
      `status=${status} must be reported`,
    );
  }
});

test("an empty status string is not a status", () => {
  assert.deepEqual(
    unhealthyIpcLinks(manifestWith({ ...BLOCKED, status: "" })),
    [],
  );
});

test("a manifest with no ipc block reports nothing", () => {
  assert.deepEqual(unhealthyIpcLinks({ ipc: [] }), []);
  assert.deepEqual(unhealthyIpcLinks({}), []);
});

test("only the unhealthy links come back, in manifest order", () => {
  const ok = { ...BLOCKED, name: "healthy_link", status: "ok" };
  const second = { ...BLOCKED, name: "second_link", status: "degraded" };
  assert.deepEqual(unhealthyIpcLinks(manifestWith(ok, BLOCKED, second)), [
    BLOCKED,
    second,
  ]);
});

// ---------------------------------------------------------------------------
// The words

test("one link is named, with its status, in the message", () => {
  const { message } = describeUnhealthyIpc([BLOCKED]);
  assert.match(message, /alp_default_rpmsg/);
  assert.match(message, /blocked/);
  // The build really did succeed. Saying otherwise would turn a green build
  // into a red one over a link the customer may not even want.
  assert.match(message, /succeeded/);
});

test("several links are counted rather than crammed into one sentence", () => {
  const { message } = describeUnhealthyIpc([
    BLOCKED,
    { ...BLOCKED, name: "second_link" },
  ]);
  assert.match(message, /2 IPC links/);
});

test("the detail carries tan's reason verbatim, never summarised", () => {
  const { detail } = describeUnhealthyIpc([BLOCKED]);
  assert.ok(
    detail.includes(BLOCKED.reason),
    "the reason is the whole point — it is the only actionable half",
  );
});

test("the detail names the endpoints, because they are the surprise", () => {
  // The customer picked m55_hp and m55_he. The link tan scaffolds joins
  // m55_hp to a32_cluster — a core that is not in their build. Printing the
  // endpoints is what makes that visible.
  const { detail } = describeUnhealthyIpc([BLOCKED]);
  assert.match(detail, /m55_hp/);
  assert.match(detail, /a32_cluster/);
  assert.match(detail, /rpmsg/);
});

test("a link with no reason says so instead of printing nothing", () => {
  const { reason, ...noReason } = BLOCKED;
  const { detail } = describeUnhealthyIpc([noReason]);
  assert.match(detail, /alp_default_rpmsg/);
  assert.match(detail, /no reason given/i);
});

test("every link appears in the detail, not just the first", () => {
  const second = {
    ...BLOCKED,
    name: "second_link",
    reason: "a different reason entirely",
  };
  const { detail } = describeUnhealthyIpc([BLOCKED, second]);
  assert.ok(detail.includes(BLOCKED.reason));
  assert.ok(detail.includes(second.reason));
});
