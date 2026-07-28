// SPDX-License-Identifier: Apache-2.0
//
// The LAZY-DOWNLOAD half of the checksum refusal (#378), driven through the
// REAL `runAlpCommand` / `runAlpInTerminal` in out/alpCli/vscodeAdapter.js.
//
// Why this file exists as well as alpCli.downloadChecksum.test.js: the refusal
// can be perfect at the download layer and still reach the customer as the
// wrong sentence with the wrong button. `resolveAlpBinary` has a live
// `case "download"`, and `src/extension.ts` fires provisioning as
// `void ensureTanCliProvisioned(context)` — not awaited, and sharing no
// in-flight promise with `resolveAlpBinaryForContext`. So a command issued
// before or instead of provisioning downloads INLINE, and the `ChecksumError`
// surfaces here rather than through `checksumFailurePlan`.
//
// It used to arrive as `classifyUnavailable(...) === "corrupt"`, which produced
// ONE toast for all three refusals:
//
//     Building couldn't start the tan CLI — the installed copy looks broken.
//     [Install tan CLI] [Open Settings → alpSdk.cliPath]
//
// Three defects in one sentence. The three outcomes became indistinguishable —
// the exact requirement this check exists to satisfy. The sentence was false:
// nothing was installed, and a good installed copy is deliberately left
// untouched. And it offered `alpSdk.cliPath`, the ONE resolution source with no
// checksum path at all (`resolveAlpBinary`'s `cliPath` case returns the setting
// verbatim) — a one-click route, mid-tamper, to permanently executing exactly
// the unverified binary that had just been refused.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const ADAPTER = require.resolve(
  path.join(root, "out", "alpCli", "vscodeAdapter.js"),
);
const REAL_ADAPTER_CORE = require(
  path.join(root, "out", "alpCli", "adapterCore.js"),
);
// The REAL class: the adapter branches on `instanceof`, so a look-alike would
// prove nothing about the shipped path.
const { ChecksumError } = require(
  path.join(root, "out", "alpCli", "download.js"),
);
const { planCliOutcome } = require(
  path.join(root, "out", "notify", "service.js"),
);

/** The three refusals `download.ts` throws, with their channel-only detail.
 *  The `kind` is the first argument and is what `downloadCli` branches on when
 *  it re-frames a #386 re-acquire — see `migrationRefusal` in adapterCore. */
const REFUSALS = {
  mismatch: new ChecksumError(
    "mismatch",
    "The downloaded tan CLI does not match the checksum Alp Lab published " +
      "for it, so it was discarded and nothing was installed.",
    "sha256 of the downloaded bytes is aaaa, published digest is bbbb",
  ),
  unfetchable: new ChecksumError(
    "unfetchable",
    "The tan CLI download was discarded: the checksum file that vouches for " +
      "it could not be fetched, so there was no way to tell whether the " +
      "binary is the one Alp Lab published.",
    "could not fetch https://example/checksums.txt — HTTP 500",
  ),
  unlisted: new ChecksumError(
    "unlisted",
    "The tan CLI download was discarded: the release's checksum file does " +
      "not list this binary, so nothing vouches for the bytes that were served.",
    "no entry for tan-x86_64-unknown-linux-musl in https://example/checksums.txt",
  ),
};

/**
 * Load a fresh adapter whose binary resolution REJECTS with `error` — which is
 * what `resolveAlpBinary`'s `case "download"` does when `downloadFile` refuses
 * the bytes. Everything from there to the notification plan is the real code.
 */
