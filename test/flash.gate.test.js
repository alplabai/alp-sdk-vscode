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
// The one assertion that matters most is negative: on cancel, `gateFlashDispatch`
// returns null and NOTHING is spawned. Everything else on this screen is text.

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

/** A throwaway project directory holding `build/system-manifest.yaml`. */
function projectWithManifest(text = FIXTURE) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-flash-gate-"));
  fs.mkdirSync(path.join(dir, "build"), { recursive: true });
  fs.writeFileSync(path.join(dir, "build", "system-manifest.yaml"), text);
  return dir;
}

/**
 * Load the gate with a scripted answer to the confirm modal.
 *
 * `answer` is what the presenter returns from `notify()` — the ActionId the
 * user picked, or `undefined` for a dismissed dialog. Every plan handed to
 * either presenter entry point is captured.
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

const confirmPlan = (plans) => plans.find((p) => p.channel === "modal");

// ---------------------------------------------------------------------------
// What the user sees BEFORE anything is written
// ---------------------------------------------------------------------------

test("a flash asks first, on a blocking modal that carries the whole target list", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate("flashDevice");
  await mod.gateFlashDispatch(["flash"], dir);

  const plan = confirmPlan(plans);
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

// ---------------------------------------------------------------------------
// The argv — the actual defect in #540
// ---------------------------------------------------------------------------

test("an accepted whole-project flash is ARMED with --confirm", async () => {
  // Part B, turned on deliberately (#540). Without `--confirm` the three
  // backends that set `planning_only` — `plan_yocto_wic`,
  // `plan_xspi_flashwriter`, `plan_alif_mram_jlink` — preview, write nothing
  // and exit non-zero, which IS the defect: Flash cannot program a board.
  //
  // Arming does not widen the other three (`plan_swd_probe`,
  // `plan_zephyr_west_flash`, `plan_baremetal_cmake_flash`): they never read
  // the flag and write on a bare run either way, so the consent dialog stays
  // their only gate. See the bench log on the PR for the silicon evidence.
  const dir = projectWithManifest();
  const { mod } = loadGate("flashDevice");
  assert.deepEqual(await mod.gateFlashDispatch(["flash"], dir), [
    "flash",
    "--confirm",
  ]);
});

test("an accepted per-slice flash spawns `flash --confirm --core <id>`", async () => {
  // This title said `--confirm` while the assertion below said the opposite —
  // a leftover from the split that put arming behind a bench pass. They agree
  // now, and the flag sits after the COMMAND, not at the end of the argv.
  const dir = projectWithManifest();
  const { mod, plans } = loadGate("flashDevice");
  assert.deepEqual(
    await mod.gateFlashDispatch(["flash", "--core", "m55_he"], dir),
    ["flash", "--confirm", "--core", "m55_he"],
  );
  // …and the dialog said the rest of the board is NOT being written, which is
  // the half-programmed-board hazard `--core` creates.
  assert.match(confirmPlan(plans).modalDetail, /Skipped, NOT written \(3\):/);
});

test("an accepted flash with an APP_PATH keeps the positional", async () => {
  const dir = projectWithManifest();
  const app = "app";
  fs.mkdirSync(path.join(dir, app, "build"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, app, "build", "system-manifest.yaml"),
    FIXTURE,
  );
  const { mod } = loadGate("flashDevice");
  assert.deepEqual(await mod.gateFlashDispatch(["flash", app], dir), [
    "flash",
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
  await mod.gateFlashDispatch(["flash", "app"], dir);
  assert.match(confirmPlan(plans).message, /E1M-AEN701/);
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
    assert.deepEqual(await mod.gateFlashDispatch(args, "/tmp/whatever"), args);
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
      await mod.gateFlashDispatch(["flash"], dir),
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
// that reads argv[0] lets that shape through unarmed — and unarmed is only
// harmless until `ALP_FLASH_FORCE=1` is in the inherited environment.
test("a flash behind root-position flags is gated like any other", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate("flashDevice");
  assert.deepEqual(
    await mod.gateFlashDispatch(["--sdk-root", "/opt/sdk", "flash"], dir),
    ["--sdk-root", "/opt/sdk", "flash", "--confirm"],
  );
  assert.ok(confirmPlan(plans), "no dialog was raised for a prefixed flash");
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
test("a manifest rewritten while the dialog is open is refused, not armed", async () => {
  const dir = projectWithManifest();
  const manifest = path.join(dir, "build", "system-manifest.yaml");
  const { mod, plans } = loadGate(() => {
    // The rewrite happens WHILE the modal is up, which is the whole point.
    fs.writeFileSync(manifest, FIXTURE.replace("E1M-AEN801", "E1M-AEN701"));
    return "flashDevice";
  });
  assert.equal(
    await mod.gateFlashDispatch(["flash"], dir),
    null,
    "an accepted dialog over stale contents must not arm the write",
  );
  assert.match(plans.at(-1).message, /changed while the confirmation was open/);
  assert.match(plans.at(-1).message, /nothing was written/);
  assert.doesNotMatch(plans.at(-1).message, /fail/i);
});

test("a manifest DELETED while the dialog is open is refused too", async () => {
  const dir = projectWithManifest();
  const manifest = path.join(dir, "build", "system-manifest.yaml");
  const { mod, plans } = loadGate(() => {
    fs.rmSync(manifest);
    return "flashDevice";
  });
  assert.equal(await mod.gateFlashDispatch(["flash"], dir), null);
  assert.match(plans.at(-1).message, /disappeared while the confirmation/);
});

test("an unchanged manifest still passes — the re-check is not a blanket refusal", async () => {
  const dir = projectWithManifest();
  const manifest = path.join(dir, "build", "system-manifest.yaml");
  const { mod } = loadGate(() => {
    // Byte-identical rewrite: same content, new mtime. The check is on the
    // BYTES, so this is not a change and must not refuse.
    fs.writeFileSync(manifest, FIXTURE);
    return "flashDevice";
  });
  assert.deepEqual(await mod.gateFlashDispatch(["flash"], dir), [
    "flash",
    "--confirm",
  ]);
});

test("the gate ARMS every accepted path, and nothing else", async () => {
  // The inverse of the Part A invariant, flipped on purpose once a bench pass
  // proved a board is programmed and boots. Every accepted shape is checked,
  // because arming one path and not another is how the two call sites came to
  // disagree in the first place — and a path that is armed without consent, or
  // consented without being armed, is the whole of #540.
  const dir = projectWithManifest();
  for (const argv of [
    ["flash"],
    ["flash", "--core", "m55_he"],
    ["--sdk-root", "/opt/sdk", "flash"],
  ]) {
    const { mod } = loadGate("flashDevice");
    const out = await mod.gateFlashDispatch(argv, dir);
    assert.ok(out, `${argv.join(" ")} was refused, so this proves nothing`);
    assert.equal(
      out.includes("--confirm"),
      true,
      `the gate did NOT arm ${argv.join(" ")} — on yocto_wic / ` +
        "xspi_flashwriter / alif_mram_jlink that previews, writes nothing and " +
        "exits non-zero, which the customer reads as a failed flash",
    );
  }
});

test("--dry-run writes nothing, so it is neither gated nor armed", async () => {
  const dir = projectWithManifest();
  const { mod, plans } = loadGate("flashDevice");
  assert.deepEqual(await mod.gateFlashDispatch(["flash", "--dry-run"], dir), [
    "flash",
    "--dry-run",
  ]);
  assert.deepEqual(plans, []);
});

// ALP_FLASH_FORCE=1 and `flash_args.confirm: true` are tan's two other ways to
// arm the gate. Both move the consent somewhere it outlives the click — an
// environment variable, or a file the next `tan build` rewrites.
test("the gate never reaches for ALP_FLASH_FORCE or flash_args.confirm", () => {
  const source = fs.readFileSync(
    path.join(root, "src", "flash", "gate.ts"),
    "utf8",
  );
  // Comment bodies are stripped: this file DOCUMENTS both, on purpose.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\n)\s*\/\/[^\n]*/g, "$1");
  assert.doesNotMatch(code, /ALP_FLASH_FORCE/);
  assert.doesNotMatch(code, /flash_args/);
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
  // No call site builds it today, and `test/flash.dispatch.test.js` filters
  // the extractor on `site.command === "flash"` — so a future `run --flash`
  // site would stay green while programming a board unasked. That is the gap
  // this closes.
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

test("a bare `tan run` is untouched — it never flashes", () => {
  // The control. `src/west.ts` sends exactly this, and gating it would put a
  // write dialog on a command that writes nothing.
  const dir = projectWithManifest();
  const { mod, plans } = loadGate("flashDevice");
  return mod.gateFlashDispatch(["run"], dir).then((out) => {
    assert.deepEqual(out, ["run"]);
    assert.deepEqual(plans, [], "no dialog for a command that does not write");
  });
});
