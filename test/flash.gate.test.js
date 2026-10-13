// SPDX-License-Identifier: Apache-2.0
//
// The behaviour of the flash consent gate (#540): what the customer sees
// before the first byte is written, what happens when they say no, and the
// EXACT argv that comes out the other side.
//
// Drives the real `out/flash/gate.js` against a real manifest on disk, with
// only the presenter (`../notify/vscodeAdapter`) and `../util` stubbed — the
// same technique `extension.buildResultAction.test.js` uses. The notification
// PLANNER (`../notify/service`) is left real, so the dialog these tests read
// is the dialog `planConfirm` actually produces.
//
// The gate asks tan for a `--dry-run --format json` preview through an injected
// `runTan`. Here that runner answers with REAL tan 0.7.0 captures
// (test/fixtures/tan-flash/PROVENANCE.md), chosen by what the gate asked for,
// and records every argv it was handed.
//
// The assertion that matters most is negative: on a refusal or a cancel,
// `gateFlashDispatch` returns null and NOTHING is spawned. Everything else on
// this screen is text.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const FIXTURE = fs.readFileSync(
  path.join(__dirname, "fixtures", "system-manifest.aen801.yaml"),
  "utf-8",
);
const capture = (name) =>
  fs.readFileSync(
    path.join(
      __dirname,
      "fixtures",
      "tan-flash",
      `tan-flash.v0.7.0.${name}.json`,
    ),
    "utf8",
  );

/** A throwaway project directory holding `build/system-manifest.yaml`. */
function projectWithManifest(text = FIXTURE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-flash-gate-"));
  fs.mkdirSync(path.join(dir, "build"), { recursive: true });
  fs.writeFileSync(path.join(dir, "build", "system-manifest.yaml"), text);
  return dir;
}

/**
 * Load the gate with a scripted answer to the confirm modals.
 *
 * `answer` is what the presenter returns from `notify()` — the ActionId the
 * user picked, or `undefined` for a dismissed dialog. A string answers BOTH
 * modals with the id the plan asks for; a function sees the plan. Every plan
 * handed to either presenter entry point is captured.
 */
