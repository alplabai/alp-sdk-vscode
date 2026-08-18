// SPDX-License-Identifier: Apache-2.0
//
// Every symbol `test/e2e/suite/index.js` destructures out of a compiled module
// must actually exist on that module.
//
// This exists because it already went wrong, silently, for the whole lifetime
// of a merged PR. #387 deleted `debugProfileToLaunchDraft` when draft-building
// moved to `tan debug-config`, updated the unit tests, and missed the e2e
// suite. Two checks then threw `TypeError: ... is not a function` on every run:
//
//   FAIL  every debug type the extension emits is registered
//   FAIL  a native-sim debug session starts in a real host
//
// The second of those is the ONLY automated evidence this repo has that a debug
// session starts -- its own comment calls it "the strongest evidence available
// without a human at a GUI". So the PR whose entire subject was who writes
// launch.json disabled the check that would have caught it going wrong, and
// `build · extension + vsix` stayed green from that merge until #392, because
// `test:e2e` is not a required check (#394).
//
// This is deliberately NOT a replacement for running the suite. It catches one
// narrow, mechanical failure -- a name that no longer resolves -- which is
// exactly what happened, and it does so in milliseconds with no VS Code
// download, no Electron host, and none of the Windows traps (#392) that make
// the real suite easy to leave unrun. Everything else the e2e suite asserts is
// still only asserted by running it.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const suite = path.join(root, "test", "e2e", "suite", "index.js");

/**
 * Every `const { a, b } = require("<relative path>")` in the suite, as
 * `{ names, target }`.
 *
 * Static parse rather than executing the file: `index.js` needs a real
 * `vscode` module and an extension host, neither of which exists here. That is
 * the whole point -- the check has to be runnable in the plain `node --test`
 * suite, or it inherits the same "easy to leave unrun" problem it guards.
 *
 * Only DESTRUCTURED requires are matched. A bare `require(...)` binds no names,
 * so there is nothing to verify, and a namespace import that later indexes a
 * missing key is a different failure this cannot see.
 */
function destructuredRequires(source) {
  const out = [];
  // `\s*` after `require(` and after `path.resolve(` is load-bearing, not
  // defensive: prettier wraps the long core requires across four lines, and a
  // regex without it silently matched only the short ones. The first version of
  // this file did exactly that -- it parsed four requires, skipped the debug
  // one, and passed a mutation that reintroduced #387's bug verbatim. A parser
  // that quietly matches less than it should is the failure mode this whole
  // file exists to catch, one level up.
  const re =
    /const\s*\{([^}]+)\}\s*=\s*require\(\s*(?:path\.resolve\(\s*__dirname\s*,\s*)?\s*["']([^"']+)["']/g;
  for (const m of source.matchAll(re)) {
    const names = m[1]
      .split(",")
      .map((n) => n.trim().split(":")[0].trim())
      .filter(Boolean);
    if (names.length) out.push({ names, target: m[2] });
  }
  return out;
}

test("every symbol the e2e suite destructures still exists", () => {
  const source = fs.readFileSync(suite, "utf8");
  const requires = destructuredRequires(source);

  // A parser that silently matched nothing would pass this file forever. The
  // suite genuinely does destructure from compiled modules; if that stops being
  // true the assertion below is the thing that should be deleted, deliberately.
  assert.ok(
    requires.length >= 3,
    `parsed only ${requires.length} destructured require(s) from the e2e suite — the parser is probably broken, not the suite`,
  );

  const missing = [];
  let checked = 0;

  for (const { names, target } of requires) {
    // Node built-ins and `vscode` are not ours and are not what rotted.
    if (!target.startsWith(".")) continue;

    const resolved = path.resolve(path.dirname(suite), target);
    if (!fs.existsSync(resolved)) {
      // `out/` and `packages/*/dist/` are build outputs. Absent means "not
      // compiled yet", not "the symbol is gone" — reporting that as drift would
      // make this fail on a clean checkout and teach people to ignore it.
      continue;
    }

    let mod;
    try {
      mod = require(resolved);
    } catch (error) {
      // Host-only modules (`out/views/*.js` and friends) `require("vscode")`,
      // which exists only inside an extension host. Skipping them is a real
      // limit, not a formality: this check therefore covers the PURE modules
      // only -- `packages/*/dist/**` -- which is where the #387 rot happened
      // and where the compiled core's exports actually live.
      //
      // Narrowly matched on purpose. Any other load error is a genuine problem
      // with a module the e2e suite depends on, and swallowing it here would
      // reproduce this test's own failure mode one level down.
      const vscodeOnly =
        error?.code === "MODULE_NOT_FOUND" &&
        /Cannot find module 'vscode'/.test(String(error?.message));
      if (vscodeOnly) continue;
      throw error;
    }
    for (const name of names) {
      checked += 1;
      if (!(name in mod)) {
        missing.push(`${name} (from ${target})`);
      }
    }
  }

  // The other half of the same trap: if nothing was compiled, every module was
  // skipped and this test asserted nothing while reporting success. Say so.
  assert.ok(
    checked > 0,
    "no compiled modules were found, so no symbol was actually checked — run `pnpm run compile` before trusting this test",
  );

  assert.deepEqual(
    missing,
    [],
    `the e2e suite destructures ${missing.length} name(s) that no longer exist. ` +
      "It will throw `TypeError: ... is not a function` at runtime, and " +
      "`test:e2e` is not a required check, so nothing else will tell you: " +
      missing.join(", "),
  );
});
