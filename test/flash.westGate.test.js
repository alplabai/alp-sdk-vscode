// SPDX-License-Identifier: Apache-2.0
//
// The plain `west flash` path writes a device too, and nothing was asking (#549).
//
// `alp.westFlash` runs `west flash` in a TERMINAL. It never reaches
// `runAlpStreamed`, so the tan-side consent gate (`src/flash/gate.ts`) cannot
// see it at all — and `west flash` programs the attached board the moment it
// starts. Measured on dev before this change: `alp.westFlash` was registered
// at `src/west.ts`, called `westFlash()`, and went straight to `runInTerminal`
// with no prompt anywhere on the path.
//
// The gate is wired INSIDE `executeWestPlan`, the shared terminal executor,
// for the same reason the tan gate lives inside `runAlpStreamed`: a gate a
// call site opts into is a gate the next call site forgets — which is exactly
// how both tan flash sites came to omit the same flag (#540).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  isWestFlashPlan,
} = require("../packages/alp-core/dist/west/service.js");

const ADAPTER = fs.readFileSync(
  path.join(__dirname, "..", "src", "west", "vscodeAdapter.ts"),
  "utf8",
);

// ── the predicate ───────────────────────────────────────────────────────────

test("a west flash plan is recognised", () => {
  assert.equal(isWestFlashPlan(["west", "flash"]), true);
});

test("it still recognises the plan after the venv substitution shape", () => {
  // `executeWestPlan` swaps `args[0]` for the workspace venv's west when there
  // is one. The gate runs BEFORE that, but the predicate must not depend on
  // the first element being the literal `west` either way.
  assert.equal(
    isWestFlashPlan(["/w/.venv/bin/west", "flash"]),
    true,
    "an absolute west path must not smuggle a flash past the gate",
  );
});

test("the other west plans are not flashes", () => {
  for (const args of [
    ["west", "update"],
    ["west", "build"],
    ["west", "build", "-t", "run"],
  ]) {
    assert.equal(
      isWestFlashPlan(args),
      false,
      `${args.join(" ")} must not raise a write dialog`,
    );
  }
});

test("the predicate errs toward asking, and says so", () => {
  // A wrong yes costs a dialog nobody needed; a wrong no costs a board
  // programmed without being asked. The comment in `service.ts` states that
  // direction, and this pins the behaviour it describes.
  assert.equal(isWestFlashPlan(["west", "flash", "--runner", "jlink"]), true);
  assert.equal(isWestFlashPlan([]), false, "an empty plan is not a write");
});

// ── the wiring ──────────────────────────────────────────────────────────────

test("executeWestPlan gates before it reaches the terminal", () => {
  // SOURCE-LEVEL: `executeWestPlan` imports `vscode`, so it cannot be called
  // from node:test. What this owes the reader is the ORDER — the refusal must
  // come before the spawn, not after it.
  const gate = ADAPTER.indexOf("isWestFlashPlan(plan.args)");
  const spawn = ADAPTER.indexOf("runInTerminal({");
  assert.ok(gate > 0, "executeWestPlan must consult isWestFlashPlan");
  assert.ok(spawn > 0, "the terminal spawn must still be there");
  assert.ok(
    gate < spawn,
    "the consent gate must run BEFORE runInTerminal — after it, the board is " +
      "already being written",
  );
});

test("a declined flash returns without running anything", () => {
  assert.match(
    ADAPTER,
    /if \(isWestFlashPlan\(plan\.args\) && !\(await confirmWestFlash\(plan\)\)\) \{[\s\S]{0,200}?return;/,
    "a decline must short-circuit — falling through would run the flash the " +
      "customer just refused",
  );
});

test("the dialog names the command and the workspace, not just 'are you sure'", () => {
  // A confirm that does not say WHAT it is about to write is a confirm the
  // customer cannot answer. There is no `system-manifest.yaml` on this path,
  // so the workspace and the argv are the whole of what can be named.
  const body = ADAPTER.slice(
    ADAPTER.indexOf("async function confirmWestFlash"),
    ADAPTER.indexOf("export async function executeWestPlan"),
  );
  assert.match(body, /plan\.args\.join\(" "\)/, "the argv must be quoted");
  assert.match(body, /plan\.westCwd/, "the workspace must be named");
  assert.match(
    body,
    /confirm: \{ id: "flashDevice" \}/,
    "it must be a blocking confirm, not an informational toast",
  );
});

test("no other west command is gated by accident", () => {
  // The control. Gating `west update` behind a write dialog would train the
  // customer to click through it, which is how a confirm stops working.
  assert.doesNotMatch(
    ADAPTER,
    /isWestFlashPlan\(plan\.args\) \|\|/,
    "the gate must fire on a flash and nothing else",
  );
});

// ── the OTHER spelling (#596) ───────────────────────────────────────────────

test("the alp-flash spelling is a write too", () => {
  // `createWestAlpFlashPlan` builds ["west", "alp-flash", appPath] — 27 lines
  // below the predicate, in the SAME file — and "alp-flash" !== "flash", so an
  // `args.includes("flash")` test never fired for it. No call site builds that
  // plan today; the gate must not depend on that staying true.
  assert.equal(isWestFlashPlan(["west", "alp-flash", "/w/app"]), true);
  assert.equal(
    isWestFlashPlan(["/w/.venv/bin/west", "alp-flash", "/w/app"]),
    true,
    "the venv substitution must not smuggle this spelling past either",
  );
});

test("a path that merely ends in flash is still not a command", () => {
  // The predicate matches whole tokens, not substrings: a project directory
  // called `my-flash` is not a request to program a board.
  assert.equal(isWestFlashPlan(["west", "build", "/w/my-flash"]), false);
});
