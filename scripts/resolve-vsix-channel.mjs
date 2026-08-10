#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Single source for the VS Code Marketplace publish-channel parity rule that
// BOTH release-vsix.yml packaging jobs (`package_and_publish`, the universal
// VSIX, and `package_darwin_arm64`, the bundled-CLI VSIX) follow: an ODD
// minor version (0.3.x, 0.5.x) publishes `--pre-release`; an EVEN minor
// (0.4.x, 1.0.x) publishes stable. `package_darwin_arm64` used to hardcode
// "always --pre-release" instead of this rule — a second, independent copy
// of the same decision is exactly how that drifted from the universal job's
// convention. Both jobs now call this one script instead of each carrying
// their own `minor % 2` arithmetic, so the rule itself lives in exactly one
// place.
//
// Prints a single line to stdout: "<pre-release|stable> <major> <minor>". The
// caller's shell reads all three fields rather than re-deriving any of them
// from package.json a second time; `major` exists so the workflow's ::notice::
// can name the real version instead of a hardcoded "0.".
//
// CALLER CONTRACT: assign the output to a variable FIRST, then `read` from it.
// `read -r ... <<< "$(node scripts/resolve-vsix-channel.mjs)"` returns 0 even
// when this script exits 1 -- the here-string is merely empty -- so `set -e`
// would not fire and an empty CHANNEL would fall through to whatever the
// caller's else-branch does. Publishing a pre-release build to the STABLE
// Marketplace channel that way is unrecoverable: the tag is spent and the
// version cannot be republished.

import { readFileSync } from "node:fs";

const packageJsonUrl = new URL("../package.json", import.meta.url);
const { version } = JSON.parse(readFileSync(packageJsonUrl, "utf-8"));
// Test the TEXT, not the Number: `Number("")` is 0, so a version like "0..2"
// would otherwise pass `Number.isInteger` and resolve to a channel instead of
// failing loudly the way this guard exists to.
const [majorText = "", minorText = ""] = String(version).split(".");
const DIGITS = /^\d+$/;
const major = DIGITS.test(majorText) ? Number(majorText) : NaN;
const minor = DIGITS.test(minorText) ? Number(minorText) : NaN;

if (!Number.isInteger(major) || !Number.isInteger(minor)) {
  console.error(
    `::error::Could not resolve a major.minor version from package.json version "${version}"`,
  );
  process.exit(1);
}

console.log(`${minor % 2 === 1 ? "pre-release" : "stable"} ${major} ${minor}`);
