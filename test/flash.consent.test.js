// SPDX-License-Identifier: Apache-2.0
//
// The pure half of the flash consent gate (#540): what a `tan flash` run is
// about to program, read off the system manifest, plus the words the dialog
// shows for it.
//
// Ground truth is the SAME fixture `systemManifest.service.test.js` uses — the
// real `--emit system-manifest` output for the heterogeneous AEN801 example
// (an `off` A-core, two Zephyr M-cores, one helper MCU whose `flash_args` is
// the STRING "TBD"). Every awkward case this module has to answer for is
// already in it, so none of them is invented here.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  planFlashConsent,
} = require("../packages/alp-core/dist/flash/consent.js");
const {
  describeFlashConsent,
  flashConsentMessage,
} = require("../packages/alp-core/dist/flash/describe.js");
const {
  armFlashArgv,
  isFlashArgv,
  readFlashArgv,
  FLASH_VALUE_TAKING_FLAGS,
  ROOT_VALUE_TAKING_FLAGS,
} = require("../packages/alp-core/dist/flash/argv.js");

const SURFACE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "golden", "tan-surface", "surface.json"),
    "utf8",
  ),
);
const {
  parseSystemManifest,
} = require("../packages/alp-core/dist/systemManifest/service.js");

const MANIFEST = parseSystemManifest(
  fs.readFileSync(
    path.join(__dirname, "fixtures", "system-manifest.aen801.yaml"),
    "utf-8",
  ),
);

const CONTEXT = {
  projectDir: "/Users/dev/projects/aen801-demo",
  manifestPath: "/Users/dev/projects/aen801-demo/build/system-manifest.yaml",
};

const idsOf = (entries) => entries.map((e) => `${e.kind}:${e.id}`);

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

test("an unscoped flash lists every slice AND every helper MCU", () => {
  const plan = planFlashConsent(MANIFEST);
  assert.deepEqual(idsOf(plan.targets), [
    "slice:a32_cluster",
    "slice:m55_hp",
    "slice:m55_he",
    "helper:cc3501e_otp",
  ]);
  assert.deepEqual(plan.skipped, []);
  assert.equal(plan.sku, "E1M-AEN801");
});

// Rule (a) in `consent.ts`: over-listing costs a line, under-listing is a
// device programmed without consent. `a32_cluster` is `os: off` with NO
// flash_method at all and it is still listed, because nothing in this repo
// measures what tan does with it.
test("a slice with no flash_method is listed with a note, never dropped", () => {
  const plan = planFlashConsent(MANIFEST);
  const a32 = plan.targets.find((e) => e.id === "a32_cluster");
  assert.ok(a32, "the off A-core must appear — silence would be the defect");
  assert.equal(a32.flashMethod, null);
  assert.equal(a32.os, "off");
  assert.equal(a32.status, "pending");
  assert.match(a32.notes.join("\n"), /no flash_method in the manifest/);
});

// Rule (b): `status` is reported and NEVER filtered on. Every slice in the
// fixture is `pending`, which is not a "built and ready" state, and all three
// are still targets.
test("status never filters — a `pending` slice is still a target", () => {
  const plan = planFlashConsent(MANIFEST);
  assert.deepEqual(
    plan.targets.filter((e) => e.kind === "slice").map((e) => e.status),
    ["pending", "pending", "pending"],
  );
});

test("a helper MCU's string flash_args is carried verbatim and noted", () => {
  const plan = planFlashConsent(MANIFEST);
  const helper = plan.targets.find((e) => e.kind === "helper");
  assert.equal(helper.id, "cc3501e_otp");
  assert.equal(helper.chip, "cc3501e");
  assert.equal(helper.firmwarePath, "TBD");
  // The STRING, not an object and not coerced into one.
  assert.equal(helper.flashArgs, "TBD");
  assert.match(helper.notes.join("\n"), /flash_args is the string "TBD"/);
});

test("a slice's object flash_args stays an object", () => {
  const plan = planFlashConsent(MANIFEST);
  const hp = plan.targets.find((e) => e.id === "m55_hp");
  assert.deepEqual(hp.flashArgs, { runner: "openocd" });
  assert.equal(hp.flashMethod, "zephyr_west_flash");
  // No "string, not a recipe" note when it IS a recipe.
  assert.deepEqual(hp.notes, []);
});