function loadGate(answer) {
  const plans = [];
  const logs = [];
  const modPath = require.resolve(path.join(root, "out", "flash", "gate.js"));
  delete require.cache[modPath];
  const stubs = {
    "../notify/vscodeAdapter": {
      notify: async (plan) => {
        plans.push(plan);
        return typeof answer === "function" ? answer(plan) : answer;
      },
      notifyAsync: (plan) => {
        plans.push(plan);
      },
    },
    "../util": { log: (line) => logs.push(line) },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  let mod;
  try {
    mod = require(modPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
  return { mod, plans, logs };
}

/** Accept whatever each modal offers: "flashDevice", then "replaceBootTable". */
const acceptAll = (plan) =>
  plan.channel === "modal" ? plan.actions[0].id : undefined;

/**
 * A `runTan` that answers with captures. `pick(args)` returns the capture name
 * for the argv the gate handed it, or null for "tan could not be run".
 */
function fakeTan(pick) {
  const calls = [];
  return {
    calls,
    deps: {
      runTan: async (args) => {
        calls.push([...args]);
        const name = pick(args);
        return name === null ? null : capture(name);
      },
    },
  };
}

/** The AEN project: every slice is Flow D after tan's own routing. */
const flowD = () =>
  fakeTan((args) =>
    args.includes("--core") ? "dry-run.flow-d.core-left-out" : "dry-run.flow-d",
  );

const confirmPlans = (plans) => plans.filter((p) => p.channel === "modal");
const lastMessage = (plans) => plans.at(-1).message;

// ---------------------------------------------------------------------------
// What the user sees BEFORE anything is written
// ---------------------------------------------------------------------------

test("a flash asks first, on a blocking modal that carries the whole target list", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate("flashDevice");
  await mod.gateFlashDispatch(["flash"], dir, flowD().deps);

  const plan = confirmPlans(plans)[0];
  assert.ok(plan, "no modal was raised — the write would be unconsented");
  assert.equal(plan.channel, "modal");
  assert.equal(plan.severity, "warning");
  assert.equal(
    plan.message,
    "Alp: flash E1M-AEN801? This writes to the device.",
  );
  // planConfirm's contract: the consequence text stays ON the dialog, in
  // `modalDetail`, never routed into the channel-only `detail`.
  assert.ok(plan.modalDetail, "the consequence text is not on the dialog");
  assert.equal(plan.detail, undefined);
  assert.deepEqual(plan.actions, [{ id: "flashDevice" }]);
  assert.ok(plan.modalDetail.includes(dir), "the project directory is missing");
  for (const id of ["a32_cluster", "m55_hp", "m55_he", "cc3501e_otp"]) {
    assert.ok(
      plan.modalDetail.includes(id),
      `${id} is missing from the dialog`,
    );
  }
  assert.match(plan.modalDetail, /cannot be undone/);
});

test("the first modal names the backend tan RESOLVED, not only the one the manifest declares", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate("flashDevice");
  await mod.gateFlashDispatch(["flash"], dir, flowD().deps);
  const detail = confirmPlans(plans)[0].modalDetail;
  assert.match(
    detail,
    /m55_he — tan resolves alif_mram_jlink \(the manifest declares zephyr_west_flash\): written/,
  );
  assert.match(detail, /SETOOLS that signs the boot table:/);
  assert.match(detail, /second time/);
});

// ---------------------------------------------------------------------------
// The argv — the actual defect in #540
// ---------------------------------------------------------------------------

test("an accepted AEN flash is armed: --confirm AND --atoc-unqueryable, read back as JSON", async () => {
  // The defect: this used to go out as a bare `["flash"]`, which on AEN is
  // Flow D with `planning_only = not confirm` — a button that wrote nothing.
  const dir = projectWithManifest();
  const { mod } = loadGate(acceptAll);
  const out = await mod.gateFlashDispatch(["flash"], dir, flowD().deps);
  assert.deepEqual(out, {
    argv: ["flash", "--format", "json", "--atoc-unqueryable", "--confirm"],
    readEnvelope: true,
  });
});

test("the boot-table replacement is a SECOND, separate modal; declining it spawns nothing", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate((plan) =>
    plan.channel !== "modal"
      ? undefined
      : plan.actions[0].id === "flashDevice"
        ? "flashDevice"
        : undefined,
  );
  assert.equal(
    await mod.gateFlashDispatch(["flash"], dir, flowD().deps),
    null,
    "the first accept must not imply the second",
  );
  const modals = confirmPlans(plans);
  assert.equal(modals.length, 2);
  const [first, second] = modals;
  assert.deepEqual(first.actions, [{ id: "flashDevice" }]);
  assert.deepEqual(second.actions, [{ id: "replaceBootTable" }]);
  assert.equal(second.channel, "modal");
  assert.equal(second.detail, undefined);
  assert.equal(second.message, "Alp: replace the boot table on E1M-AEN801?");
  // tan's own replacement text, verbatim.
  assert.match(
    second.modalDetail,
    /NOTE: a real write REPLACES the ENTIRE ATOC/,
  );
  assert.match(second.modalDetail, /This ATOC names: DEVICE, m55_he, m55_hp\./);
  assert.match(second.modalDetail, /\[SES\] ATOC ok/);
  assert.match(
    second.modalDetail,
    /every entry not named above will be delisted/,
  );
  assert.match(
    second.modalDetail,
    /SETOOLS that signs the boot table: \/home\/dev\/setools/,
  );
  assert.match(lastMessage(plans), /cancelled/);
  assert.match(lastMessage(plans), /nothing was written/i);
});

test("declining the FIRST modal never raises the second", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate(undefined);
  assert.equal(await mod.gateFlashDispatch(["flash"], dir, flowD().deps), null);
  assert.equal(confirmPlans(plans).length, 1);
});

test("there is no 'don't ask again': the second modal offers one action and Cancel", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate(acceptAll);
  await mod.gateFlashDispatch(["flash"], dir, flowD().deps);
  for (const modal of confirmPlans(plans)) {
    assert.equal(modal.actions.length, 1);
    assert.doesNotMatch(JSON.stringify(modal), /again|always|remember/i);
  }
});

