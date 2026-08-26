// SPDX-License-Identifier: Apache-2.0
//
// The SDK Manager's release list has to load as a list, and the two kinds of
// "wait" in this view must not be confused for each other.
//
// Before this, `releases === null` rendered one `<Spinner />` and the line
// "Loading SDK list…". Nothing was wrong with it except its shape: a single
// row standing in for a list of cards, so the section jumped every time the
// releases arrived. The placeholders reuse `.releaseCard`, which is what makes
// the real rows land where the eye is already looking.
//
// The distinction the last arm pins is the one worth keeping: a SPINNER means
// work is happening now and the log line beside it is the progress (an install
// in flight); a SKELETON means content is on its way and will occupy this
// space. Replacing the install spinner with a skeleton would claim an install
// has no progress to report, and replacing a skeleton with a spinner throws
// away the shape it exists to reserve.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "packages", "alp-webview", "src");
const SDK_REL = "features/sdk/SdkView.tsx";
const src = fs.readFileSync(path.join(SRC, SDK_REL), "utf8");

/** The JSX of the branch taken while the release list has not arrived. */
function pendingBranch() {
  const at = src.indexOf("{releases === null ? (");
  assert.ok(at !== -1, "the `releases === null` branch is gone");
  const end = src.indexOf(") : rows.length === 0 ?", at);
  assert.ok(
    end !== -1,
    "the branch's empty-list arm moved — landmark is stale",
  );
  return src.slice(at, end);
}

test("a pending release list draws row placeholders, not a spinner", () => {
  const branch = pendingBranch();
  assert.ok(
    /SdkRowSkeleton/.test(branch),
    "the pending branch draws no SdkRowSkeleton. A list that is coming should " +
      "reserve the shape it will occupy.",
  );
  assert.ok(
    !/<Spinner/.test(branch),
    "the pending branch is back to a spinner. One spinning row standing in " +
      "for a list of cards is what made the section jump on arrival.",
  );
});

test("the placeholders reuse the real row's geometry", () => {
  const at = src.indexOf("function SdkRowSkeleton");
  assert.ok(at !== -1, "SdkRowSkeleton is gone");
  const body = src.slice(at, src.indexOf("function SdkRowCard"));
  for (const cls of ["styles.releaseCard", "styles.releaseCardHead"]) {
    assert.ok(
      body.includes(cls),
      `the placeholder no longer uses ${cls}. Its whole purpose is that the ` +
        "real rows land on the same geometry; a bespoke size makes the " +
        "section jump, which is the defect this replaced.",
    );
  }
  assert.ok(
    /aria-hidden="true"/.test(body),
    "the placeholder row is not aria-hidden, so a screen reader reads three " +
      "empty cards instead of the one status message on the list.",
  );
});

test("the pending list announces itself once", () => {
  const branch = pendingBranch();
  assert.ok(
    /role="status"/.test(branch) &&
      /aria-label="Loading the SDK list"/.test(branch),
    "the pending list lost its single role=status announcement.",
  );
});

test("an install in flight still shows a spinner, not a skeleton", () => {
  const at = src.indexOf("{installActive && (");
  assert.ok(at !== -1, "the install-progress block is gone");
  const block = src.slice(at, src.indexOf("{releases === null ? (", at));
  assert.ok(
    /<Spinner/.test(block),
    "the install-progress block no longer spins. A spinner there is correct " +
      "and deliberate: an install is work happening now, with a live log line " +
      "beside it — not content whose shape can be reserved.",
  );
  assert.ok(
    !/Skeleton/.test(block),
    "the install-progress block was turned into a skeleton. That claims an " +
      "install has a known shape and no progress to report; it has the " +
      "opposite of both.",
  );
});
