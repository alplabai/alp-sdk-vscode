// SPDX-License-Identifier: Apache-2.0
//
// The flash consent gate must be UNSKIPPABLE (#540).
//
// #540's defect was not that someone wrote the wrong flag — it is that two
// independent call sites forgot the SAME flag, and nothing noticed for a whole
// release. A gate wired at the call sites is a gate the third call site
// forgets identically. So the gate lives inside `runAlpStreamed`, and this
// file pins the two properties that keep it there:
//
//   1. `runAlpStreamed` calls it, before it spawns, and honours its refusal.
//   2. NO `tan flash` argv in the tree is dispatched through any other runner,
//      which is the only way a call site could route around it.
//   3. Every site the extractor calls a `flash` is a site the GATE's own
//      command reader (`isFlashArgv`) also calls a flash.
//
// (3) is not paperwork. The two readers disagreed: the extractor finds the
// command by skipping leading flags with their arities, while `isFlashArgv`
// was `args[0] === "flash"`. So `["--project", <dir>, "flash"]` — the shape
// `alpBuild` already builds for Build, forty lines above `alpFlash` — passed
// the runner check in this file (its runner IS `runAlpStreamed`) while
// bypassing the consent gate entirely: no dialog, no `--confirm`, and with
// `ALP_FLASH_FORCE=1` in the inherited environment, a write. A gate the
// enforcement test cannot see through is not enforcement.
//
// It also closes, for this one flag, limit (a) of `tan.surfaceContract.test.js`:
// that gate reads the argv written at the CALL SITE, so a flag the RUNNER adds
// is invisible to it. `--confirm` is added by the runner. This file checks it
// against the same vendored surface instead.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { isFlashArgv } = require("../packages/alp-core/dist/flash/argv.js");

const ROOT = path.join(__dirname, "..");
const ADAPTER = fs.readFileSync(
  path.join(ROOT, "src", "alpCli", "vscodeAdapter.ts"),
  "utf8",
);

/** The body of `runAlpStreamed` itself, not `streamRun` below it. */
const ENTRY = ADAPTER.slice(
  ADAPTER.indexOf("export async function runAlpStreamed("),
  ADAPTER.indexOf("async function streamRun("),
);

// ---------------------------------------------------------------------------
// 1. The runner asks, and obeys the answer
// ---------------------------------------------------------------------------

test("runAlpStreamed gates every dispatch through gateFlashDispatch", () => {
  assert.match(
    ADAPTER,
    /import \{ gateFlashDispatch \} from "\.\.\/flash\/gate";/,
    "the adapter no longer imports the consent gate",
  );
  assert.match(
    ENTRY,
    /const gated = await gateFlashDispatch\(args, options\.cwd\);/,
    "runAlpStreamed must run the consent gate itself — a gate the call sites " +
      "opt into is a gate a new call site forgets, which IS defect #540",
  );
});