test("a scope that tan writes unasked is NOT armed, and still asks once", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate(acceptAll);
  const out = await mod.gateFlashDispatch(
    ["flash"],
    dir,
    fakeTan(() => "dry-run.zephyr-west-flash").deps,
  );
  // Text mode: nothing is armed, so there is no envelope verdict to wait for
  // and the tool's live output (west, cmake) keeps streaming to the log.
  assert.deepEqual(out, { argv: ["flash"], readEnvelope: false });
  assert.equal(confirmPlans(plans).length, 1);
  assert.equal(out.argv.includes("--confirm"), false);
  assert.equal(out.argv.includes("--atoc-unqueryable"), false);
});

test("Flow D beside yocto REFUSES: nothing is asked and nothing is armed", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate(acceptAll);
  const out = await mod.gateFlashDispatch(
    ["flash"],
    dir,
    fakeTan(() => "dry-run.mixed-yocto-flow-d").deps,
  );
  assert.equal(out, null);
  assert.equal(confirmPlans(plans).length, 0);
  assert.match(lastMessage(plans), /nothing was written/);
  assert.match(lastMessage(plans), /a32_cluster/);
  assert.equal(plans.at(-1).severity, "warning");
});

test("a yocto-only or xspi scope is refused, never armed", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate(acceptAll);
  assert.equal(
    await mod.gateFlashDispatch(
      ["flash"],
      dir,
      fakeTan(() => "dry-run.xspi-flashwriter").deps,
    ),
    null,
  );
  assert.equal(confirmPlans(plans).length, 0);
  assert.match(lastMessage(plans), /only be previewed/);
});

test("an accepted per-slice flash is refused when it would delist a Flow D sibling", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate(acceptAll);
  const tan = flowD();
  assert.equal(
    await mod.gateFlashDispatch(["flash", "--core", "m55_hp"], dir, tan.deps),
    null,
  );
  assert.match(lastMessage(plans), /m55_he/);
  assert.match(lastMessage(plans), /whole-board Flash/i);
  assert.equal(confirmPlans(plans).length, 0);
  // It asked tan twice: the scoped preview, then the whole board.
  assert.equal(tan.calls.length, 2);
  assert.ok(tan.calls[0].includes("--core"));
  assert.equal(tan.calls[1].includes("--core"), false);
  for (const call of tan.calls) {
    assert.ok(
      call.includes("--dry-run") && call.includes("json"),
      call.join(" "),
    );
    assert.equal(call.includes("--confirm"), false);
  }
});

test("the preview is asked for with --dry-run --format json and never --confirm", async () => {
  const dir = projectWithManifest();
  const { mod } = loadGate(acceptAll);
  const tan = flowD();
  await mod.gateFlashDispatch(
    ["--sdk-root", "/opt/sdk", "flash"],
    dir,
    tan.deps,
  );
  assert.deepEqual(tan.calls[0], [
    "--sdk-root",
    "/opt/sdk",
    "flash",
    "--dry-run",
    "--format",
    "json",
  ]);
});

test("SETOOLS_DIR from the host environment is forwarded as --setools-dir, to the preview and the write", async () => {
  const dir = projectWithManifest();
  const { mod } = loadGate(acceptAll);
  const tan = flowD();
  const saved = process.env.SETOOLS_DIR;
  process.env.SETOOLS_DIR = "/opt/alif/setools";
  try {
    const out = await mod.gateFlashDispatch(["flash"], dir, tan.deps);
    assert.deepEqual(tan.calls[0].slice(0, 3), [
      "flash",
      "--dry-run",
      "--format",
    ]);
    assert.ok(
      tan.calls[0].join(" ").includes("--setools-dir /opt/alif/setools"),
    );
    assert.ok(out.argv.join(" ").includes("--setools-dir /opt/alif/setools"));
  } finally {
    if (saved === undefined) delete process.env.SETOOLS_DIR;
    else process.env.SETOOLS_DIR = saved;
  }
});