// The half-programmed-board case. `--core`'s own help: "Flash only the slice
// with this core_id (skips every other slice AND all helpers)."
test("a --core scope skips every other slice AND all helpers, and says so", () => {
  const plan = planFlashConsent(MANIFEST, {
    coreId: "m55_hp",
    helperName: null,
  });
  assert.deepEqual(idsOf(plan.targets), ["slice:m55_hp"]);
  assert.deepEqual(idsOf(plan.skipped.map((s) => s.entry)), [
    "slice:a32_cluster",
    "slice:m55_he",
    "helper:cc3501e_otp",
  ]);
  const helperSkip = plan.skipped.find((s) => s.entry.kind === "helper");
  assert.match(helperSkip.reason, /skips every other slice AND all helpers/);
});

test("a --helper scope skips ALL slices and every other helper", () => {
  const plan = planFlashConsent(MANIFEST, {
    coreId: null,
    helperName: "cc3501e_otp",
  });
  assert.deepEqual(idsOf(plan.targets), ["helper:cc3501e_otp"]);
  assert.equal(plan.skipped.length, 3);
  for (const skip of plan.skipped) {
    assert.equal(skip.entry.kind, "slice");
    assert.match(skip.reason, /skips ALL slices/);
  }
});

test("a --core naming a slice the manifest does not have warns and targets nothing", () => {
  const plan = planFlashConsent(MANIFEST, {
    coreId: "m55_hp_typo",
    helperName: null,
  });
  assert.deepEqual(plan.targets, []);
  assert.equal(
    plan.skipped.length,
    4,
    "nothing may vanish — all four are skipped",
  );
  assert.match(plan.warnings.join("\n"), /no slice with core_id m55_hp_typo/);
});

test("a manifest with nothing in it warns rather than reading as a safe run", () => {
  const empty = parseSystemManifest("schema_version: 1\nslices: []\n");
  const plan = planFlashConsent(empty);
  assert.deepEqual(plan.targets, []);
  assert.match(
    plan.warnings.join("\n"),
    /declares no slices and no helper MCUs/,
  );
});

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

