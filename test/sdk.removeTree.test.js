// SPDX-License-Identifier: Apache-2.0
//
// Deleting an installed SDK, and telling the two failures apart.
//
// The bug: `fs.rmSync(target, { recursive: true, force: true })` fails on
// Windows for an SDK installed with `git clone`, because git writes its pack
// and object files with the read-only attribute and `force` only swallows
// `ENOENT`. It failed EVERY time, deterministically — while the panel told the
// user to "close anything using it", advice that cannot work for that cause.
//
// These tests run on the developer's real filesystem rather than a mock,
// because the bug IS filesystem behaviour and a mock would only assert the
// shape of the fix. POSIX makes that possible: unlinking a file needs write
// permission on its DIRECTORY, not on the file, so a directory at mode 0500
// reproduces the same class of failure on macOS and Linux that a read-only
// attribute produces on Windows — and is fixed by the same pass.
//
// Skipped as root, who bypasses permission checks entirely and would make
// every "this should fail first" arrangement silently succeed — a green run
// that proved nothing.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  removeSdkTree,
  removalFailureMessage,
} = require("../out/sdk/removeTree.js");

/** Root bypasses mode bits, so the read-only arrangements below cannot fail
 *  and the tests that depend on them would pass without exercising anything. */
const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;
const skipAsRoot = IS_ROOT
  ? { skip: "runs as root, which bypasses the permission checks under test" }
  : {};

function tmpTree() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "alp-sdk-remove-"));
}

/** An SDK as it actually lands on disk: a clone, so a `.git` tree with objects
 *  in it. On Windows those objects are read-only; here the DIRECTORY is made
 *  read-only, which blocks the unlink the same way. */
function fakeSdkInstall() {
  const root = tmpTree();
  const objects = path.join(root, ".git", "objects", "pack");
  fs.mkdirSync(objects, { recursive: true });
  fs.writeFileSync(path.join(objects, "pack-abc123.pack"), "binary");
  fs.writeFileSync(path.join(root, "west.yml"), "manifest:\n");
  fs.mkdirSync(path.join(root, "metadata"));
  fs.writeFileSync(path.join(root, "metadata", "catalog.json"), "{}");
  return { root, objects };
}

// ---------------------------------------------------------------------------
// The ordinary path
// ---------------------------------------------------------------------------

test("a writable tree is removed, and nothing needed clearing", () => {
  // Arrange
  const { root } = fakeSdkInstall();

  // Act
  const result = removeSdkTree(root);

  // Assert
  assert.equal(result.ok, true);
  assert.equal(
    result.clearedAttributes,
    false,
    "the attribute pass must not run when the first attempt already worked",
  );
  assert.equal(fs.existsSync(root), false);
});

test("removing something already gone succeeds", () => {
  // Arrange -- `force: true` swallows ENOENT, and it should keep doing so: a
  // second Remove click after a successful one must not raise an error.
  const root = tmpTree();
  fs.rmSync(root, { recursive: true, force: true });

  // Act / Assert
  assert.deepEqual(removeSdkTree(root), { ok: true, clearedAttributes: false });
});

// ---------------------------------------------------------------------------
// The bug
// ---------------------------------------------------------------------------

test(
  "a read-only directory in the tree no longer defeats the delete",
  skipAsRoot,
  () => {
    // Arrange -- THE regression. This is git's `.git/objects/pack` as Windows
    // leaves it; here the write bit is off on the directory, which is what
    // unlinking the pack file actually needs.
    const { root, objects } = fakeSdkInstall();
    fs.chmodSync(objects, 0o500);

    // A bare rmSync is what shipped before, and it must be shown to fail —
    // otherwise this test would pass on a platform where the arrangement is
    // not actually blocking anything, and prove nothing at all.
    assert.throws(
      () => fs.rmSync(root, { recursive: true, force: true }),
      "the arrangement is not reproducing the failure, so the fix is untested",
    );

    // Act
    const result = removeSdkTree(root);

    // Assert
    assert.equal(result.ok, true, `expected success, got ${result.error}`);
    assert.equal(
      result.clearedAttributes,
      true,
      "the attribute pass is what made this work and must be reported",
    );
    assert.equal(fs.existsSync(root), false);
  },
);

test(
  "a read-only tree several levels deep is cleared all the way down",
  skipAsRoot,
  () => {
    // Arrange -- the walk has to be recursive. A single chmod on the root
    // would clear the top and still trip on `.git/objects/pack`.
    const { root, objects } = fakeSdkInstall();
    fs.chmodSync(objects, 0o500);
    fs.chmodSync(path.join(root, ".git", "objects"), 0o500);
    fs.chmodSync(path.join(root, ".git"), 0o500);
    fs.chmodSync(path.join(root, "metadata"), 0o500);

    // Act
    const result = removeSdkTree(root);

    // Assert
    assert.equal(result.ok, true, `expected success, got ${result.error}`);
    assert.equal(fs.existsSync(root), false);
  },
);