test("no SETOOLS anywhere: tan's preview refuses, and the customer is told how to name one", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate(acceptAll);
  const saved = process.env.SETOOLS_DIR;
  delete process.env.SETOOLS_DIR;
  try {
    assert.equal(
      await mod.gateFlashDispatch(
        ["flash"],
        dir,
        fakeTan(() => "dry-run.flow-d.no-setools").deps,
      ),
      null,
    );
  } finally {
    if (saved !== undefined) process.env.SETOOLS_DIR = saved;
  }
  assert.equal(confirmPlans(plans).length, 0);
  const refusal = plans.at(-1);
  assert.match(refusal.message, /nothing was written/);
  assert.match(refusal.detail, /SETOOLS_DIR=<path>/);
  assert.deepEqual(refusal.actions, [{ id: "showOutput" }]);
});

test("a SETOOLS only the manifest names is refused up front", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate(acceptAll);
  assert.equal(
    await mod.gateFlashDispatch(
      ["flash"],
      dir,
      fakeTan(() => "dry-run.flow-d.manifest-only-setools").deps,
    ),
    null,
  );
  assert.match(lastMessage(plans), /SETOOLS_DIR/);
  assert.equal(confirmPlans(plans).length, 0);
});

test("no preview runner, or a preview tan could not produce: refused, not flashed blind", async () => {
  const dir = projectWithManifest();
  for (const deps of [undefined, fakeTan(() => null).deps]) {
    const { mod, plans } = loadGate(acceptAll);
    assert.equal(await mod.gateFlashDispatch(["flash"], dir, deps), null);
    assert.equal(confirmPlans(plans).length, 0);
    assert.match(lastMessage(plans), /nothing was written/);
  }
  const { mod, plans } = loadGate(acceptAll);
  assert.equal(
    await mod.gateFlashDispatch(["flash"], dir, {
      runTan: async () => "not json",
    }),
    null,
  );
  assert.match(lastMessage(plans), /no preview/);
});

test("a call site that already wrote --confirm or --atoc-unqueryable is refused", async () => {
  const dir = projectWithManifest();
  for (const flag of ["--confirm", "--atoc-unqueryable"]) {
    const { mod, plans } = loadGate(acceptAll);
    const tan = flowD();
    assert.equal(
      await mod.gateFlashDispatch(["flash", flag], dir, tan.deps),
      null,
    );
    assert.match(lastMessage(plans), /Alp adds those itself/);
    assert.equal(tan.calls.length, 0, "nothing may be previewed or spawned");
  }
});

test("an accepted flash with an APP_PATH keeps the positional", async () => {
  const dir = projectWithManifest();
  const app = "app";
  fs.mkdirSync(path.join(dir, app, "build"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, app, "build", "system-manifest.yaml"),
    FIXTURE,
  );
  const { mod } = loadGate(acceptAll);
  const out = await mod.gateFlashDispatch(["flash", app], dir, flowD().deps);
  assert.deepEqual(out.argv, [
    "flash",
    "--format",
    "json",
    "--atoc-unqueryable",
    "--confirm",
    app,
  ]);
});

// `tan flash --help`: `build_root` defaults to <APP_PATH>/build. Reading the
// ROOT manifest for an APP_PATH run would consent against a different
// project's slice list than the one being written.
test("the manifest is read from <APP_PATH>/build, not from the cwd", async () => {
  const dir = projectWithManifest();
  fs.mkdirSync(path.join(dir, "app", "build"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "app", "build", "system-manifest.yaml"),
    FIXTURE.replace("E1M-AEN801", "E1M-AEN701"),
  );
  const { mod, plans } = loadGate("flashDevice");
  await mod.gateFlashDispatch(["flash", "app"], dir, flowD().deps);
  assert.match(confirmPlans(plans)[0].message, /E1M-AEN701/);
  assert.equal(
    mod.flashManifestPath(["flash", "app"], dir),
    path.join(dir, "app", "build", "system-manifest.yaml"),
  );
  assert.equal(
    mod.flashManifestPath(["flash", "--build-root", "out"], dir),
    path.join(dir, "out", "system-manifest.yaml"),
  );
});

test("a non-flash argv is returned untouched and raises no dialog", async () => {
  const { mod, plans } = loadGate("flashDevice");
  for (const args of [["build"], ["image", "app"], ["clean"], ["renode"]]) {
    assert.deepEqual(await mod.gateFlashDispatch(args, "/tmp/whatever"), {
      argv: args,
      readEnvelope: false,
    });
  }
  assert.deepEqual(plans, [], "a build must not ask about writing a device");
});