function loadAdapterRejecting(error) {
  delete require.cache[ADAPTER];
  const plans = [];
  const stubs = {
    vscode: {
      workspace: {
        getConfiguration: () => ({ get: (_key, fallback) => fallback }),
      },
    },
    child_process: {
      spawn: () => {
        throw new Error("resolution failed — nothing may be spawned");
      },
      spawnSync: () => ({ status: 0, stdout: "", stderr: "" }),
      execFile: () => {},
    },
    "./adapterCore": {
      ...REAL_ADAPTER_CORE,
      resolveAlpBinary: async () => {
        throw error;
      },
    },
    "../notify/vscodeAdapter": {
      notify: async (plan) => {
        plans.push(plan);
        // NOT "retry": `runAlpInTerminal` re-runs itself on that pick, and the
        // stub would then loop forever.
        return undefined;
      },
      notifyAsync: (plan) => plans.push(plan),
    },
    "../project/vscodeAdapter": {
      collectProjectContext: () => ({
        workspaceRoot: null,
        sdkRoot: null,
        boardYamlPath: null,
        westCwd: null,
        pythonBinary: "python",
      }),
    },
    "../util": { log() {}, runInTerminal() {} },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  try {
    return { adapter: require(ADAPTER), plans };
  } finally {
    Module._load = originalLoad;
    delete require.cache[ADAPTER];
  }
}

const CONTEXT = {
  extensionPath: path.join(root, "no-such-extension-dir"),
  globalStorageUri: { fsPath: path.join(root, "no-such-storage-dir") },
};

/** SURFACE A — `runAlpCommand` returns the outcome; the caller plans it. */
async function envelopePlanFor(error) {
  const { adapter } = loadAdapterRejecting(error);
  const { outcome } = await adapter.runAlpCommand(CONTEXT, ["build"]);
  return planCliOutcome(outcome, { operation: "Building" });
}

/** SURFACE B — `runAlpInTerminal` presents it itself. */
async function terminalPlanFor(error) {
  const { adapter, plans } = loadAdapterRejecting(error);
  await adapter.runAlpInTerminal(CONTEXT, ["bootstrap"], {
    name: "Alp: Bootstrap",
    cwd: undefined,
  });
  assert.equal(plans.length, 1, "expected exactly one notification");
  return plans[0];
}

const SURFACES = [
  ["runAlpCommand", envelopePlanFor],
  ["runAlpInTerminal", terminalPlanFor],
];

for (const [surface, planFor] of SURFACES) {
  test(`${surface}: a refused download never offers alpSdk.cliPath`, async () => {
    for (const [name, error] of Object.entries(REFUSALS)) {
      const plan = await planFor(error);
      const settings = plan.actions.filter((a) => a.id === "openSettings");
      assert.deepEqual(
        settings,
        [],
        `${name}: mid-tamper, "Open Settings → alpSdk.cliPath" is a one-click ` +
          `route to a permanently unverified binary — that source is never ` +
          `checksum-checked. Actions were ${JSON.stringify(plan.actions)}`,
      );
      assert.ok(
        plan.actions.some((a) => a.id === "retry"),
        `${name}: Retry is safe (it re-verifies) and must be offered`,
      );
      assert.ok(
        plan.actions.some((a) => a.id === "showOutput"),
        `${name}: the digests are channel-only, so the channel must be one ` +
          `click away — and "retry" is caller-handled, so notifyAsync strips ` +
          `it and this would otherwise be a dead-end toast`,
      );
    }
  });

  test(`${surface}: a refused download does not claim an installed copy is broken`, async () => {
    for (const [name, error] of Object.entries(REFUSALS)) {
      const plan = await planFor(error);
      assert.doesNotMatch(
        plan.message,
        /installed copy looks broken/,
        `${name}: nothing was installed — and an already-installed good copy ` +
          `is deliberately left untouched (see the "leaves an already-` +
          `installed binary untouched" case in alpCli.downloadChecksum)`,
      );
      assert.doesNotMatch(
        plan.message,
        /back online/,
        `${name}: the transfer worked; this is a refusal, not an outage`,
      );
      assert.equal(
        plan.message,
        error.message,
        `${name}: the refusal sentence has to survive to the toast`,
      );
    }
  });

  test(`${surface}: the three refusals stay three different sentences`, async () => {
    const messages = [];
    for (const error of Object.values(REFUSALS)) {
      messages.push((await planFor(error)).message);
    }
    assert.equal(
      new Set(messages).size,
      3,
      `a customer who cannot tell "the bytes were wrong" from "we could not ` +
        `find out whether they were" has no idea what to do next:\n${messages.join("\n")}`,
    );
  });

  test(`${surface}: the digests reach the channel, never the toast`, async () => {
    const plan = await planFor(REFUSALS.mismatch);
    assert.match(
      plan.detail,
      /published digest is bbbb/,
      "the digests belong on the output channel",
    );
    assert.doesNotMatch(plan.message, /bbbb/);
  });
}

test("a NON-checksum resolution failure is untouched by any of this", async () => {
  // The regression guard for the new branch: `notInstalled` must still offer
  // Install, and `corrupt` must still keep its settings button — the refusal
  // case is carved out of `corrupt`, not layered over every reason.
  const plan = await envelopePlanFor(new Error("spawn tan ENOENT"));
  assert.match(plan.message, /isn't installed yet/);
  assert.ok(plan.actions.some((a) => a.id === "installTanCli"));
});
