// SPDX-License-Identifier: Apache-2.0
//
// `classifySdkPin` (#604): what a post-bootstrap reconciliation should do when
// `tan sdk current` and `alpSdk.path` disagree.
//
// ── The measurement behind this file ────────────────────────────────────────
//
// Run against the pinned tan 0.6.0, with a CLONE of the SDK (never the real
// `~/.alp/sdk`) and `~/.alp/sdk-default` backed up and restored afterwards:
//
//   `tan bootstrap` MOVES the alp-sdk checkout. Not only under `--workspace` —
//   a plain `tan bootstrap` relocates it to `<parent>/alp-workspace/<name>`,
//   emits `bootstrap.workspace-relocated`, and writes `~/.alp/sdk-default`
//   pointing at the new location. The clone really did move.
//
//   The REAL bootstrap produces NO envelope — it runs through a terminal. The
//   only envelope carrying the code is the win32 `--dry-run` pre-flight, and
//   there `data.sdkRoot` is the PLANNED destination that does not exist yet
//   (the dry-run moved nothing; its message says "would move" where the real
//   run says "moved"). Acting on THAT would create the dangling pin this
//   module exists to detect.
//
// So the signal is on disk, not in the envelope: `pinExists`.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifySdkPin,
  describePinDangling,
  PIN_DANGLING_MESSAGE,
} = require("../packages/alp-core/dist/sdk/pinReconciliation.js");

const found = (sdkPath, sourceTier, state = "ready") => ({
  sdkPath,
  readiness: { state },
  sourceTier,
});

const OLD = "/home/dev/alp-sdk";
const NEW = "/home/dev/alp-workspace/alp-sdk";

// ---------------------------------------------------------------------------
// The relocation case — the whole point of #604
// ---------------------------------------------------------------------------

test("a pin that is GONE from disk, with tan resolving elsewhere, is `pin-dangling`", () => {
  assert.deepEqual(
    classifySdkPin({
      configuredPath: OLD,
      current: found(NEW, "globalDefault"),
      pinExists: false,
    }),
    {
      kind: "pin-dangling",
      configuredPath: OLD,
      sdkPath: NEW,
      sourceTier: "globalDefault",
    },
  );
});

test("a pin that EXISTS is ordinary disagreement, never a relocation", () => {
  assert.equal(
    classifySdkPin({
      configuredPath: OLD,
      current: found(NEW, "globalDefault"),
      pinExists: true,
    }).kind,
    "pin-differs",
    "two SDKs that both exist is tan-cli#464's everyday case — a foreign " +
      "project's bootstrap answering the shared global default — and the " +
      "customer's own pin still resolves, so nothing is broken to decide about",
  );
});

// ---------------------------------------------------------------------------
// The order of the tests IS the contract
// ---------------------------------------------------------------------------

test("no usable answer beats everything, including a dangling pin", () => {
  for (const current of [
    null,
    { sdkPath: null, readiness: null, sourceTier: "none" },
    { sdkPath: "", readiness: null, sourceTier: "none" },
  ]) {
    assert.deepEqual(
      classifySdkPin({ configuredPath: OLD, current, pinExists: false }),
      { kind: "no-answer" },
      "with nothing resolved there is nothing to offer, so a dangling pin " +
        "must not produce a dialog with an empty destination",
    );
  }
});

test("a resolved-but-unready SDK beats agreement AND the pin tests", () => {
  assert.deepEqual(
    classifySdkPin({
      configuredPath: OLD,
      current: found(NEW, "globalDefault", "missing"),
      pinExists: false,
    }),
    { kind: "not-ready", sdkPath: NEW, sourceTier: "globalDefault" },
    "offering to repoint at a path tan itself says is not an SDK root would " +
      "pop `setActiveSdk`'s own poison-guard dialog out of a background check",
  );
});

test("agreement beats the pin tests, so a matching pin never asks", () => {
  assert.deepEqual(
    classifySdkPin({
      configuredPath: NEW,
      current: found(NEW, "projectPin"),
      pinExists: false,
    }),
    { kind: "agrees", sdkPath: NEW },
    "the pin already names what tan resolved; there is nothing to switch TO, " +
      "and asking would offer the customer the path they already have",
  );
});

test("an empty pin is filled in, and cannot dangle", () => {
  assert.deepEqual(
    classifySdkPin({
      configuredPath: "",
      current: found(NEW, "discovery"),
      pinExists: false,
    }),
    { kind: "pin-empty", sdkPath: NEW, sourceTier: "discovery" },
    "`pinExists` is meaningless for an empty pin and must not route it into " +
      "the dangling branch, which would ask about a pin that does not exist",
  );
});

test("an ABSENT sourceTier degrades to an empty string, never undefined", () => {
  // The field genuinely missing, not present-and-empty: `sourceTier: ""`
  // survives both the `?? ""` and a bare cast, so a fixture using it cannot
  // tell them apart — verified against the mutation that replaces the
  // coalesce with `as string`, which that fixture passes and this one kills.
  const verdict = classifySdkPin({
    configuredPath: OLD,
    current: { sdkPath: NEW, readiness: { state: "ready" } },
    pinExists: false,
  });
  assert.equal(verdict.kind, "pin-dangling");
  assert.equal(
    verdict.sourceTier,
    "",
    "an `undefined` here reaches the dialog body as the literal word " +
      '"undefined" next to a path the customer is being asked to trust',
  );
  assert.ok(
    !describePinDangling(OLD, NEW, verdict.sourceTier).includes("undefined"),
    "and the rendered body is where the customer would actually see it",
  );
});

test("a null readiness is not `missing` — the `none` tier legitimately carries one", () => {
  assert.equal(
    classifySdkPin({
      configuredPath: OLD,
      current: { sdkPath: NEW, readiness: null, sourceTier: "globalDefault" },
      pinExists: false,
    }).kind,
    "pin-dangling",
  );
});

test("an unseen readiness state is not treated as missing", () => {
  assert.equal(
    classifySdkPin({
      configuredPath: OLD,
      current: found(NEW, "globalDefault", "degraded"),
      pinExists: false,
    }).kind,
    "pin-dangling",
    "only the literal `missing` blocks; a vocabulary this extension has " +
      "never seen must not silently swallow the dangling-pin case",
  );
});

// ---------------------------------------------------------------------------
// The rendered strings
// ---------------------------------------------------------------------------

test("the question carries no absolute path", () => {
  assert.doesNotMatch(
    PIN_DANGLING_MESSAGE,
    /\/|\\\\/,
    "`planConfirm` and `planFailure` demote a customer sentence carrying an " +
      "absolute path into the channel-only detail — for a confirm that would " +
      "throw the question itself away",
  );
  assert.match(PIN_DANGLING_MESSAGE, /\?$/, "it has to read as a question");
});

test("the dialog body names both paths and the tier", () => {
  const body = describePinDangling(OLD, NEW, "globalDefault");
  assert.ok(body.includes(OLD));
  assert.ok(body.includes(NEW));
  assert.ok(body.includes("globalDefault"));
});

test("the body does NOT assert the bootstrap moved it", () => {
  const body = describePinDangling(OLD, NEW, "globalDefault");
  assert.match(
    body,
    /unmounted volume|not cloned yet/,
    "an unmounted volume produces exactly the same evidence as a relocation, " +
      "so the body must give the customer that reading too — claiming the " +
      "cause would be wrong precisely when they most need to say no",
  );
});