// ---------------------------------------------------------------------------
// Cancel: "cancelled", never "failed", and nothing spawned
// ---------------------------------------------------------------------------

test("a cancelled flash spawns nothing and never says failed", async () => {
  const dir = projectWithManifest();
  for (const answer of [undefined, "showOutput"]) {
    const { mod, plans } = loadGate(answer);
    assert.equal(
      await mod.gateFlashDispatch(["flash"], dir, flowD().deps),
      null,
      "a declined dialog must return null so the caller spawns nothing",
    );
    const last = plans.at(-1);
    assert.match(last.message, /cancelled/);
    assert.equal(last.severity, "info");
    assert.doesNotMatch(last.message, /fail/i);
    assert.match(last.message, /nothing was written/i);
  }
});

// ---------------------------------------------------------------------------
// Refuse rather than flash blind
// ---------------------------------------------------------------------------

test("no manifest: refused by name, and NOT sent as a bare flash", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-flash-empty-"));
  const { mod, plans } = loadGate("flashDevice");
  assert.equal(await mod.gateFlashDispatch(["flash"], dir), null);
  const plan = plans.at(-1);
  assert.equal(plan.severity, "warning");
  assert.match(plan.message, /system-manifest\.yaml/);
  assert.match(plan.message, /Build the project first/);
  assert.match(plan.message, /nothing was written/);
  // The absolute path is channel-only detail, never the toast sentence.
  assert.ok(plan.detail.includes(dir));
  assert.doesNotMatch(plan.message, /fail/i);
});

test("an unparseable manifest is refused, not flashed", async () => {
  const dir = projectWithManifest("schema_version: 99\nslices: []\n");
  const { mod, plans } = loadGate("flashDevice");
  assert.equal(await mod.gateFlashDispatch(["flash"], dir), null);
  assert.match(plans.at(-1).message, /could not be read/);
  assert.match(plans.at(-1).detail, /schema_version/);
});

test("no cwd: refused, because nothing can say which project would be written", async () => {
  const { mod, plans } = loadGate("flashDevice");
  assert.equal(await mod.gateFlashDispatch(["flash"], undefined), null);
  assert.match(plans.at(-1).message, /which project would be flashed/);
});

test("a scope that matches nothing is refused instead of consented to", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate("flashDevice");
  assert.equal(
    await mod.gateFlashDispatch(["flash", "--core", "m55_hp_typo"], dir),
    null,
  );
  assert.match(plans.at(-1).message, /Nothing in this project's manifest/);
  assert.match(plans.at(-1).message, /no slice with core_id m55_hp_typo/);
  assert.equal(
    plans.filter((p) => p.channel === "modal").length,
    0,
    "consent to nothing is not consent",
  );
});

// ---------------------------------------------------------------------------
// The two flags that must never be armed from a button
// ---------------------------------------------------------------------------

test("--recover is refused outright, never armed", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate("flashDevice");
  assert.equal(
    await mod.gateFlashDispatch(
      ["flash", "--recover", "--helper", "cc3501e_otp"],
      dir,
    ),
    null,
  );
  assert.match(plans.at(-1).message, /does not run recovery flashes/);
  assert.equal(plans.filter((p) => p.channel === "modal").length, 0);
});

// FINDING 4 (#540 review): `--project` is a real `tan flash` option AND a
// global one, and `flashManifestPath` derives the manifest from APP_PATH. The
// one MEASURED sentence this repo vendors about where the device commands look
// says `<project>/build/system-manifest.yaml`. Nothing settles which anchor
// wins, so the dialog could truthfully describe `cwd`'s manifest while tan
// programmed another project's. Refused, like `--recover`, rather than ignored.
test("--project is refused, not quietly discarded", async () => {
  const dir = projectWithManifest();
  for (const args of [
    ["flash", "--project", dir],
    ["--project", dir, "flash"],
    ["flash", "--project=" + dir],
  ]) {
    const { mod, plans } = loadGate("flashDevice");
    assert.equal(await mod.gateFlashDispatch(args, dir), null);
    assert.match(plans.at(-1).message, /does not run a flash with --project/);
    assert.match(plans.at(-1).message, /nothing was written/);
    assert.doesNotMatch(plans.at(-1).message, /fail/i);
    assert.equal(
      plans.filter((p) => p.channel === "modal").length,
      0,
      "a --project flash must never reach the consent screen",
    );
  }
});

