// SPDX-License-Identifier: Apache-2.0
//
// Giving every chosen core its own app (#534).
//
// `tan init --cores` splices companions in APP-LESS — from `tan init --help` at
// the pinned 0.6.0-rc1, a companion "can only be spliced in app-less, as `:off`
// or (on a Cortex-A id) `:yocto`". So a dual-M55 SoM, the Alif Ensemble line's
// defining topology, could never be scaffolded with two Zephyr apps: one core
// got `./src` and the rest were not in the file at all.
//
// This is the second pass. tan writes what it knows (`preset:`,
// `supported_boards:`, the SoM's own topology, any `ipc:`), and then only the
// part it CANNOT express is added on top. Composing the whole board.yaml here
// instead — via `tan init --board-yaml`, which does render a file verbatim —
// was the first design and was dropped: it would mean re-deriving `preset:`
// and `supported_boards:` in this extension, which is the SDK's knowledge, not
// ours.
//
// IMMUTABLE, like everything else in core: the input board is never touched.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  applyCoreAssignments,
  companionCmakeLists,
  companionMainC,
} = require("../packages/alp-core/dist/project/coreScaffold.js");

/** What `tan init --template zephyr-app --som E1M-AEN801 --cores a32_cluster:yocto`
 *  actually produces, measured (pinned tan 0.6.0-rc1, alp-sdk v0.16.0-rc1). */
const SCAFFOLDED = {
  som: { sku: "E1M-AEN801" },
  preset: "e1m-evk",
  cores: {
    m55_hp: { app: "./src", peripherals: [] },
    a32_cluster: { os: "yocto", image: "alp-image-edge" },
  },
  diagnostics: { logLevel: "info" },
};

test("a companion core gains an app directory and its runtime", () => {
  // Arrange / Act
  const next = applyCoreAssignments(SCAFFOLDED, [
    { id: "m55_hp", os: "zephyr", app: "./src" },
    { id: "m55_he", os: "zephyr", app: "./m55_he" },
    { id: "a32_cluster", os: "yocto" },
  ]);

  // Assert
  assert.equal(next.cores.m55_he.app, "./m55_he");
  assert.equal(next.cores.m55_he.os, "zephyr");
});

test("the input board is never mutated", () => {
  // Arrange -- core's immutability rule, and it is load-bearing here: the
  // caller keeps the ORIGINAL text to hand to `serializeBoardConfig`, so a
  // mutated input would serialise against a document that no longer matches.
  const before = JSON.stringify(SCAFFOLDED);

  // Act
  applyCoreAssignments(SCAFFOLDED, [
    { id: "m55_he", os: "zephyr", app: "./m55_he" },
  ]);

  // Assert
  assert.equal(JSON.stringify(SCAFFOLDED), before);
});

test("what tan already wrote is preserved, not rebuilt", () => {
  // Arrange -- `peripherals: []`, the yocto `image:`, `preset:` and the SoM are
  // tan's own output. This pass adds; it never re-derives.
  const next = applyCoreAssignments(SCAFFOLDED, [
    { id: "m55_hp", os: "zephyr", app: "./src" },
    { id: "m55_he", os: "zephyr", app: "./m55_he" },
    { id: "a32_cluster", os: "yocto" },
  ]);

  assert.equal(next.preset, "e1m-evk");
  assert.equal(next.som.sku, "E1M-AEN801");
  assert.deepEqual(next.cores.m55_hp.peripherals, []);
  assert.equal(next.cores.a32_cluster.image, "alp-image-edge");
});

test("the app core keeps the app directory tan gave it", () => {
  // Arrange -- tan chose `./src` and put the template's `main.c` there. Moving
  // it would orphan a directory full of real code.
  const next = applyCoreAssignments(SCAFFOLDED, [
    { id: "m55_hp", os: "zephyr", app: "./src" },
  ]);

  assert.equal(next.cores.m55_hp.app, "./src");
});

test("tan's app directory wins over the wizard's guess", () => {
  // Arrange -- the dangerous case. tan chose `m55_hp` as the app core and put
  // the template's real source in `./src`. If the wizard guessed a different
  // directory for that same core, honouring it would repoint the core at a new
  // empty directory and orphan the code the customer just asked to be
  // scaffolded. Which core tan picked is not knowable here (#528/#529), so the
  // rule is: a core that already HAS an app keeps it.
  const next = applyCoreAssignments(SCAFFOLDED, [
    { id: "m55_hp", os: "zephyr", app: "./app_hp" },
  ]);

  assert.equal(next.cores.m55_hp.app, "./src");
});

