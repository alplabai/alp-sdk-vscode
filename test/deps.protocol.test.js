// SPDX-License-Identifier: Apache-2.0
//
// The hand-synced protocol pair. `src/ideHub/messages.ts` and
// `packages/alp-webview/src/types.ts` are two separate builds describing ONE
// wire format, kept in step by hand — so nothing but a test notices when they
// drift. It reads both as TEXT on purpose: `types.ts` is never compiled into
// `out/`, so a structural check would only ever see the host half.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const HOST = path.join(ROOT, "src", "ideHub", "messages.ts");
const MIRROR = path.join(ROOT, "packages", "alp-webview", "src", "types.ts");
const CORE_FIX_IDS = path.join(
  ROOT,
  "packages",
  "alp-core",
  "src",
  "toolchain",
  "bootstrapPlan.ts",
);

const read = (p) => fs.readFileSync(p, "utf8");

/** The quoted members of `export type <name> = "a" | "b";`. */
function unionMembers(source, typeName, file) {
  const match = new RegExp(
    `export type ${typeName}\\s*=([\\s\\S]*?);`,
    "m",
  ).exec(source);
  assert.ok(match, `no \`export type ${typeName}\` in ${file}`);
  return new Set(Array.from(match[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]));
}

// ---------------------------------------------------------------------------
// The dependency panel's three messages
// ---------------------------------------------------------------------------

// One push down, one refresh up, one run-action up. The action message carries
// the ROW ID, never a command string — a webview that hands the host something
// to execute is a command-injection seam.
const DEPENDENCY_MESSAGES = [
  "dependencyReport",
  "refreshDependencies",
  "runDependencyAction",
];

test("every dependency message name is declared on BOTH sides", () => {
  const host = read(HOST);
  const mirror = read(MIRROR);
  for (const name of DEPENDENCY_MESSAGES) {
    const discriminant = `type: "${name}"`;
    assert.ok(
      host.includes(discriminant),
      `src/ideHub/messages.ts declares no \`${discriminant}\``,
    );
    assert.ok(
      mirror.includes(discriminant),
      `packages/alp-webview/src/types.ts declares no \`${discriminant}\` — ` +
        `the mirror has drifted from the host protocol`,
    );
  }
});

test("runDependencyAction carries a row id, not a command string", () => {
  for (const [file, source] of [
    [HOST, read(HOST)],
    [MIRROR, read(MIRROR)],
  ]) {
    const match = /interface RunDependencyActionMessage \{([\s\S]*?)\}/m.exec(
      source,
    );
    assert.ok(match, `no RunDependencyActionMessage in ${file}`);
    assert.ok(
      /\bname: string;/.test(match[1]),
      `${file}: RunDependencyActionMessage must carry the row \`name\``,
    );
    assert.ok(
      !/\bcommand\b/.test(match[1]),
      `${file}: RunDependencyActionMessage must NOT carry a command string — ` +
        `the host resolves the row id against the report it sent`,
    );
  }
});

// ---------------------------------------------------------------------------
// ToolchainFixId — core is the source of truth, the mirror must match it
// ---------------------------------------------------------------------------

test("every ToolchainFixId member declared in core appears in the mirror", () => {
  const core = unionMembers(
    read(CORE_FIX_IDS),
    "ToolchainFixId",
    "packages/alp-core/src/toolchain/bootstrapPlan.ts",
  );
  const mirror = unionMembers(
    read(MIRROR),
    "ToolchainFixId",
    "packages/alp-webview/src/types.ts",
  );
  for (const member of core) {
    assert.ok(
      mirror.has(member),
      `ToolchainFixId "${member}" is emitted by core but missing from the ` +
        `webview mirror — a dependency row's Fix action would not type-check`,
    );
  }
  for (const member of mirror) {
    assert.ok(
      core.has(member),
      `ToolchainFixId "${member}" is in the webview mirror but no longer ` +
        `exists in core — the mirror is stale`,
    );
  }
});

// ---------------------------------------------------------------------------
// The retired Toolchain Doctor protocol
// ---------------------------------------------------------------------------

// Removing a message is a BREAKING protocol change: an old webview still
// posting `runToolchainFix` must be told to reload, not silently ignored. The
// version bump is what tells it.
test("PROTOCOL_VERSION is identical on both sides", () => {
  const re = /PROTOCOL_VERSION = (\d+) as const;/;
  const host = re.exec(read(HOST));
  const mirror = re.exec(read(MIRROR));
  assert.ok(host, "no PROTOCOL_VERSION literal in src/ideHub/messages.ts");
  assert.ok(mirror, "no PROTOCOL_VERSION literal in the webview mirror");
  assert.equal(
    mirror[1],
    host[1],
    "PROTOCOL_VERSION drifted between the host and the webview mirror",
  );
});

test("the Toolchain Doctor messages are gone from BOTH sides", () => {
  for (const [file, source] of [
    [HOST, read(HOST)],
    [MIRROR, read(MIRROR)],
  ]) {
    for (const name of [
      "toolchainReport",
      "reloadToolchain",
      "runToolchainFix",
    ]) {
      assert.ok(
        !source.includes(`type: "${name}"`),
        `${file} still declares the retired message \`${name}\` — the ` +
          `Toolchain Doctor panel was replaced by the dependency panel`,
      );
    }
  }
});