// FINDING 1: the command is not always argv[0]. `withSdkRoot` prepends
// `["--sdk-root", <path>, …]` to every streamed spawn, and `alpBuild` already
// builds `["--project", <dir>, "build"]` forty lines above `alpFlash`. A gate
// that reads argv[0] lets that shape through unconsented.
test("a flash behind root-position flags is gated like any other", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate(acceptAll);
  const out = await mod.gateFlashDispatch(
    ["--sdk-root", "/opt/sdk", "flash"],
    dir,
    flowD().deps,
  );
  assert.deepEqual(out.argv, [
    "--sdk-root",
    "/opt/sdk",
    "flash",
    "--format",
    "json",
    "--atoc-unqueryable",
    "--confirm",
  ]);
  assert.ok(
    confirmPlans(plans).length > 0,
    "no dialog was raised for a prefixed flash",
  );
});

// FINDING 7: tan parses before it acts. Both of these exit 2 without touching
// the device, so a dialog over them collects consent for a run that can never
// happen — and the non-zero exit then renders as "did not complete … read the
// log before re-flashing", a partial-write warning about a run that never ran.
test("a value-taking flag with no value is refused, not asked about", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate("flashDevice");
  assert.equal(await mod.gateFlashDispatch(["flash", "--core"], dir), null);
  assert.match(plans.at(-1).message, /--core needs a value/);
  assert.match(plans.at(-1).message, /before touching the device/);
  assert.equal(plans.filter((p) => p.channel === "modal").length, 0);
});

test("a second positional is refused: tan flash takes exactly one", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate("flashDevice");
  assert.equal(
    await mod.gateFlashDispatch(["flash", "app", "stray"], dir),
    null,
  );
  assert.match(plans.at(-1).message, /takes one application path/);
  assert.match(plans.at(-1).message, /stray/);
  assert.equal(plans.filter((p) => p.channel === "modal").length, 0);
});

// The drifted-arity backstop. If a future pin adds a root option this build
// does not know, its value shifts the command slot and the flash stops being
// recognised. Refusing anything that says `flash` but does not resolve to it
// turns that from a silent unconsented spawn into a message.
test("an argv that mentions flash but does not resolve to it is refused", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate("flashDevice");
  // Here `flash` is `--project`'s VALUE, not the command: tan runs `build`.
  // A drifted arity produces the same shape from the other direction — a root
  // option this build reads with the wrong arity shifts the command slot — and
  // the gate cannot tell the two apart, so it refuses both.
  assert.equal(
    await mod.gateFlashDispatch(["--project", "flash", "build"], dir),
    null,
  );
  assert.match(plans.at(-1).message, /could not tell which tan command/);
  assert.equal(plans.filter((p) => p.channel === "modal").length, 0);
});

// FINDING 6: consent is a snapshot. The modal can sit open indefinitely, tan
// re-reads the file at spawn, and the run-name reservation only blocks a
// second dispatch under the same name — an external `tan build` or a second
// window can rewrite `build/` in between.
test("a manifest rewritten while the FIRST dialog is open is refused, not armed", async () => {
  const dir = projectWithManifest();
  const manifest = path.join(dir, "build", "system-manifest.yaml");
  const { mod, plans } = loadGate(() => {
    // The rewrite happens WHILE the modal is up, which is the whole point.
    fs.writeFileSync(manifest, FIXTURE.replace("E1M-AEN801", "E1M-AEN701"));
    return "flashDevice";
  });
  assert.equal(
    await mod.gateFlashDispatch(["flash"], dir, flowD().deps),
    null,
    "an accepted dialog over stale contents must not arm the write",
  );
  assert.match(lastMessage(plans), /changed while the confirmation was open/);
  assert.match(lastMessage(plans), /nothing was written/);
  assert.doesNotMatch(lastMessage(plans), /fail/i);
  assert.equal(confirmPlans(plans).length, 1, "the second modal must not open");
});