test("a refused or cancelled gate spawns nothing at all", () => {
  assert.match(
    ENTRY,
    /if \(gated === null\) return;/,
    "a null answer means refused or cancelled and MUST short-circuit — " +
      "falling through would spawn the unarmed flash the gate just declined",
  );
  // The spawn takes the GATE's argv, never the caller's. Today the two are
  // equal for an accepted flash (the gate does not arm — `flash.gate.test.js`
  // pins that), but passing `args` here would make the accept path stop
  // depending on the gate's answer at all, which is the seam Part B arms.
  assert.match(
    ENTRY,
    /await streamRun\(context, gated, \{ \.\.\.options, isFlash \}\);/,
  );
  assert.doesNotMatch(ENTRY, /await streamRun\(context, args\b/);
});

// The runner has to know whether THIS spawn is a live write, because two of
// its behaviours differ for one: the Cancel button, and a death by signal.
// Asked of the argv going OUT (only the gate's accept puts `--confirm` on it),
// never of the one that came in.
test("the runner knows whether the argv it is about to spawn is armed", () => {
  assert.match(
    ENTRY,
    /const isFlash = isFlashArgv\(gated\);/,
    "runAlpStreamed must classify the OUTGOING argv — reading `args` instead " +
      "would always be false, since the call sites never write --confirm",
  );
});

test("the gate runs before the spawn, not after it", () => {
  const gate = ENTRY.indexOf("gateFlashDispatch(");
  const spawn = ENTRY.indexOf("streamRun(context");
  assert.ok(gate > 0 && spawn > 0);
  assert.ok(
    gate < spawn,
    "consent obtained after the write has started is not consent",
  );
});

// ---------------------------------------------------------------------------
// 2. Nothing routes around it
// ---------------------------------------------------------------------------

/** Every statically-readable `tan` invocation in `src/`, from the same
 *  extractor `tan.surfaceContract.test.js` drives. */
function extractSites() {
  const result = spawnSync(
    process.execPath,
    ["scripts/tan-surface/extract.mjs"],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  assert.equal(
    result.status,
    0,
    `the tan-surface extractor exited ${result.status}: ${result.stderr}`,
  );
  return JSON.parse(result.stdout);
}

test("every tan flash dispatch goes through the gated runner", () => {
  const sites = extractSites();
  const flashes = sites.filter((site) => site.command === "flash");
  assert.ok(
    flashes.length > 0,
    "no `tan flash` call site was found at all — either the extractor stopped " +
      "reading them or Flash was removed; a gate over nothing passes forever",
  );
  const offenders = flashes
    .filter((site) => site.runner !== "runAlpStreamed")
    .map(
      (site) => `${site.file}:${site.line}  ${site.runner}  ${site.rawText}`,
    );
  assert.deepEqual(
    offenders,
    [],
    "these sites spawn `tan flash` through a runner that does NOT carry the " +
      "consent gate. `gateFlashDispatch` lives inside `runAlpStreamed`; a " +
      "flash dispatched through `runAlpCommand`/`runAlpAsync`/" +
      "`runAlpInTerminal` writes a device with no dialog and no `--confirm`.",
  );
});

// The two readers must agree about what a flash IS. The extractor finds the
// command by skipping leading flags with their arities; `isFlashArgv` has to
// do the same, or a site the test above certifies as "dispatched through the
// gated runner" is a site the gate inside that runner never recognises.
//
// `commandPrefix` is the extractor's record of every token it consumed BEFORE
// the command, so the argv can be replayed through the gate's reader. An
// unreadable token (an identifier, a spread) is `null` and is replayed as a
// plain non-flag value — which is the right model when it sits in a flag's
// value slot, and correctly FAILS this assertion when it sits where the
// command reader would have to guess whether it is a flag.
test("every extracted `flash` site is a flash to the gate's own reader", () => {
  const sites = extractSites();
  const flashes = sites.filter((site) => site.command === "flash");
  assert.ok(flashes.length > 0, "no `tan flash` call site was found at all");
  const offenders = flashes
    .filter((site) => {
      if (site.commandPrefix === null) return true;
      const argv = [
        ...site.commandPrefix.map((token) => token ?? "<opaque>"),
        "flash",
      ];
      return !isFlashArgv(argv);
    })
    .map(
      (site) =>
        `${site.file}:${site.line}  prefix=${JSON.stringify(site.commandPrefix)}  ${site.rawText}`,
    );
  assert.deepEqual(
    offenders,
    [],
    "the extractor reads these as `tan flash`, `isFlashArgv` does not. The " +
      "gate lives behind `isFlashArgv`, so every one of them dispatches a " +
      "flash with NO consent dialog and no `--confirm` — and an " +
      "`ALP_FLASH_FORCE=1` environment (inherited by the spawn, which sources " +
      "the login profile) turns that unarmed flash into a silent write. Make " +
      "`isFlashArgv` skip whatever root-position flags this prefix carries, " +
      "or stop building the argv this way.",
  );
});

// ---------------------------------------------------------------------------
// 3. Cancel does not become a SIGKILL into a live write
// ---------------------------------------------------------------------------
//
// `runAlpStreamed`'s own header says the reservation refuses a same-named
// re-run and NEVER terminates one, because "killing a flash mid-write can
// leave a board unbootable". The progress notification's Cancel button was the
// one exception, and it was harmless only while tan wrote nothing without
// `--confirm`. Arming the gate aims that SIGTERM — and the SIGKILL behind it —
// at real MRAM.

/** The body of `streamRun`, which owns the spawn, the cancel and the exit. */
const STREAM = ADAPTER.slice(
  ADAPTER.indexOf("async function streamRun("),
  ADAPTER.indexOf("async function surfaceResolutionError("),
);

test("cancelling an ARMED flash asks before it signals anything", () => {
  assert.match(
    STREAM,
    /if \(!options\.isFlash\) \{\s*\n\s*stop\(\);/,
    "only a non-armed run may be stopped without asking",
  );
  assert.match(
    STREAM,
    /confirmStopOfFlash\(options\.name\)/,
    "a Cancel click on a live write must raise a second confirm — an " +
      "un-asked kill mid-write is the unbootable-board hazard the runner's " +
      "own header was written about",
  );
  // The kill is reachable ONLY through that answer. A stray `child.kill()`
  // outside `stop()` would be the same defect wearing a different name.
  // Comments stripped first: this file's prose names the call it is guarding.
  const code = STREAM.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /(^|\n)\s*\/\/[^\n]*/g,
    "$1",
  );
  assert.equal(
    code.match(/child\.kill\(/g).length,
    2,
    "child.kill appears somewhere other than the SIGTERM+SIGKILL pair inside " +
      "`stop()`, which is the only path a confirmed cancel may take",
  );
});

test("the second confirm names the unbootable-board risk in words", () => {
  const body = ADAPTER.slice(
    ADAPTER.indexOf("async function confirmStopOfFlash("),
    ADAPTER.indexOf("function warnInterruptedFlash("),
  );
  assert.match(body, /unbootable/);
  assert.match(body, /half-programmed/);
  assert.match(
    body,
    /return picked === "stopFlash";/,
    "anything other than an explicit accept must leave the write running",
  );
});

// The quietest outcome was the most dangerous one: a signal death emits no
// finish event at all ("a kill is not a failure to report as one"), so the
// partial-write warning never fired on the path where a half-programmed board
// is most likely.
test("a signal death of an armed flash surfaces the partial-write warning", () => {
  assert.match(
    STREAM,
    /if \(options\.isFlash\) warnInterruptedFlash\(options\.name, signal\);/,
    "a flash killed by a signal must say so — silence here is a board left " +
      "in an unknown state with nothing on screen",
  );
  const body = ADAPTER.slice(
    ADAPTER.indexOf("function warnInterruptedFlash("),
    ADAPTER.indexOf("/** The body of `runAlpStreamed`"),
  );
  assert.match(body, /severity: "warning"/);
  assert.match(body, /interrupted while it was writing/);
  assert.match(body, /unknown state/);
  // It must NOT claim the flash failed: nothing here can tell an interrupted
  // write from a refused one, and "failed" is a classification the signal
  // number does not support.
  assert.doesNotMatch(body, /failed/i);
});

// The gate adds `--confirm` itself, so no call site should carry it — a
// hardcoded one would read as consent already granted.
test("no call site hardcodes --confirm; only the gate arms it", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      // The gate itself, and the pure argv module that owns the spelling.
      if (full.endsWith(path.join("src", "flash", "gate.ts"))) continue;
      const source = fs
        .readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|\n)\s*\/\/[^\n]*/g, "$1");
      if (/["'`]--confirm["'`]/.test(source)) {
        offenders.push(path.relative(ROOT, full));
      }
    }
  };
  walk(path.join(ROOT, "src"));
  assert.deepEqual(
    offenders,
    [],
    "`--confirm` belongs to the consent gate. A call site that writes it " +
      "itself arms tan's write gate without anyone having been asked.",
  );
});

