// SPDX-License-Identifier: Apache-2.0
//
// The consent ITEMS behind ADR 0021 §3's one consent screen (#467).
//
// Two things are being pinned here, and they pull in opposite directions.
//
// 1. **Nothing is invented.** ADR 0021 asks the screen to itemise artifact,
//    source, size and licence. No producer emits a size or a licence today —
//    measured on `metadata/bootstrap.json` at SDK v0.15.0 and on `tan doctor
//    --format json` at the 0.6.0 pin, neither of which carries `tier`,
//    `licence`, `source` or `size` (alp-sdk#1574). So those cells are `null`
//    and the screen says "not reported"; a plausible-looking number here would
//    be this extension making a claim it has no authority to make, and a
//    licence is exactly the claim you must not guess at.
//
// 2. **Nothing is filtered.** There is deliberately no table keyed on tool
//    name — the same rule the planner already states ("tan owns the facts").
//    A check tan adds tomorrow must produce a consent item with zero change
//    here, so the unknown-tool test below is a REQUIREMENT, not a curiosity.
//
// The elevation flag is the one derived field, and it is derived from the
// PRODUCER's own command text (does the line tan emitted invoke `sudo`), never
// from the tool's name. That distinction is what keeps it out of the
// hardcoded-tier trap #467 forbids.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  planInstallConsent,
  commandNeedsElevation,
} = require("../packages/alp-core/dist/deps/consent.js");

/** A row shaped like the planner's output. */
const row = (over) => ({
  name: over.name,
  label: over.label ?? over.name,
  status: over.status ?? "fail",
  state: over.state ?? "will-install",
  detail: "",
  hint: null,
  installed: null,
  latest: null,
  updateAvailable: false,
  action:
    over.action === undefined
      ? {
          kind: "command",
          commands: [
            { tool: over.name, command: `apt-get install -y ${over.name}` },
          ],
          effect: "install",
          title: `install ${over.name}`,
        }
      : over.action,
});

test("every row handed in becomes exactly one item, in order", () => {
  const rows = [row({ name: "ninja" }), row({ name: "cmake" })];

  const items = planInstallConsent(rows, "linux");

  assert.deepEqual(
    items.map((item) => item.name),
    ["ninja", "cmake"],
  );
});

test("the source is the producer's command line, verbatim", () => {
  const items = planInstallConsent(
    [
      row({
        name: "ninja",
        action: {
          kind: "command",
          commands: [
            { tool: "ninja", command: "sudo apt-get install -y ninja-build" },
          ],
          effect: "install",
          title: "install ninja",
        },
      }),
    ],
    "linux",
  );

  assert.deepEqual(items[0].source, ["sudo apt-get install -y ninja-build"]);
});

test("a multi-step command row: every line reaches the screen, none truncated", () => {
  // #603: the `hostPrerequisites` rollup can carry more than one dispatch. No
  // paraphrase, no "first line only" — every line the row will run.
  const items = planInstallConsent(
    [
      row({
        name: "hostPrerequisites",
        action: {
          kind: "command",
          commands: [
            { tool: "cmake", command: "brew install cmake" },
            { tool: "ninja", command: "brew install ninja" },
          ],
          effect: "install",
          title: "Installs cmake, ninja",
        },
      }),
    ],
    "darwin",
  );

  assert.deepEqual(items[0].source, [
    "brew install cmake",
    "brew install ninja",
  ]);
});

test("size and licence are null — no producer reports either (alp-sdk#1574)", () => {
  const items = planInstallConsent([row({ name: "ninja" })], "linux");

  assert.equal(items[0].size, null);
  assert.equal(items[0].licence, null);
});

test("a check this extension has never heard of still gets an item", () => {
  // The anti-allowlist assertion. A local table keyed on tool name would drop
  // this row, and the screen would then consent to installing something it
  // never showed.
  const items = planInstallConsent(
    [
      row({
        name: "quantumFlux",
        label: "Quantum flux capacitor",
        action: {
          kind: "command",
          commands: [
            { tool: "quantumFlux", command: "brew install quantum-flux" },
          ],
          effect: "install",
          title: "install quantumFlux",
        },
      }),
    ],
    "darwin",
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].artifact, "Quantum flux capacitor");
  assert.deepEqual(items[0].source, ["brew install quantum-flux"]);
});