test("a manifest rewritten while the SECOND dialog is open is refused too", async () => {
  const dir = projectWithManifest();
  const manifest = path.join(dir, "build", "system-manifest.yaml");
  const { mod, plans } = loadGate((plan) => {
    if (plan.channel !== "modal") return undefined;
    if (plan.actions[0].id === "replaceBootTable") {
      fs.writeFileSync(manifest, FIXTURE.replace("E1M-AEN801", "E1M-AEN701"));
    }
    return plan.actions[0].id;
  });
  assert.equal(
    await mod.gateFlashDispatch(["flash"], dir, flowD().deps),
    null,
    "the final accept must re-verify the manifest",
  );
  assert.match(lastMessage(plans), /changed while the confirmation was open/);
});

test("a manifest DELETED while the dialog is open is refused too", async () => {
  const dir = projectWithManifest();
  const manifest = path.join(dir, "build", "system-manifest.yaml");
  const { mod, plans } = loadGate(() => {
    fs.rmSync(manifest);
    return "flashDevice";
  });
  assert.equal(await mod.gateFlashDispatch(["flash"], dir, flowD().deps), null);
  assert.match(lastMessage(plans), /disappeared while the confirmation/);
});

test("an unchanged manifest still passes — the re-check is not a blanket refusal", async () => {
  const dir = projectWithManifest();
  const manifest = path.join(dir, "build", "system-manifest.yaml");
  const { mod } = loadGate((plan) => {
    // Byte-identical rewrite: same content, new mtime. The check is on the
    // BYTES, so this is not a change and must not refuse.
    fs.writeFileSync(manifest, FIXTURE);
    return plan.actions[0].id;
  });
  const out = await mod.gateFlashDispatch(["flash"], dir, flowD().deps);
  assert.equal(out.readEnvelope, true);
});

test("--confirm is added only after BOTH modals, and only for the Flow D class", async () => {
  const dir = projectWithManifest();
  const seen = [];
  const { mod } = loadGate((plan) => {
    seen.push(plan.actions[0].id);
    return plan.actions[0].id;
  });
  const out = await mod.gateFlashDispatch(["flash"], dir, flowD().deps);
  assert.deepEqual(seen, ["flashDevice", "replaceBootTable"]);
  assert.ok(out.argv.includes("--confirm"));
});

test("--dry-run writes nothing, so it is neither gated nor armed", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate("flashDevice");
  assert.deepEqual(await mod.gateFlashDispatch(["flash", "--dry-run"], dir), {
    argv: ["flash", "--dry-run"],
    readEnvelope: false,
  });
  assert.deepEqual(plans, []);
});

