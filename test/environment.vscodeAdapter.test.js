const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  danglingWestManifest,
  westWorkspaceCandidates,
  westWorkspaceInitialized,
} = require("../out/environment/vscodeAdapter.js");

/**
 * A real on-disk SDK root under a fresh temp topdir carrying the given
 * `.west/config` body. Returns the SDK root, which is what the production
 * callers pass — `danglingWestManifest` derives the topdir from it and looks
 * at nothing else, so the host's own `~/zephyrproject` or an ambient
 * `$ZEPHYR_BASE` can never decide these outcomes.
 */
function sdkUnderWestTopdir(tag, config, sdkName = "v0.13.0") {
  const topdir = fs.mkdtempSync(path.join(os.tmpdir(), `alp-west-${tag}-`));
  fs.mkdirSync(path.join(topdir, ".west"), { recursive: true });
  fs.writeFileSync(path.join(topdir, ".west", "config"), config);
  const sdkRoot = path.join(topdir, sdkName);
  fs.mkdirSync(sdkRoot);
  test.after(() => fs.rmSync(topdir, { recursive: true, force: true }));
  return { topdir, sdkRoot };
}

test("westWorkspaceCandidates offers <sdk-parent> (the v0.11 bootstrap topdir)", () => {
  const sdkRoot = path.join(path.sep, "opt", "alp", "sdk");
  const sdkParent = path.dirname(sdkRoot);
  const candidates = westWorkspaceCandidates(null, sdkRoot);

  assert.ok(
    candidates.includes(sdkParent),
    "<sdk-parent> must be a candidate topdir",
  );
  // Must precede the legacy isolated layout, mirroring the Rust half's order.
  assert.ok(
    candidates.indexOf(sdkParent) <
      candidates.indexOf(path.join(sdkParent, "zephyrproject")),
    "<sdk-parent> must precede <sdk-parent>/zephyrproject",
  );
});

test("danglingWestManifest reports the SDK topdir's pruned manifest target", () => {
  // Issue #349 verbatim: `.west/config` still names v0.11.0 after it was
  // removed, while only v0.13.0 remains under the same topdir.
  const { topdir, sdkRoot } = sdkUnderWestTopdir(
    "dangling",
    "[manifest]\npath = v0.11.0\nfile = west.yml\n",
  );

  const status = danglingWestManifest(sdkRoot);
  assert.ok(status, "the pruned manifest target must be reported");
  assert.equal(status.state, "dangling");
  assert.equal(status.manifestPath, "v0.11.0");
  assert.equal(status.topdir, topdir);
});

test("danglingWestManifest stays silent when the manifest resolves", () => {
  const { sdkRoot } = sdkUnderWestTopdir(
    "ok",
    "[manifest]\npath = v0.13.0\nfile = west.yml\n",
  );
  assert.equal(danglingWestManifest(sdkRoot), null);
});

test("danglingWestManifest stays silent on an unparsable config", () => {
  const { sdkRoot } = sdkUnderWestTopdir(
    "unparsable",
    "[zephyr]\nbase = zephyr\n",
  );
  assert.equal(danglingWestManifest(sdkRoot), null);
});

test("danglingWestManifest ignores workspaces the SDK does not own", () => {
  // The scary "builds and flashes will use the wrong workspace" line must not
  // fire for a stale ~/zephyrproject or an ambient $ZEPHYR_BASE tree — the
  // extension never invalidated those. With no SDK root there is no topdir to
  // report, whatever else is broken on this host.
  assert.equal(danglingWestManifest(null), null);
});

test("a workspace whose manifest resolves counts as initialized", () => {
  const { topdir } = sdkUnderWestTopdir(
    "init-ok",
    "[manifest]\npath = v0.13.0\nfile = west.yml\n",
  );
  assert.equal(westWorkspaceInitialized(null, null, [topdir]), true);
});

test("an unparsable config is never demoted to uninitialized", () => {
  // Parse ambiguity must not flip nine readiness surfaces to "setup required".
  const { topdir } = sdkUnderWestTopdir(
    "init-unparsable",
    "[zephyr]\nbase = zephyr\n",
  );
  assert.equal(westWorkspaceInitialized(null, null, [topdir]), true);
});

test("a workspace whose only candidate dangles is NOT initialized", () => {
  // The one behaviour this tightens: before #349 a bare `.west`-exists probe
  // returned true here, which is what let a broken workspace read as ready.
  const { topdir } = sdkUnderWestTopdir(
    "init-dangling",
    "[manifest]\npath = v0.11.0\n",
  );
  assert.equal(westWorkspaceInitialized(null, null, [topdir]), false);
});

test("a healthy candidate still wins over a dangling one", () => {
  // Demote, never disqualify: a legitimate $ZEPHYR_BASE workspace later in the
  // list must still satisfy the probe.
  const broken = sdkUnderWestTopdir(
    "init-mixed-bad",
    "[manifest]\npath = v0.11.0\n",
  );
  const healthy = sdkUnderWestTopdir(
    "init-mixed-good",
    "[manifest]\npath = v0.13.0\n",
  );
  assert.equal(
    westWorkspaceInitialized(null, null, [broken.topdir, healthy.topdir]),
    true,
  );
});
