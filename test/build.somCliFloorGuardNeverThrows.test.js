// SPDX-License-Identifier: Apache-2.0
//
// `warnIfCliCannotBuildSom` (src/build/somCliFloorGuard.ts) must NEVER throw
// — found on adversarial review of #606. It is an EXPLANATION for a build
// that is about to run, awaited immediately before the real spawn at all
// four call sites, and none of them wraps the call in a `try`/`catch` of its
// own:
//
//   - `src/west.ts`'s `alpBuild` awaits it before `runAlpStreamed`;
//   - `src/ideHub/buildPlanPanel.ts`'s `handleRunBuild` awaits it OUTSIDE any
//     try, dispatched `void` from a message handler — a rejection here is an
//     unhandled rejection AND the build never runs;
//   - `handleMaterialiseBuildPlan` awaits it INSIDE a try, but that try's
//     `catch` does not exist — only a `finally` that releases the build
//     reservation, so a throw here still skips the materialise entirely;
//   - `src/tasks/vscodeAdapter.ts`'s `dispatchBuild` awaits it before
//     `runAlpInTerminal`, and a throw there is swallowed by
//     `.then(_, () => this.failIfNothingStarted())` — the customer gets
//     "the build did not start -- see the Alp SDK output channel" with
//     NOTHING in the channel, because nothing ever reached `runAlpInTerminal`
//     to log a command line.
//
// A probe failing (`probeTanVersion`'s `cp.spawn`, or any other step) must
// not cost the customer the build this function only ever exists to explain.
// Drives the REAL `out/build/somCliFloorGuard.js` directly — the fix belongs
// in exactly one place, so one direct test is what proves it, rather than
// four call-site tests that could each independently regress the same way
// the original omission happened four times.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

const boardYaml = (sku) => `som:\n  sku: ${sku}\ncores: {}\n`;

/** Drive `warnIfCliCannotBuildSom` with `probeTanVersion` (or any other named
 *  seam) replaced by a throwing stub, and report whether the call itself
 *  rejected — never mind what it logged or notified. */
async function driveWithThrow({ sku, throwFrom, log = () => {} }) {
  const modPath = require.resolve(
    path.join(root, "out", "build", "somCliFloorGuard.js"),
  );
  delete require.cache[modPath];
  const boom = new Error("probe exploded");
  const stubs = {
    fs: {
      existsSync: (p) => String(p).endsWith("board.yaml"),
      readFileSync: () => boardYaml(sku),
    },
    "../alpCli/vscodeAdapter": {
      probeTanVersion:
        throwFrom === "probeTanVersion"
          ? async () => {
              throw boom;
            }
          : async () => "0.5.1",
    },
    "../notify/vscodeAdapter": {
      notifyAsync:
        throwFrom === "notifyAsync"
          ? () => {
              throw boom;
            }
          : () => {},
    },
    "../util": { log },
  };

  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  let warnIfCliCannotBuildSom;
  try {
    ({ warnIfCliCannotBuildSom } = require(modPath));
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }

  return warnIfCliCannotBuildSom({}, "/work/renesas-control");
}

test("a throwing probeTanVersion does not reject — the build must still run", async () => {
  await assert.doesNotReject(
    driveWithThrow({ sku: "E1M-V2N101", throwFrom: "probeTanVersion" }),
    "an explanation that can throw is a gate, which is exactly what this " +
      "function's own doc says it is not",
  );
});

test("a throwing notifyAsync (the toast itself) does not reject either", async () => {
  await assert.doesNotReject(
    driveWithThrow({ sku: "E1M-V2N101", throwFrom: "notifyAsync" }),
    "the warning path notifies AFTER the probe succeeds; a throw there " +
      "must not retroactively fail the whole check",
  );
});

test("an unexpected failure is logged, not silently dropped", async () => {
  const lines = [];
  await driveWithThrow({
    sku: "E1M-V2N101",
    throwFrom: "probeTanVersion",
    log: (line) => lines.push(line),
  });

  assert.ok(
    lines.some(
      (l) => l.includes("som-cli-floor") && l.includes("probe exploded"),
    ),
    "an UNEXPECTED failure (not the routine non-Renesas/no-board.yaml cases, " +
      "which are silent on purpose) should still leave a trace — got " +
      JSON.stringify(lines),
  );
});
