#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Resolve, checksum-verify, and stage the `tan` CLI for one host into a
// directory shaped exactly like the extension's `bundled` resolver expects
// (`<dest>/<binaryName>`, with any archive support tree — e.g. a PyInstaller
// onedir release's `_internal/` — as siblings beside it, never inside a
// nested folder). See `src/alpCli/vscodeAdapter.ts`'s `bundledBinaryPath`
// (`<extensionPath>/bin/<binaryName>`) and `adapterCore.ts`'s `bundled` arm.
//
// This is the ONE place a workflow asks "what does the pinned tan-cli release
// actually publish for this host" — `release-vsix.yml`'s `package_darwin_arm64`
// job and `ci.yml`'s darwin smoke step both call this script instead of each
// constructing its own asset URL. A hand-rolled `tan-<triple>` URL is exactly
// how the two drifted before: tan-cli#349 moved the asset from a raw binary
// to a `.tar.gz`/`.zip` archive, `src/alpCli/service.ts` (`releaseAssetForTarget`)
// and `src/alpCli/download.ts` (`resolvePublishedAsset`, `downloadFile`) were
// updated for it, and both workflows kept requesting the old raw name — a
// 404 on the darwin release job, a silently-skipped smoke test in ci.yml (it
// reads a 404 as "not published yet" and moves on). Routing both callers
// through the SAME resolver + downloader the extension itself runs at
// activation means there is exactly one place that knows the asset-name
// convention, and `scripts/check-cli-pin.mjs` (which already probes both
// candidate names via the same `releaseAssetForTarget`) can never again
// disagree with what a workflow actually requests.
//
// Usage:
//   node scripts/stage-tan-cli-asset.mjs --platform <p> --arch <a> --dest <dir> [--version X.Y.Z[-pre]]
//
// `--version` defaults to the compiled `SUPPORTED_CLI_VERSION` pin
// (`out/alpCli/service.js`) when omitted; pass it explicitly to reuse a
// version a caller already resolved by other means (both workflows already
// grep it once for their own `::notice::` lines — see
// `test/cliPin.prerelease.test.js`'s SITES list, which pins that grep).
//
// Exit codes:
//   0  staged: <dest>/<binaryName> (+ any archive siblings) is ready to run.
//   1  fatal — a real defect: the checksum didn't match, the transfer failed,
//      the archive didn't contain a launcher, or checksums.txt itself could
//      not be fetched (distinct from "no entry in it" — see kind 2, but the
//      pinned release/tag not existing at all should already have failed
//      check-cli-pin.mjs earlier in both workflows, so reaching this is a
//      surprise, not an expected gap).
//   2  no asset published for this host under this pin — either
//      HOSTS_WITHOUT_RELEASE_ASSET (src/alpCli/service.ts) declares it, or the
//      release's own checksums.txt lists neither candidate name. A caller that
//      wants this non-fatal (ci.yml's smoke test, which must not redden a PR
//      over a host this pin legitimately doesn't cover) checks for exit 2
//      SPECIFICALLY and turns it into a loud, named skip — never a silent one,
//      which is the defect this whole script exists to close. A caller
//      shipping a release artefact (release-vsix.yml) must NOT special-case
//      this: no asset means the VSIX would ship broken, so it stays fatal by
//      simply not catching it.

import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

const require = createRequire(import.meta.url);
const {
  releaseAssetForTarget,
  binaryName,
} = require("../out/alpCli/service.js");
const {
  resolvePublishedAsset,
  downloadFile,
  ChecksumError,
} = require("../out/alpCli/download.js");

const NO_ASSET_EXIT = 2;
const FATAL_EXIT = 1;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (
      flag === "--platform" ||
      flag === "--arch" ||
      flag === "--dest" ||
      flag === "--version"
    ) {
      args[flag.slice(2)] = value;
      i += 1;
    } else {
      console.error(
        `::error::stage-tan-cli-asset.mjs: unknown argument '${flag}'.`,
      );
      process.exit(FATAL_EXIT);
    }
  }
  for (const required of ["platform", "arch", "dest"]) {
    if (!args[required]) {
      console.error(
        `::error::stage-tan-cli-asset.mjs: --${required} is required.`,
      );
      process.exit(FATAL_EXIT);
    }
  }
  return args;
}