test("ALP_FLASH_FORCE appears nowhere in the extension", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs|json)$/.test(entry.name)) continue;
      // Comments stripped: `src/flash/gate.ts` DOCUMENTS this variable as one
      // of the two arming routes it deliberately does not take, and prose
      // naming the hazard is not the hazard.
      const code = fs
        .readFileSync(full, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|\n)\s*\/\/[^\n]*/g, "$1");
      if (code.includes("ALP_FLASH_FORCE")) {
        offenders.push(path.relative(ROOT, full));
      }
    }
  };
  for (const dir of ["src", "packages"]) walk(path.join(ROOT, dir));
  assert.deepEqual(
    offenders,
    [],
    "`ALP_FLASH_FORCE=1` arms tan's write gate from the ENVIRONMENT, where " +
      "the consent outlives the click that gave it. The dialog is the only " +
      "thing allowed to arm a flash.",
  );
});

// ---------------------------------------------------------------------------
// 3. The armed flag is real at the pin
// ---------------------------------------------------------------------------

test("--confirm is a live, non-inert option of `tan flash` at the pin", () => {
  const snapshot = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "test", "golden", "tan-surface", "surface.json"),
      "utf8",
    ),
  );
  const flash = snapshot.commands.flash;
  assert.ok(flash, "the vendored surface records no `tan flash` command");
  const confirm = flash.options["--confirm"];
  assert.ok(
    confirm,
    `tan ${snapshot.version} has no \`--confirm\` on \`flash\`. The gate arms ` +
      "a flag this pin does not accept: click exits 2 with `No such option` " +
      "and no envelope at all.",
  );
  assert.equal(
    confirm.inert,
    false,
    `\`--confirm\` is accepted-but-inert in tan ${snapshot.version} — it ` +
      "would parse, the run would exit 0, and NOTHING would be written after " +
      "the customer authorised a write.",
  );
  // A boolean: a metavar would mean the gate must supply a value, and
  // `armFlashArgv` supplies none.
  assert.equal(confirm.metavar, null);
});

