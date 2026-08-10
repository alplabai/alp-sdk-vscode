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
// Prints a single line to stdout: "<pre-release|stable> <minor>". The
// caller's shell reads both fields (`read -r CHANNEL MINOR <<< "$(...)"`)
// rather than re-deriving either one from package.json a second time.

import { readFileSync } from "node:fs";

const packageJsonUrl = new URL("../package.json", import.meta.url);
const { version } = JSON.parse(readFileSync(packageJsonUrl, "utf-8"));
const minor = Number(version.split(".")[1]);

if (!Number.isInteger(minor)) {
  console.error(
    `::error::Could not resolve a minor version from package.json version "${version}"`,
  );
  process.exit(1);
}

console.log(`${minor % 2 === 1 ? "pre-release" : "stable"} ${minor}`);