async function main() {
  const { platform, arch, dest, version } = parseArgs(process.argv.slice(2));

  // `undefined` when --version was not passed: releaseAssetForTarget's own
  // default parameter then resolves it to SUPPORTED_CLI_VERSION, exactly as
  // every runtime caller gets it — never a second, hand-typed version string.
  const asset = releaseAssetForTarget(platform, arch, version);
  if (!asset) {
    console.log(
      `::warning::No tan CLI asset declared for ${platform}/${arch}` +
        `${version ? ` at v${version}` : ""} — either this host has no target ` +
        `triple in TARGETS, or the pinned release's HOSTS_WITHOUT_RELEASE_ASSET ` +
        `declares it a gap (src/alpCli/service.ts). Nothing to stage.`,
    );
    process.exit(NO_ASSET_EXIT);
  }

  let resolved;
  try {
    // Reads the release's OWN checksums.txt and picks whichever candidate
    // name it actually published (archive-first, #465) — never a guess from
    // `asset.candidates[0]`, which is exactly the bug this script exists to
    // stop reintroducing.
    resolved = await resolvePublishedAsset(
      asset.candidates,
      asset.checksumsUrl,
      {},
    );
  } catch (error) {
    if (error instanceof ChecksumError && error.kind === "unlisted") {
      console.log(
        `::warning::${asset.tag} publishes neither ` +
          `${asset.candidates.map((c) => c.assetName).join(" nor ")} ` +
          `(checked against its own checksums.txt) — nothing to stage for ` +
          `${platform}/${arch}. ${error.detail}`,
      );
      process.exit(NO_ASSET_EXIT);
    }
    console.error(
      `::error::Could not resolve the published tan CLI asset for ${platform}/${arch} ` +
        `at ${asset.tag}: ${error instanceof Error ? error.message : String(error)}` +
        `${error && error.detail ? ` (${error.detail})` : ""}`,
    );
    process.exit(FATAL_EXIT);
  }

  fs.mkdirSync(dest, { recursive: true });
  const destFile = path.join(dest, binaryName(platform));

  try {
    // The same function `resolveAlpBinary`'s `download` arm runs at
    // activation: proxy-aware transfer, sha256 verification against the
    // digest `resolvePublishedAsset` just read (no second checksums.txt
    // fetch), archive-vs-raw detection from the downloaded bytes' own magic
    // number, and — for an archive — unpacking so `destFile` IS the launcher
    // with every support entry (e.g. `_internal/`) landing beside it. That
    // last part is the whole reason this script does not hand-roll `tar`
    // itself: the packaged layout has to match what `sha256Tree` hashes over
    // the INSTALLED tree at runtime (#464), and there is exactly one place
    // that shape is defined.
    await downloadFile(
      resolved.url,
      destFile,
      {
        assetName: resolved.assetName,
        checksumsUrl: asset.checksumsUrl,
        digest: resolved.digest,
      },
      { platform },
    );
  } catch (error) {
    if (error instanceof ChecksumError) {
      console.error(
        `::error::Checksum refusal staging the tan CLI (${error.kind}): ${error.message} ${error.detail}`,
      );
    } else {
      console.error(
        `::error::Could not stage the tan CLI for ${platform}/${arch} from ` +
          `${resolved.url}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    process.exit(FATAL_EXIT);
  }

  const bytes = fs.statSync(destFile).size;
  console.log(
    `::notice::Staged tan ${asset.tag} (${platform}/${arch}) — ${resolved.assetName}, ` +
      `verified sha256 ${resolved.digest}, launcher ${destFile} (${bytes} bytes).`,
  );
}

main().catch((error) => {
  console.error(
    `::error::stage-tan-cli-asset.mjs failed: ${error instanceof Error ? error.stack : String(error)}`,
  );
  process.exit(FATAL_EXIT);
});