test("a fix row's source is resolved through fixCommand for that host", () => {
  // `west` is a pip command on win32 and a whole bootstrap run everywhere else
  // (bootstrapPlan.ts), so the same row must not describe the same source on
  // both — that is the fact the host argument exists for.
  const westRow = row({
    name: "west",
    action: { kind: "fix", fixId: "west", effect: "install", title: "west" },
  });

  const [win] = planInstallConsent([westRow], "win32");
  const [linux] = planInstallConsent([westRow], "linux");

  assert.match(win.source[0], /pip/);
  assert.deepEqual(linux.source, ["tan bootstrap"]);
});

test("a row with no action reports a null source rather than being dropped", () => {
  const items = planInstallConsent(
    [row({ name: "yoctoHost", action: null })],
    "linux",
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].source, null);
});

test("elevation is read off the command text, not the tool name", () => {
  assert.equal(
    commandNeedsElevation("sudo apt-get install -y ninja-build"),
    true,
  );
  assert.equal(commandNeedsElevation("pkexec dnf install ninja-build"), true);
  assert.equal(commandNeedsElevation("doas pkg_add ninja"), true);
  assert.equal(
    commandNeedsElevation("runas /user:Administrator installer.exe"),
    true,
  );
  assert.equal(
    commandNeedsElevation("powershell Start-Process -Verb RunAs installer.exe"),
    true,
  );
  // After a pipe or a `&&` it is still an elevated command.
  assert.equal(commandNeedsElevation("cd /tmp && sudo make install"), true);

  assert.equal(commandNeedsElevation("brew install ninja"), false);
  assert.equal(commandNeedsElevation("pip install --user west"), false);
  // Substring matches must not fire: these are ordinary commands.
  assert.equal(commandNeedsElevation("apt-get install -y sudoku"), false);
  assert.equal(commandNeedsElevation("./configure --with-pseudorunas"), false);
});

test("needsElevation rides on the item", () => {
  const [elevated, plain] = planInstallConsent(
    [
      row({
        name: "udev",
        action: {
          kind: "command",
          commands: [
            {
              tool: "udev",
              command: "sudo cp 99-jlink.rules /etc/udev/rules.d/",
            },
          ],
          effect: "install",
          title: "udev rules",
        },
      }),
      row({
        name: "ninja",
        action: {
          kind: "command",
          commands: [{ tool: "ninja", command: "brew install ninja" }],
          effect: "install",
          title: "install ninja",
        },
      }),
    ],
    "linux",
  );

  assert.equal(elevated.needsElevation, true);
  assert.equal(plain.needsElevation, false);
});

test("needsElevation is ANY-of over a multi-step row's lines (#603)", () => {
  // The line that needs elevation does not have to be the FIRST one.
  const [item] = planInstallConsent(
    [
      row({
        name: "hostPrerequisites",
        action: {
          kind: "command",
          commands: [
            { tool: "cmake", command: "brew install cmake" },
            {
              tool: "ninja",
              command: "sudo apt-get install -y ninja-build",
            },
          ],
          effect: "install",
          title: "Installs cmake, ninja",
        },
      }),
    ],
    "linux",
  );

  assert.equal(item.needsElevation, true);
});

test("the item carries the action's own effect, unchanged", () => {
  // `ConsentItem.title` was deleted in the same diff that stopped reading it
  // (#603, third review, minor 8 — no-legacy-compat: it had zero readers
  // repo-wide once `consentPick` moved to `item.omittedTools`).
  const [item] = planInstallConsent(
    [
      row({
        name: "west-workspace",
        action: {
          kind: "fix",
          fixId: "west-workspace",
          effect: "bootstrap",
          title: "run tan bootstrap (venv + west + Zephyr Python deps)",
        },
      }),
    ],
    "linux",
  );

  assert.equal(item.effect, "bootstrap");
  assert.equal(
    Object.prototype.hasOwnProperty.call(item, "title"),
    false,
    "ConsentItem must not carry a dead title field",
  );
});

test("an empty set consents to nothing", () => {
  assert.deepEqual(planInstallConsent([], "linux"), []);
});