test("a symlink inside the tree is not followed out of it", skipAsRoot, () => {
  // Arrange -- `fs.chmodSync` FOLLOWS a symlink (measured: a link to a 0500
  // directory, chmod'ed to 0600, moves the TARGET to 0600). So an attribute
  // pass without a guard silently rewrites the mode of a directory outside the
  // tree it was asked to delete.
  //
  // Reaching that guard takes care, and two earlier versions of this test did
  // not: `rmSync` unlinks the symlink on its FIRST pass and only then fails on
  // the read-only directory, so by the time `clearReadOnly` walks, the link is
  // already gone and the guard is never exercised. The link therefore lives in
  // a subdirectory with no write bit — `rmSync` cannot unlink it there, so it
  // survives into the attribute pass, which is the only arrangement that puts
  // the guard under test at all.
  const { root } = fakeSdkInstall();
  const outside = tmpTree();
  const guarded = path.join(outside, "keep-me");
  fs.mkdirSync(guarded);
  fs.chmodSync(guarded, 0o500);
  fs.chmodSync(outside, 0o500);
  const targetBefore = fs.statSync(outside).mode;
  const childBefore = fs.statSync(guarded).mode;

  const locked = path.join(root, "locked");
  fs.mkdirSync(locked);
  fs.symlinkSync(outside, path.join(locked, "link-to-elsewhere"));
  fs.chmodSync(locked, 0o500);

  // The link must still be there when the attribute pass runs, or this test
  // proves nothing about the guard.
  assert.throws(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(
    fs.existsSync(path.join(locked, "link-to-elsewhere")),
    true,
    "the link was already unlinked, so the guard would never be reached",
  );

  // Act
  const result = removeSdkTree(root);

  // Assert
  assert.equal(result.ok, true, `expected success, got ${result.error}`);
  assert.equal(
    result.clearedAttributes,
    true,
    "the attribute pass must have run, or this test proves nothing",
  );
  assert.equal(
    (fs.statSync(outside).mode & 0o777).toString(8),
    (targetBefore & 0o777).toString(8),
    "chmod follows a symlink, so the LINK TARGET's mode must be untouched",
  );
  assert.equal(
    (fs.statSync(guarded).mode & 0o777).toString(8),
    (childBefore & 0o777).toString(8),
    "nothing under the link target may be touched either",
  );
  assert.equal(
    fs.existsSync(outside),
    true,
    "removing the SDK must not remove what a link pointed at",
  );

  // Cleanup
  fs.chmodSync(outside, 0o700);
  fs.chmodSync(guarded, 0o700);
  fs.rmSync(outside, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// When it genuinely cannot be done
// ---------------------------------------------------------------------------

test(
  "a failure this process cannot fix is reported, not silently swallowed",
  skipAsRoot,
  () => {
    // Arrange -- the PARENT is read-only, so the tree itself can never be
    // unlinked no matter what is chmod'ed inside it. That models the residual
    // case: everything changeable was changed and it still failed.
    const parent = tmpTree();
    const target = path.join(parent, "v0.15.0");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "west.yml"), "manifest:\n");
    fs.chmodSync(parent, 0o500);

    try {
      // Act
      const result = removeSdkTree(target);

      // Assert
      assert.equal(result.ok, false);
      assert.equal(
        result.clearedAttributes,
        true,
        "the retry must have been attempted before giving up",
      );
      assert.ok(
        ["in-use", "permission", "other"].includes(result.cause),
        `unexpected cause ${result.cause}`,
      );
      assert.ok(result.error, "the raw error must survive for the channel");
    } finally {
      // Cleanup -- restore the parent so the temp dir can be removed.
      fs.chmodSync(parent, 0o700);
      fs.rmSync(parent, { recursive: true, force: true });
    }
  },
);

// ---------------------------------------------------------------------------
// The advice
// ---------------------------------------------------------------------------

test("each cause gets advice that can actually work for THAT cause", () => {
  // Arrange -- the whole point of classifying. The old message told every
  // failure to close an editor, which is useless for a read-only attribute and
  // is what sent users looking in the wrong place.
  const inUse = removalFailureMessage("in-use");
  assert.match(inUse, /Close any editor, terminal or build/);

  const permission = removalFailureMessage("permission");
  assert.match(permission, /permissions/);
  assert.ok(
    !/Close any editor/.test(permission),
    "a permissions problem must not be blamed on an open editor",
  );

  const other = removalFailureMessage("other");
  assert.match(other, /output channel/);
});

test("every cause has a message — none falls through to undefined", () => {
  // Arrange -- a new cause added without a sentence would render `undefined`
  // in a toast.
  for (const cause of ["in-use", "permission", "other"]) {
    const message = removalFailureMessage(cause);
    assert.equal(typeof message, "string");
    assert.ok(message.length > 40, `${cause} has no real sentence`);
  }
});