// ---------------------------------------------------------------------------
// 5. The OTHER spawn channel (#596)
//
// `gateFlashDispatch` lived in `runAlpStreamed` alone, and the gate's own
// header calls that "unconditionally, on every argv". True of that function,
// not of the extension: `runAlpInTerminal` is a second spawn channel with no
// gate at all. Its callers are harmless today — ["bootstrap"], ["build"],
// ["run"] — but `tan run` accepts `--flash` (surface.json: the `run` command
// carries it), and `westRunNativeSim` already routes ["run"] through here.
// ---------------------------------------------------------------------------

/** The body of `runAlpInTerminal` itself. Its closing brace is the first one
 *  at column zero after the declaration. */
const TERMINAL_START = ADAPTER.indexOf(
  "export async function runAlpInTerminal(",
);
const TERMINAL = ADAPTER.slice(
  TERMINAL_START,
  ADAPTER.indexOf("\n}\n", TERMINAL_START) + 3,
);

test("runAlpInTerminal gates every dispatch through gateFlashDispatch", () => {
  assert.ok(TERMINAL_START > 0, "runAlpInTerminal must still exist");
  assert.match(
    TERMINAL,
    /await gateFlashDispatch\(args, options\.cwd\)/,
    "a second spawn channel without the gate is the same defect #540 was — " +
      "the gate must not be something a channel opts into",
  );
});

test("a refused gate opens no terminal", () => {
  const gate = TERMINAL.indexOf("gateFlashDispatch(");
  const spawn = TERMINAL.indexOf("runInTerminal({");
  assert.ok(gate > 0 && spawn > 0, "both the gate and the spawn must be here");
  assert.ok(gate < spawn, "the gate must run before the terminal is opened");
  assert.match(
    TERMINAL,
    /if \(gated === null\) return;/,
    "a null answer means refused or cancelled and MUST short-circuit",
  );
});

test("the terminal channel spawns what the gate returned, not the raw argv", () => {
  // The gate ARMS an approved flash by appending tan's `--confirm`. Spawning
  // `args` after gating `args` would drop that and preview instead of write —
  // or, worse, spawn an argv the gate rewrote for a different reason.
  assert.match(
    TERMINAL,
    /withSdkRoot\(gated\)/,
    "the gated argv is the one that must reach the terminal",
  );
});