// `ALP_FLASH_FORCE=1`, `flash_args.confirm: true` and
// `flash_args.atoc_unqueryable: true` are the other ways to arm tan. All move
// the consent somewhere it outlives the click — an environment variable, or a
// file the next `tan build` rewrites.
test("the gate never reaches for ALP_FLASH_FORCE, flash_args.confirm or flash_args.atoc_unqueryable", () => {
  const source = fs.readFileSync(
    path.join(root, "src", "flash", "gate.ts"),
    "utf8",
  );
  // Comment bodies are stripped: this file DOCUMENTS all of them, on purpose.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\n)\s*\/\/[^\n]*/g, "$1");
  assert.doesNotMatch(code, /ALP_FLASH_FORCE/);
  // The gate READS those keys (to refuse a manifest that already arms tan) but
  // never writes them: no assignment to a `flash_args` member anywhere.
  assert.doesNotMatch(code, /flash_args[.\w[\]"']*\s*=[^=]/);
  assert.doesNotMatch(code, /(?:confirm|atoc_unqueryable)\s*:\s*true/);
  assert.doesNotMatch(code, /"--recover"|'--recover'/);
});

test("`tan run --flash` is refused: a device write that is not the flash command", () => {
  // The gate keys on the COMMAND, and `--flash` is a flag on `run`. Measured
  // against the shipped predicate:
  //
  //   isFlashArgv(["run", "--flash"]) === false
  //
  // and the `FLASH_COMMAND` backstop tests the token `flash`, which `--flash`
  // is not. Its help on the pinned CLI: "Program the board after building
  // (hardware targets only)."
  //
  // Refused rather than gated: `tan run` REBUILDS before it flashes, so the
  // manifest a modal described is not the one the write would use.
  const dir = projectWithManifest();
  const { mod, plans } = loadGate("flashDevice");
  return mod.gateFlashDispatch(["run", "--flash"], dir).then((out) => {
    assert.equal(out, null, "a run that flashes must not reach the spawn");
    assert.match(plans.at(-1).message, /does not flash from `tan run`/);
    assert.equal(
      plans.filter((p) => p.channel === "modal").length,
      0,
      "refused, not asked about — there is no manifest-shaped consent for a " +
        "run that also builds",
    );
  });
});

test("a manifest that already carries flash_args.confirm or atoc_unqueryable is refused, naming the slice and key", async () => {
  // tan's gate is `--confirm OR flash_args.confirm`, and a dry-run cannot
  // reveal it: it would arm a host dd/bmaptool behind a modal that says
  // "NOT written".
  for (const key of ["confirm", "atoc_unqueryable"]) {
    const dir = projectWithManifest(
      FIXTURE.replace(
        "    slot0_load_address: '0x802b0000'",
        `    slot0_load_address: '0x802b0000'\n    ${key}: true`,
      ),
    );
    const { mod, plans } = loadGate(acceptAll);
    const tan = flowD();
    assert.equal(await mod.gateFlashDispatch(["flash"], dir, tan.deps), null);
    assert.match(lastMessage(plans), /m55_hp/);
    assert.ok(lastMessage(plans).includes(`flash_args.${key}`));
    assert.match(lastMessage(plans), /nothing was written/);
    assert.equal(tan.calls.length, 0, "refused before anything is spawned");
  }
});

test("a manifest key out of scope does not block a per-core flash", async () => {
  const dir = projectWithManifest(
    FIXTURE.replace(
      "    slot0_load_address: '0x802b0000'",
      "    slot0_load_address: '0x802b0000'\n    confirm: true",
    ),
  );
  const { mod, plans } = loadGate(acceptAll);
  await mod.gateFlashDispatch(["flash", "--core", "m55_he"], dir, flowD().deps);
  assert.doesNotMatch(lastMessage(plans) ?? "", /flash_args\.confirm/);
});

test("flags Alp does not model are refused like --recover", async () => {
  const dir = projectWithManifest();
  for (const args of [
    ["flash", "--ram"],
    ["flash", "--raw", "a.bin@0x0"],
    ["flash", "--replace-atoc"],
    ["flash", "--no-reset"],
  ]) {
    const { mod, plans } = loadGate(acceptAll);
    const tan = flowD();
    assert.equal(await mod.gateFlashDispatch(args, dir, tan.deps), null);
    assert.match(lastMessage(plans), /nothing was written/);
    assert.equal(confirmPlans(plans).length, 0);
    assert.equal(tan.calls.length, 0);
  }
});

test("the manifest is re-hashed as soon as the preview returns, before any modal", async () => {
  const dir = projectWithManifest();
  const manifest = path.join(dir, "build", "system-manifest.yaml");
  const { mod, plans } = loadGate(acceptAll);
  const out = await mod.gateFlashDispatch(["flash"], dir, {
    runTan: async () => {
      fs.writeFileSync(manifest, FIXTURE.replace("E1M-AEN801", "E1M-AEN701"));
      return capture("dry-run.flow-d");
    },
  });
  assert.equal(out, null);
  assert.match(lastMessage(plans), /changed while the confirmation was open/);
  assert.equal(confirmPlans(plans).length, 0, "no modal over a stale preview");
});

test("a bare `tan run` is untouched — it never flashes", () => {
  // The control. `src/west.ts` sends exactly this, and gating it would put a
  // write dialog on a command that writes nothing.
  const dir = projectWithManifest();
  const { mod, plans } = loadGate("flashDevice");
  return mod.gateFlashDispatch(["run"], dir).then((out) => {
    assert.deepEqual(out, { argv: ["run"], readEnvelope: false });
    assert.deepEqual(plans, [], "no dialog for a command that does not write");
  });
});