test("a core assigned `off` gets os: off and NO app directory", () => {
  const next = applyCoreAssignments(SCAFFOLDED, [{ id: "m55_he", os: "off" }]);

  assert.equal(next.cores.m55_he.os, "off");
  assert.equal(next.cores.m55_he.app, undefined);
});

test("an app on a core assigned `off` is dropped, not written", () => {
  // Arrange -- the UI can carry a stale directory string in a disabled field;
  // writing `app:` under `os: off` would be a slice that claims an app it will
  // never build.
  const next = applyCoreAssignments(SCAFFOLDED, [
    { id: "m55_he", os: "off", app: "./m55_he" },
  ]);

  assert.equal(next.cores.m55_he.app, undefined);
});

test("no assignments leaves the board exactly as tan wrote it", () => {
  assert.deepEqual(applyCoreAssignments(SCAFFOLDED, []), SCAFFOLDED);
});

// ---------------------------------------------------------------------------
// The companion's own CMake application
// ---------------------------------------------------------------------------

test("the companion CMakeLists targets ITS core and the shared board.yaml", () => {
  // Arrange -- a Zephyr application is one CMake project per core. The
  // scaffolded root `CMakeLists.txt` is hardcoded to the app core
  // (`--emit zephyr-conf --core m55_hp`, `target_sources(app PRIVATE src/main.c)`),
  // so a second core needs its own, pointing UP at the one board.yaml.
  const text = companionCmakeLists({
    coreId: "m55_he",
    projectName: "deneme123",
  });

  assert.match(text, /--emit zephyr-conf --core m55_he/);
  assert.match(
    text,
    /--input \$\{CMAKE_CURRENT_SOURCE_DIR\}\/\.\.\/board\.yaml/,
  );
  assert.match(text, /target_sources\(app PRIVATE main\.c\)/);
  assert.match(text, /project\(deneme123_m55_he LANGUAGES C\)/);
});

test("the companion CMakeLists demands ALP_SDK_ROOT rather than guessing it", () => {
  // Arrange -- the SDK's own `multicore/mproc-mailbox` peer falls back to
  // `../../../..`, which only resolves because that example lives INSIDE the
  // SDK tree. A generated project does not, so the same fallback would resolve
  // to some unrelated directory and fail later and less legibly. The root
  // CMakeLists tan generates uses the explicit form; this matches it.
  const text = companionCmakeLists({ coreId: "m55_he", projectName: "p" });

  assert.match(text, /ALP_SDK_ROOT is not set/);
  assert.doesNotMatch(text, /\.\.\/\.\.\/\.\.\/\.\./);
});

test("a project name that is not a C identifier is sanitised for project()", () => {
  // Arrange -- CMake project names take the wizard's project name, which is
  // validated as `[a-zA-Z0-9][a-zA-Z0-9_-]*` — hyphens are legal there and
  // awkward here.
  const text = companionCmakeLists({
    coreId: "m33_sm",
    projectName: "my-cool-app",
  });

  assert.match(text, /project\(my_cool_app_m33_sm LANGUAGES C\)/);
});

test("the companion main.c builds and says which core it is", () => {
  // Arrange -- the point of a scaffold is a compiling starting point on every
  // core, not a demo. It prints its own core id so a bring-up engineer can tell
  // the two images apart on one console.
  const text = companionMainC({ coreId: "m55_he" });

  assert.match(text, /#include <stdio\.h>/);
  assert.match(text, /int main\(void\)/);
  assert.match(text, /m55_he/);
  assert.match(text, /alp_init\(\)/);
});

test("the companion main.c pulls in no IPC header", () => {
  // Arrange -- the wizard emits no active `ipc:` (alp-sdk#1613 and #534: every
  // current SKU family has that channel blocked or half-proven). A skeleton
  // including <alp/system_ipc.h> would reference macros that resolve to
  // safe-zero stubs, teaching the customer they are real addresses.
  const text = companionMainC({ coreId: "m55_he" });

  // The header may be NAMED in the comment — telling the customer how to add a
  // channel is the point — but never included, and no macro from it used.
  assert.doesNotMatch(
    text,
    /^\s*#include\s*<alp\/system_ipc\.h>/m,
    "the skeleton must not include the IPC header",
  );
  assert.doesNotMatch(
    text,
    /^(?!\s*\*).*ALP_IPC_/m,
    "no IPC macro may be used outside a comment",
  );
});
