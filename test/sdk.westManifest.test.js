const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  inspectWestManifest,
  westManifestLogLine,
  westManifestWarning,
} = require("../packages/alp-core/dist/sdk/service.js");

const p = path.posix;
const TOP = "/home/hakan/.alp/sdk";

/**
 * Build the injected adapters for one fixture workspace.
 * `present` lists the paths that exist; `config` is the `.west/config` body
 * (null means the file itself is absent).
 */
function fixture(present, config) {
  const exists = new Set(present);
  return {
    pathExists: (candidate) => exists.has(candidate),
    readFile: (candidate) => {
      if (candidate !== p.join(TOP, ".west", "config") || config === null) {
        throw new Error(`unexpected read of ${candidate}`);
      }
      return config;
    },
  };
}

/** Inspect TOP with a `.west/` + `.west/config` present and the given body. */
function inspect(config, extraPresent = []) {
  const { pathExists, readFile } = fixture(
    [p.join(TOP, ".west"), p.join(TOP, ".west", "config"), ...extraPresent],
    config,
  );
  return inspectWestManifest(TOP, pathExists, readFile, p);
}

test("resolves a live manifest target", () => {
  const status = inspect("[manifest]\npath = v0.13.0\nfile = west.yml\n", [
    p.join(TOP, "v0.13.0"),
  ]);
  assert.equal(status.state, "ok");
  assert.equal(status.manifestPath, "v0.13.0");
  assert.equal(status.resolvedPath, `${TOP}/v0.13.0`);
  assert.equal(westManifestWarning(status), null);
  assert.equal(westManifestLogLine(status), null);
});

test("flags the stranded manifest reported in issue #349", () => {
  // The report verbatim: `.west/config` names v0.11.0, only v0.13.0 is on disk.
  const status = inspect(
    "[manifest]\npath = v0.11.0\nfile = west.yml\n\n[zephyr]\nbase = zephyr\n",
    [p.join(TOP, "v0.13.0")],
  );
  assert.equal(status.state, "dangling");
  assert.equal(status.manifestPath, "v0.11.0");
  assert.equal(status.resolvedPath, `${TOP}/v0.11.0`);
  assert.match(westManifestWarning(status), /v0\.11\.0/);
  assert.match(westManifestLogLine(status), /v0\.11\.0/);
});

test("a CRLF config is not a false dangling", () => {
  const status = inspect(
    "[manifest]\r\npath = v0.13.0\r\nfile = west.yml\r\n",
    [p.join(TOP, "v0.13.0")],
  );
  // Splitting on /\n/ alone would resolve "v0.13.0\r" and report dangling.
  assert.equal(status.state, "ok");
  assert.equal(status.manifestPath, "v0.13.0");
});

test("option keys are case-insensitive, like configparser", () => {
  // configparser's optionxform lowercases KEYS: `Path` really is `path`.
  const status = inspect("[manifest]\nPath = v0.13.0\n", [
    p.join(TOP, "v0.13.0"),
  ]);
  assert.equal(status.state, "ok");
  assert.equal(status.manifestPath, "v0.13.0");
});

test("section names are case-SENSITIVE, like configparser", () => {
  // Verified against CPython: ConfigParser().read_string("[Manifest]\n...")
  // yields sections ['Manifest'] and get("manifest", ...) raises NoSectionError.
  // west therefore never reads this value, so neither may we — reporting
  // dangling here would be a scary toast about a path west never resolves.
  const status = inspect("[Manifest]\npath = v0.11.0\n", [
    p.join(TOP, "v0.13.0"),
  ]);
  assert.equal(status.state, "unparsable");
  assert.equal(status.manifestPath, null);
  assert.equal(westManifestWarning(status), null);
});

test("a colon delimiter is accepted, and a drive-letter value survives it", () => {
  const status = inspect("[manifest]\npath: v0.13.0\n", [
    p.join(TOP, "v0.13.0"),
  ]);
  assert.equal(status.state, "ok");
  assert.equal(status.manifestPath, "v0.13.0");
});

test("an absolute manifest path replaces the topdir", () => {
  // p.resolve semantics, not p.join — /elsewhere/mani must not become
  // /home/hakan/.alp/sdk/elsewhere/mani.
  const status = inspect("[manifest]\npath = /elsewhere/mani\n", [
    "/elsewhere/mani",
  ]);
  assert.equal(status.state, "ok");
  assert.equal(status.resolvedPath, "/elsewhere/mani");
});

test("an inline comment is part of the value, like configparser", () => {
  // configparser ships with inline comments DISABLED, so west really does look
  // for a directory named "v0.13.0 # old". Reporting dangling is truthful.
  const status = inspect("[manifest]\npath = v0.13.0 # old\n", [
    p.join(TOP, "v0.13.0"),
  ]);
  assert.equal(status.state, "dangling");
  assert.equal(status.manifestPath, "v0.13.0 # old");
});

test("a whole-line comment is still a comment", () => {
  const status = inspect(
    "[manifest]\n# path = v0.11.0\n; path = v0.12.0\npath = v0.13.0\n",
    [p.join(TOP, "v0.13.0")],
  );
  assert.equal(status.state, "ok");
  assert.equal(status.manifestPath, "v0.13.0");
});

test("a path key outside [manifest] is never used", () => {
  const status = inspect("[zephyr]\npath = v0.13.0\n", [
    p.join(TOP, "v0.13.0"),
  ]);
  assert.equal(status.state, "unparsable");
  assert.equal(status.manifestPath, null);
});

test("duplicate manifest sections are refused, not guessed", () => {
  const status = inspect(
    "[manifest]\npath = v0.11.0\n[manifest]\npath = v0.13.0\n",
    [p.join(TOP, "v0.13.0")],
  );
  assert.equal(status.state, "unparsable");
  assert.equal(westManifestWarning(status), null);
});

test("a duplicate path key inside [manifest] is refused, not guessed", () => {
  const status = inspect("[manifest]\npath = v0.11.0\npath = v0.13.0\n", [
    p.join(TOP, "v0.13.0"),
  ]);
  assert.equal(status.state, "unparsable");
});

test("an empty path value is not a silent ok", () => {
  // p.resolve(TOP, "") is TOP itself, which exists — that would report ok.
  const status = inspect("[manifest]\npath =\n", [TOP]);
  assert.equal(status.state, "unparsable");
});

test("a missing [manifest] path key is bootstrap's problem, not a warning", () => {
  const status = inspect("[zephyr]\nbase = zephyr\n");
  assert.equal(status.state, "unparsable");
  assert.equal(westManifestWarning(status), null);
});

test("no .west means no workspace, and the config is never read", () => {
  const { pathExists } = fixture([], null);
  const status = inspectWestManifest(
    TOP,
    pathExists,
    () => {
      throw new Error("readFile must not be called without a .west directory");
    },
    p,
  );
  assert.equal(status.state, "no-workspace");
  assert.equal(westManifestWarning(status), null);
});

test("a .west directory with no config is unparsable, not dangling", () => {
  const { pathExists } = fixture([p.join(TOP, ".west")], null);
  const status = inspectWestManifest(TOP, pathExists, () => "", p);
  assert.equal(status.state, "unparsable");
  assert.equal(westManifestWarning(status), null);
});

test("an unreadable config is unparsable, never a throw", () => {
  const { pathExists } = fixture(
    [p.join(TOP, ".west"), p.join(TOP, ".west", "config")],
    "",
  );
  const status = inspectWestManifest(
    TOP,
    pathExists,
    () => {
      throw new Error("EACCES");
    },
    p,
  );
  assert.equal(status.state, "unparsable");
});