test("the dialog names the project, the manifest, every id and the consequence", () => {
  const text = describeFlashConsent(planFlashConsent(MANIFEST), CONTEXT);
  assert.match(text, /Project: \/Users\/dev\/projects\/aen801-demo\n/);
  assert.match(text, /Manifest: .*build\/system-manifest\.yaml/);
  assert.match(text, /SKU: E1M-AEN801/);
  // Every core_id, with its flash_method and its status.
  assert.match(
    text,
    /slice a32_cluster — os off, status pending, flash_method \(not stated\)/,
  );
  assert.match(
    text,
    /slice m55_hp — os zephyr, status pending, flash_method zephyr_west_flash, flash_args \{"runner":"openocd"\}/,
  );
  assert.match(
    text,
    /slice m55_he — os zephyr, status pending, flash_method zephyr_west_flash/,
  );
  // The helper MCU, with its name and its chip.
  assert.match(
    text,
    /helper cc3501e_otp — chip cc3501e, flash_method TBD, firmware_path TBD, flash_args "TBD"/,
  );
  // And the irreversibility, in words, on the dialog.
  assert.match(text, /OVERWRITES the target's non-volatile memory/);
  assert.match(text, /cannot be undone/);
  assert.match(text, /Nothing is written unless you continue\./);
});

test("no identifier is abbreviated, rounded or elided in the dialog", () => {
  const text = describeFlashConsent(planFlashConsent(MANIFEST), CONTEXT);
  // The data-fidelity rule, asserted as an absence: an ellipsis or a "+N more"
  // on this screen is how the wrong module gets flashed.
  assert.doesNotMatch(text, /\.\.\.|…|\bmore\b/);
  for (const id of [
    "a32_cluster",
    "m55_hp",
    "m55_he",
    "cc3501e_otp",
    "E1M-AEN801",
  ]) {
    assert.ok(text.includes(id), `${id} is missing from the dialog`);
  }
});

test("a scoped dialog states that the rest of the board keeps what is on it", () => {
  const plan = planFlashConsent(MANIFEST, {
    coreId: "m55_hp",
    helperName: null,
  });
  const text = describeFlashConsent(plan, CONTEXT);
  assert.match(text, /Scope: --core m55_hp/);
  assert.match(text, /skips every other slice AND all helper MCUs/);
  assert.match(text, /keep whatever is on them now/);
  assert.match(text, /Skipped, NOT written \(3\):/);
  // The skipped entries keep their full detail — a bare id would not let the
  // reader tell which physical part is being left alone.
  assert.match(text, /helper cc3501e_otp — chip cc3501e/);
});

test("the question names the board, and the core when the run is scoped", () => {
  assert.equal(
    flashConsentMessage(planFlashConsent(MANIFEST)),
    "Alp: flash E1M-AEN801? This writes to the device.",
  );
  assert.equal(
    flashConsentMessage(
      planFlashConsent(MANIFEST, { coreId: "m55_he", helperName: null }),
    ),
    "Alp: flash core m55_he on E1M-AEN801? This writes to the device.",
  );
});

// `NotificationPlan.message` must carry no absolute path — the presenter's
// contract, and the reason the paths live in `modalDetail` (which planConfirm
// keeps ON the dialog) instead.
test("the question carries no absolute path", () => {
  const message = flashConsentMessage(
    planFlashConsent(MANIFEST, { coreId: "m55_hp", helperName: null }),
  );
  assert.doesNotMatch(message, /(?:^|[\s"'(])\/(?:home|Users|usr|var|tmp)\//);
});

// ---------------------------------------------------------------------------
// The argv reader
// ---------------------------------------------------------------------------

test("isFlashArgv recognises the command and nothing else", () => {
  assert.equal(isFlashArgv(["flash"]), true);
  assert.equal(isFlashArgv(["flash", "--core", "m55_hp"]), true);
  assert.equal(isFlashArgv(["build"]), false);
  assert.equal(isFlashArgv(["image", "app"]), false);
  assert.equal(isFlashArgv([]), false);
});

test("--core swallows its value instead of leaving it as APP_PATH", () => {
  const argv = readFlashArgv(["flash", "--core", "m55_hp"]);
  assert.equal(argv.coreId, "m55_hp");
  // The whole point of the arity table: `m55_hp` is NOT the app path, and
  // reading it as one would point the manifest lookup at a directory that
  // does not exist.
  assert.equal(argv.appPath, null);
});

test("the APP_PATH positional is read, because it moves the manifest", () => {
  const argv = readFlashArgv(["flash", "examples/multicore/rpmsg-v2n"]);
  assert.equal(argv.appPath, "examples/multicore/rpmsg-v2n");
  assert.equal(argv.coreId, null);
});

test("--flag=value, --build-root, --dry-run, --recover and --confirm all read", () => {
  const argv = readFlashArgv([
    "flash",
    "--core=m55_he",
    "--build-root",
    "out/build",
    "--dry-run",
    "--recover",
    "--confirm",
  ]);
  assert.equal(argv.coreId, "m55_he");
  assert.equal(argv.buildRoot, "out/build");
  assert.equal(argv.isDryRun, true);
  assert.equal(argv.isRecovery, true);
  assert.equal(argv.isArmed, true);
});

test("armFlashArgv inserts --confirm after the command and never mutates", () => {
  const original = ["flash", "--core", "m55_hp"];
  const armed = armFlashArgv(original);
  // Directly after the command — the one position no parser can read as the
  // value of something else, or as a positional.
  assert.deepEqual(armed, ["flash", "--confirm", "--core", "m55_hp"]);
  assert.deepEqual(original, ["flash", "--core", "m55_hp"], "input untouched");
});

test("armFlashArgv never doubles an already-armed argv", () => {
  assert.deepEqual(armFlashArgv(["flash", "--confirm"]), [
    "flash",
    "--confirm",
  ]);
});

// ---------------------------------------------------------------------------
// The arity tables, re-derived from the vendored surface in BOTH directions
// ---------------------------------------------------------------------------
//
// The two `Set`s in `argv.ts` are a HAND COPY of the pinned CLI's option
// arities, and a hand copy with no gate is a stale copy waiting to happen. A
// re-pin to 0.6.0 at GA is already planned, and this repo's own lesson from
// #522/#523 is that "#520 changed the pin under the feature and nothing
// re-probed the CLI surface". A drifted arity does not fail loudly: it
// mis-reads `APP_PATH` or `--core`, and the dialog then names one thing while
// the spawn writes another.
//
// BOTH DIRECTIONS, because each catches a different drift. Surface → table
// catches a NEW value-taking option (its value would be read as APP_PATH and
// point the manifest lookup at a directory that does not exist, or worse at
// one that does). Table → surface catches an option that was REMOVED or turned
// boolean (its successor token would be swallowed and the real APP_PATH lost).

const sortedSet = (set) => [...set].sort();

test("FLASH_VALUE_TAKING_FLAGS is exactly `tan flash`'s metavar'd options", () => {
  const flash = SURFACE.commands.flash;
  assert.ok(flash, "the vendored surface records no `tan flash` command");
  const withValue = Object.entries(flash.options)
    .filter(([, option]) => option.metavar !== null)
    .map(([name]) => name)
    .sort();
  const booleans = Object.entries(flash.options)
    .filter(([, option]) => option.metavar === null)
    .map(([name]) => name)
    .sort();

  assert.deepEqual(
    sortedSet(FLASH_VALUE_TAKING_FLAGS),
    withValue,
    `packages/alp-core/src/flash/argv.ts's FLASH_VALUE_TAKING_FLAGS no longer ` +
      `matches \`tan flash\` at the ${SURFACE.version} pin. A flag this set ` +
      "gets wrong is read with the wrong arity: a missing one leaves its " +
      "VALUE to be read as APP_PATH (the consent screen then describes a " +
      "different project's manifest than the one tan writes), and a stale " +
      "one swallows the real APP_PATH. Re-derive it from " +
      "test/golden/tan-surface/surface.json, do not hand-edit one entry.",
  );
  // The other direction stated as data too, so a boolean that quietly gained a
  // metavar cannot pass by being absent from both lists.
  for (const name of booleans) {
    assert.equal(
      FLASH_VALUE_TAKING_FLAGS.has(name),
      false,
      `${name} is a boolean on \`tan flash\` at the ${SURFACE.version} pin, ` +
        "but the table makes it swallow the next token — which is the real " +
        "APP_PATH or the real --core value.",
    );
  }
  assert.equal(withValue.length, 8);
  assert.equal(booleans.length, 5);
});

test("ROOT_VALUE_TAKING_FLAGS is exactly the metavar'd global options", () => {
  // `globalOptions` is a bare name list with no arity of its own, so the arity
  // comes from the union of the per-command declarations — the same two-layer
  // rule `scripts/tan-surface/extract.mjs` documents and uses.
  const takesValueSomewhere = new Set();
  for (const spec of Object.values(SURFACE.commands)) {
    for (const [name, option] of Object.entries(spec.options ?? {})) {
      if (option.metavar !== null) takesValueSomewhere.add(name);
    }
  }
  const globalsWithValue = SURFACE.globalOptions
    .filter((name) => takesValueSomewhere.has(name))
    .sort();

  assert.deepEqual(
    sortedSet(ROOT_VALUE_TAKING_FLAGS),
    globalsWithValue,
    "packages/alp-core/src/flash/argv.ts's ROOT_VALUE_TAKING_FLAGS no longer " +
      `matches tan ${SURFACE.version}'s global options. This table is how ` +
      '`isFlashArgv` finds the command in `["--project", dir, "flash"]`; ' +
      "get it wrong and a flash is either not recognised at all (no dialog, " +
      "and an ALP_FLASH_FORCE=1 environment writes silicon) or a plain " +
      "command is mistaken for one.",
  );
  // Every entry must be a global: a flag that is not accepted at root position
  // has no business being skipped there.
  for (const name of ROOT_VALUE_TAKING_FLAGS) {
    assert.ok(
      SURFACE.globalOptions.includes(name),
      `${name} is not a global option of tan ${SURFACE.version}, so it can ` +
        "never appear before the command; skipping it there would consume a " +
        "token tan never consumes.",
    );
  }
});

// ---------------------------------------------------------------------------
// Finding the command when it is NOT argv[0]
// ---------------------------------------------------------------------------
//
// `src/west.ts` already builds `["--project", <dir>, "build"]` for Build, and
// `withSdkRoot` prepends `["--sdk-root", <path>, …]` to everything the runner
// spawns. Reading the command as argv[0] made a `--project`-prefixed flash
// invisible to the gate: no dialog, and with ALP_FLASH_FORCE=1 inherited from
// the login profile, a write with nothing on screen.

test("a flash behind root-position flags is still a flash", () => {
  assert.equal(isFlashArgv(["--project", "/tmp/proj", "flash"]), true);
  assert.equal(
    isFlashArgv(["--sdk-root", "/opt/sdk", "flash", "--core", "x"]),
    true,
  );
  assert.equal(isFlashArgv(["--verbose", "flash"]), true, "boolean global");
  assert.equal(isFlashArgv(["--format=json", "flash"]), true, "inline value");
  assert.equal(isFlashArgv(["--project=/tmp/p", "flash"]), true);
});

test("a root flag's VALUE is never mistaken for the command", () => {
  // `flash` here is `--project`'s value, not the command: tan runs `build`.
  assert.equal(isFlashArgv(["--project", "flash", "build"]), false);
  assert.equal(isFlashArgv(["--sdk-root", "/opt/sdk", "build"]), false);
  assert.equal(isFlashArgv([]), false);
  assert.equal(isFlashArgv(["--verbose"]), false, "no command at all");
});

test("armFlashArgv arms after the command wherever the command sits", () => {
  assert.deepEqual(armFlashArgv(["--sdk-root", "/opt/sdk", "flash"]), [
    "--sdk-root",
    "/opt/sdk",
    "flash",
    "--confirm",
  ]);
});

// ---------------------------------------------------------------------------
// Argv tan would refuse at parse
// ---------------------------------------------------------------------------

test("a value-taking flag with nothing after it is reported dangling", () => {
  assert.deepEqual(readFlashArgv(["flash", "--core"]).danglingFlags, [
    "--core",
  ]);
  assert.deepEqual(readFlashArgv(["flash", "--build-root"]).danglingFlags, [
    "--build-root",
  ]);
  // An attached value is a value: nothing dangles.
  assert.deepEqual(readFlashArgv(["flash", "--core=m55_hp"]).danglingFlags, []);
  assert.deepEqual(readFlashArgv(["flash", "--dry-run"]).danglingFlags, []);
});

test("a second positional is reported, because tan takes at most one", () => {
  const argv = readFlashArgv(["flash", "app", "stray"]);
  assert.equal(argv.appPath, "app");
  assert.deepEqual(argv.extraPositionals, ["stray"]);
  assert.equal(SURFACE.commands.flash.maxPositionals, 1);
});

test("--project is reported in either position, never silently dropped", () => {
  assert.equal(
    readFlashArgv(["flash", "--project", "/tmp/p"]).hasProjectFlag,
    true,
  );
  assert.equal(
    readFlashArgv(["--project", "/tmp/p", "flash"]).hasProjectFlag,
    true,
  );
  assert.equal(
    readFlashArgv(["flash", "--project=/tmp/p"]).hasProjectFlag,
    true,
  );
  assert.equal(readFlashArgv(["flash"]).hasProjectFlag, false);
});

// `--dry-run`, `--confirm` and `--recover` are NOT global options: tan exits 2
// on a root-position one. Honouring a root-position `--dry-run` would let an
// argv tan rejects outright talk its way past the consent gate.
test("--dry-run is only read AFTER the command, never before it", () => {
  assert.equal(readFlashArgv(["flash", "--dry-run"]).isDryRun, true);
  assert.equal(readFlashArgv(["--dry-run", "flash"]).isDryRun, false);
  assert.equal(readFlashArgv(["--confirm", "flash"]).isArmed, false);
  assert.equal(readFlashArgv(["--recover", "flash"]).isRecovery, false);
});
