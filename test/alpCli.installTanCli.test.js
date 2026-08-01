// SPDX-License-Identifier: Apache-2.0
//
// Wiring checks for `alp.installTanCli` (runs the bundled tan-cli install
// script in a terminal so `tan` lands on the user's PATH globally, distinct
// from the private managed-download resolver). These are cheap source-level
// checks -- they don't spawn a terminal or a shell -- so they catch a
// mis-wired command id, a missing bundled script, or an allowlist regression
// without needing `vsce package` + the electron test harness.

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");
const scriptDir = path.join(root, "media", "tan-install");

// ── The vendored-installer parity pin ──────────────────────────────────────
//
// media/tan-install/*.{sh,ps1} are hand-copied from alplabai/tan-cli. Naming
// the ref they came from, in-tree, is the whole point: without it "vendored
// copy" means "some copy, of something, once", and the README already drifted
// into asserting a divergence from upstream that upstream had adopted.
//
// `upstream` is the sha256 of the file as published at TAN_INSTALLER_REF;
// `vendored` is what must be on disk here. They differ ONLY where `deviations`
// says they do, and that is enforced, not documented: the test reverse-applies
// each deviation to the vendored bytes and requires the result to hash to
// `upstream`. So a third, undeclared edit cannot hide behind a declared one.
//
// Hashes are over LF-normalized UTF-8 (same convention as the vendored-schema
// gates) so a Windows checkout with core.autocrlf=true still matches. No
// network: `upstream` is a recorded constant, never fetched at test time.
//
// TO RE-VENDOR (e.g. at the tan-cli tag that ships this rework): copy the new
// upstream files in, bump TAN_INSTALLER_REF and BOTH hashes, and re-check
// `deviations` — if upstream has adopted a deviation, delete it rather than
// carrying it forever.
//   node -e "const c=require('crypto'),f=require('fs');for(const n of ['install.sh','install.ps1'])console.log(n,c.createHash('sha256').update(f.readFileSync('media/tan-install/'+n,'utf-8').replace(/\r\n/g,'\n'),'utf-8').digest('hex'))"
const TAN_INSTALLER_REF = "v0.4.1";
const VENDORED_INSTALLERS = {
  "install.sh": {
    upstream:
      "9b48a1c00bb3e0ff63b0628278b340bcdac7b4d7977e8e184d887f28c3628865",
    vendored:
      "e37df9dd92e377ee8fe828581dd8d17d360c66d22c9a296d799d4a02555349f5",
    // Upstream v0.4.1 still maps Linux to `unknown-linux-musl` (correct for
    // the Rust releases it ships against) and has no musl-host guard -- the
    // Python cutover (#444/#446/#447) has not reached a tan-cli TAG yet, only
    // its unreleased `release/python-tan-pipeline` branch. Both deviations
    // below are ported from that branch's real fix verbatim (same diagnosis
    // a maintainer review gave independently), not invented here, so a
    // re-vendor once it tags should make both a byte-for-byte no-op.
    //
    // Deviation 1 (Linux case): -gnu, not -musl -- a PyInstaller Linux freeze
    // is musl-DYNAMIC (its bootloader needs /lib/ld-musl-x86_64.so.1 present),
    // not the static artefact the Rust -musl build was, so it does not start
    // on Ubuntu/Debian/Fedora at all. -gnu is the only usable Linux asset a
    // Python tan release publishes.
    //
    // Deviation 1 also adds the pre-download musl-HOST guard the plain
    // -gnu swap by itself would be missing (a maintainer review caught this
    // as the sharpest defect: with no guard, running THIS script on an
    // Alpine/musl host downloads the gnu asset, sha256-verifies it correctly
    // -- verification only proves the bytes are what was published, not that
    // they will execute on this libc -- `chmod +x`s it, `mv`s it into place,
    // prints "installed", and only the final `"$dest" --version 2>/dev/null
    // || echo ...` line's stderr-swallow hides the exec failure, so the
    // script exits 0 having silently produced a binary that can never run).
    // `ldd --version | grep -qi musl` names musl on the first line where
    // glibc's ldd names itself; `ls /lib/ld-musl-*.so.1` catches a minimal
    // image with no `ldd` at all. Refuses BEFORE any download, pointing at
    // `pip install ./tan-cli/python` from a checkout instead.
    //
    // Deviation 2 (download-failure note): swaps the now-irrelevant
    // "musl assets predate v0.3.0" case for a "no Linux arm64 asset from
    // v0.5.0 on" one, matching HOSTS_WITHOUT_RELEASE_ASSET.
    deviations: [
      {
        upstream:
          'Darwin) os_part="apple-darwin" ;;\n# musl (static): no glibc floor, runs on any distro; TLS is rustls/ring so\n# there are no extra runtime deps either. Only published from tan-cli\n# v0.3.0 onward -- see the --version 404 note below.\nLinux) os_part="unknown-linux-musl" ;;\n*) echo "install.sh: unsupported OS \'$os\' -- on Windows use install.ps1" >&2; exit 1 ;;\nesac\n\n# host arch -> rust target arch part',
        vendored:
          'Darwin) os_part="apple-darwin" ;;\n# gnu, NOT musl. From v0.5.0 the binary is a PyInstaller freeze of the Python\n# port, and PyInstaller cannot produce the "static, runs on any libc" artefact\n# the Rust -musl target did: a musl freeze is dynamically linked against\n# /lib/ld-musl-x86_64.so.1 and runs ONLY on musl distros. So the Linux asset is\n# built on Debian 11 and named -gnu, and requesting -musl here would 404 on\n# every v0.5.0+ tag. Older (Rust) releases published BOTH, so this also\n# resolves for them -- with that build\'s measured GLIBC_2.30 floor.\nLinux) os_part="unknown-linux-gnu" ;;\n*) echo "install.sh: unsupported OS \'$os\' -- on Windows use install.ps1" >&2; exit 1 ;;\nesac\n\n# musl hosts (Alpine and similar) cannot run the -gnu binary above AT ALL --\n# not a checksum failure, a bare "not found" from the shell AFTER the sha256\n# verify below already passed, so none of that section\'s four refusals ever\n# fires and the script reports success. Catch it here instead, before any\n# download: `ldd --version` names musl on the first line where glibc\'s ldd\n# names itself; some minimal images have no ldd at all, so also check for the\n# musl dynamic loader directly.\nif [ "$os_part" = "unknown-linux-gnu" ]; then\n\tis_musl=0\n\tif command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi musl; then\n\t\tis_musl=1\n\telif ls /lib/ld-musl-*.so.1 >/dev/null 2>&1; then\n\t\tis_musl=1\n\tfi\n\tif [ "$is_musl" = "1" ]; then\n\t\techo "install.sh: this host\'s libc is musl (e.g. Alpine) -- no Linux asset is published for it. From v0.5.0 the binary is a PyInstaller freeze, which cannot produce the static musl artefact older Rust releases did; the only Linux asset now is -unknown-linux-gnu, and it cannot exec on a musl host." >&2\n\t\techo "install.sh: refusing to install. Install from a checkout instead: git clone https://github.com/${REPO} && pip install ./tan-cli/python" >&2\n\t\texit 1\n\tfi\nfi\n\n# host arch -> rust target arch part',
      },
      {
        upstream:
          'echo "install.sh: download failed: ${url}" >&2\n\t# Only name the musl floor when the requested tag is actually below it --\n\t# a DNS/proxy/500 failure, or a perfectly valid >=v0.3.0 tag, gets no\n\t# invented explanation.\n\tif [ "$os_part" = "unknown-linux-musl" ]; then\n\t\tcase "$VERSION" in\n\t\tv0.0.* | v0.1.* | v0.2.*)\n\t\t\techo "install.sh: note -- Linux musl assets only exist from v0.3.0 onward; ${VERSION} predates that and has no ${asset} asset." >&2\n\t\t\t;;\n\t\tesac\n\tfi\n\texit 1\nfi',
        vendored:
          'echo "install.sh: download failed: ${url}" >&2\n\t# The transport error above says THAT it failed, never why, and a 404 for\n\t# an asset that was never published looks identical to a proxy outage. Name\n\t# the causes this script can actually know; guess at nothing else.\n\tcase "${arch_part}-${os_part}" in\n\taarch64-unknown-linux-gnu)\n\t\techo "install.sh: note -- there is no prebuilt Linux arm64 asset from v0.5.0 onward. The binary is a frozen build that must be produced on the architecture it runs on, and the release builds no arm64 Linux. Install from a checkout instead: git clone https://github.com/${REPO} && pip install ./tan-cli/python" >&2\n\t\t;;\n\tesac\n\techo "install.sh: if this is a 404 rather than a network failure, check which assets ${VERSION} actually publishes: https://github.com/${REPO}/releases" >&2\n\texit 1\nfi',
      },
    ],
  },
  "install.ps1": {
    upstream:
      "8c596261d6ddb42770c42cf2d8b226209d03bd8e5cc5dc05dd8e44ccd626be8d",
    vendored:
      "101ec74ba21dd51789b61f41218147ae735aafe560e40845d1fed8f9b030d45e",
    // Upstream v0.4.1 already adopted both non-ASCII substitutions the old
    // v0.4.0 pin needed (checked: no U+2026/U+2014 anywhere in the file), so
    // that whole prior deviation is gone -- upstream now matches. The one
    // deviation left is the Windows-arm64 mirror of install.sh's Deviation 2
    // above, ported from the same unreleased branch: a bare
    // `Invoke-WebRequest` 404 under `$ErrorActionPreference = "Stop"` says
    // nothing about why, so this wraps it in try/catch and names the one
    // cause this script can know (no Windows arm64 asset from v0.5.0 on --
    // PyInstaller cannot cross-compile) instead of a raw exception.
    deviations: [
      {
        upstream:
          "\tInvoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing",
        vendored:
          '\t# The transport error a 404 throws here says only THAT the fetch failed,\n\t# never why -- and a 404 for an asset that was never published looks\n\t# identical to a network/proxy outage otherwise. Name the one cause this\n\t# script can actually know (there is no Windows arm64 asset, ever, from\n\t# v0.5.0 -- a PyInstaller freeze cannot be cross-compiled, and this release\n\t# builds on four runners, not six) and point at the source install; guess\n\t# at nothing else. Mirrors install.sh\'s equivalent case for linux/arm64.\n\ttry {\n\t\tInvoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing\n\t} catch {\n\t\tWrite-Host "install.ps1: download failed: $url" -ForegroundColor Red\n\t\tif ($archPart -eq "aarch64") {\n\t\t\tWrite-Error "install.ps1: there is no prebuilt Windows arm64 asset from v0.5.0 onward. The binary is a frozen build that must be produced on the architecture it runs on, and the release builds no Windows arm64 leg. Install from a checkout instead: git clone https://github.com/$repo && pip install ./tan-cli/python"\n\t\t} else {\n\t\t\tWrite-Error "install.ps1: if this is a 404 rather than a network failure, check which assets $Version actually publishes: https://github.com/$repo/releases"\n\t\t}\n\t\texit 1\n\t}',
      },
    ],
  },
};

const readNormalized = (name) =>
  fs.readFileSync(path.join(scriptDir, name), "utf-8").replace(/\r\n/g, "\n");

const sha256 = (s) =>
  crypto.createHash("sha256").update(s, "utf-8").digest("hex");

test("alp.installTanCli is contributed as a command", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf-8"),
  );
  const commands = pkg.contributes.commands;
  const cmd = commands.find((c) => c.command === "alp.installTanCli");
  assert.ok(
    cmd,
    "package.json contributes.commands must list alp.installTanCli",
  );
  assert.equal(cmd.title, "Alp: Install tan CLI (global)");
  assert.equal(cmd.category, "Alp");
});

test("the bundled install scripts the handler runs exist under media/tan-install/", () => {
  // Must match the scriptDir the handler (src/alpCli/vscodeAdapter.ts,
  // installTanCliGlobally) resolves from context.extensionPath.
  for (const name of ["install.sh", "install.ps1"]) {
    const p = path.join(scriptDir, name);
    assert.ok(fs.existsSync(p), `${p} must exist (bundled by the extension)`);
  }
});

test(
  "install.sh is executable so a direct invocation works",
  {
    // The Unix executable bit isn't represented in the Windows working tree
    // (git core.filemode is off there), so this can only be asserted on POSIX.
    // Linux CI is the source of truth for the shipped bit.
    skip: process.platform === "win32" && "executable bit is POSIX-only",
  },
  () => {
    const mode = fs.statSync(path.join(scriptDir, "install.sh")).mode;
    assert.ok(mode & 0o111, "install.sh should carry the executable bit");
  },
);

test("check-vsix-allowlist.sh's allowlist covers media/, the top-level dir the bundled scripts ship under", () => {
  const allowlistScript = fs.readFileSync(
    path.join(root, "scripts", "check-vsix-allowlist.sh"),
    "utf-8",
  );
  // media/tan-install/ is a subdirectory of the already-allowlisted top-level
  // `media` entry -- the gate only checks top-level paths -- so this asserts
  // that entry is present and .vscodeignore doesn't exclude the subdirectory.
  assert.match(
    allowlistScript,
    /\bmedia\b/,
    "scripts/check-vsix-allowlist.sh must allowlist the top-level media dir",
  );

  const vscodeignore = fs.readFileSync(
    path.join(root, ".vscodeignore"),
    "utf-8",
  );
  assert.doesNotMatch(
    vscodeignore,
    /^media\/tan-install\/\*\*/m,
    "media/tan-install/** must not be excluded by .vscodeignore",
  );
  assert.doesNotMatch(
    vscodeignore,
    /^media\/\*\*$/m,
    "media/** must not be excluded wholesale by .vscodeignore",
  );
});

test("check-vsix-allowlist.sh's allowlist covers changelog.md, which vsce bundles automatically", () => {
  const allowlistScript = fs.readFileSync(
    path.join(root, "scripts", "check-vsix-allowlist.sh"),
    "utf-8",
  );
  // vsce bundles CHANGELOG.md into the VSIX unconditionally for the
  // Marketplace "Changelog" tab — shipping it is intentional, so a future
  // trim of the allowlist can't silently re-break packaging (it did once).
  assert.match(
    allowlistScript,
    /\bchangelog\.md\b/,
    "scripts/check-vsix-allowlist.sh must allowlist changelog.md",
  );
});

test("extension.ts registers the alp.installTanCli handler (not just contributes it)", () => {
  // A command contributed in package.json but never registerCommand()'d is a
  // dead palette entry that does nothing — assert the wiring exists.
  const ext = fs.readFileSync(path.join(root, "src", "extension.ts"), "utf-8");
  assert.match(
    ext,
    /registerCommand\(\s*["']alp\.installTanCli["']/,
    "extension.ts must registerCommand('alp.installTanCli')",
  );
});

// ── Encoding + parse gates on the vendored .ps1 ────────────────────────────

test("vendored .ps1 installers are ASCII-only or carry a UTF-8 BOM (cp1252 mis-decode gate)", () => {
  // The platform-INDEPENDENT half of the parse gate, and the one that actually
  // pins the defect class: Windows PowerShell 5.1 decodes a BOM-less script as
  // the ANSI codepage, so a non-ASCII byte in a double-quoted string can land
  // on a character 5.1 treats as a string delimiter (U+201D from cp1252 `â€”`)
  // and break parsing outright. Either encoding discipline prevents it; a BOM
  // survives a re-vendor less well than plain ASCII does.
  const scripts = fs.readdirSync(scriptDir).filter((f) => f.endsWith(".ps1"));
  assert.ok(scripts.length > 0, "expected at least one vendored .ps1");
  for (const name of scripts) {
    const buf = fs.readFileSync(path.join(scriptDir, name));
    const hasBom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    if (hasBom) continue;
    const bad = [];
    let line = 1;
    for (const byte of buf) {
      if (byte === 0x0a) line += 1;
      else if (byte > 0x7f) bad.push(`line ${line} (0x${byte.toString(16)})`);
    }
    assert.deepEqual(
      bad,
      [],
      `${name} has no UTF-8 BOM, so Windows PowerShell 5.1 reads it as the ANSI ` +
        `codepage -- these non-ASCII bytes can mis-decode into a string ` +
        `terminator and break the script: ${bad.join(", ")}. Use ASCII ` +
        `(e.g. "..." for an ellipsis, "--" for an em dash).`,
    );
  }
});

const winPowerShell = path.join(
  process.env.SystemRoot ?? "C:\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);
const canRunWinPs =
  process.platform === "win32" && fs.existsSync(winPowerShell);

test(
  "vendored install.ps1 parses under the real Windows PowerShell 5.1",
  {
    // Reinforcement only -- the ASCII/BOM test above is the gate that runs
    // everywhere, including Linux CI, so an off-Windows run is not unguarded.
    // Loud on purpose: this line means the strongest check DID NOT EXECUTE.
    skip: canRunWinPs
      ? false
      : "NOT RUN (no Windows PowerShell 5.1 on this host) -- real-parser check skipped, not passed",
  },
  () => {
    // `powershell` (not `pwsh`) is what installTanCliGlobally spawns, so this
    // is the interpreter that actually decides whether the shipped command
    // works. ParseFile reads the file itself, exercising the same decoding
    // path as `-File`, without downloading or installing anything.
    const res = spawnSync(
      winPowerShell,
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$t=$null;$e=$null;" +
          "[void][System.Management.Automation.Language.Parser]::ParseFile($env:ALP_PS1,[ref]$t,[ref]$e);" +
          "$e | ForEach-Object { Write-Output ('line ' + $_.Extent.StartLineNumber + ': ' + $_.Message) };" +
          "exit $e.Count",
      ],
      {
        env: { ...process.env, ALP_PS1: path.join(scriptDir, "install.ps1") },
        encoding: "utf-8",
        windowsHide: true,
      },
    );
    assert.equal(
      res.status,
      0,
      `install.ps1 does not parse under Windows PowerShell 5.1:\n${res.stdout}${res.stderr}`,
    );
  },
);

// ── The parity pin ─────────────────────────────────────────────────────────

test(`vendored installers match tan-cli ${TAN_INSTALLER_REF} except where declared`, () => {
  for (const [name, pin] of Object.entries(VENDORED_INSTALLERS)) {
    const text = readNormalized(name);

    assert.equal(
      sha256(text),
      pin.vendored,
      `media/tan-install/${name} was edited without updating its pin. If the ` +
        `edit is intentional, declare it in VENDORED_INSTALLERS (upstream/` +
        `vendored hashes + deviations) so the next re-vendor can see it.`,
    );

    // Reverse-apply the declared deviations; the result must be upstream byte
    // for byte. This is what stops a deviation entry from being a note nobody
    // checks -- an undeclared edit shifts the reconstruction and reds here.
    let reconstructed = text;
    for (const dev of pin.deviations) {
      const hits = reconstructed.split(dev.vendored).length - 1;
      assert.equal(
        hits,
        1,
        `${name}: declared deviation must appear exactly once (found ${hits}): ${dev.vendored}`,
      );
      reconstructed = reconstructed.replace(dev.vendored, dev.upstream);
    }
    assert.equal(
      sha256(reconstructed),
      pin.upstream,
      `media/tan-install/${name} differs from tan-cli ${TAN_INSTALLER_REF} by ` +
        `more than its ${pin.deviations.length} declared deviation(s). Either ` +
        `declare the extra change or drop it; re-vendoring means bumping ` +
        `TAN_INSTALLER_REF and both hashes.`,
    );
  }
});

// ── The version pin (#408) ─────────────────────────────────────────────────
//
// Both scripts default to installing GitHub's `latest` RELEASE when run with
// no `--version`/`-Version` — which is whatever tag isn't flagged pre-release
// there, not necessarily the newest tag and not necessarily this extension's
// pin. Driven through the REAL `installTanCliGlobally` (out/alpCli/
// vscodeAdapter.js), against the ACTUAL bundled scripts on disk (extensionPath
// points at the repo root, where media/tan-install/ really lives) — a
// source-text grep on the handler could not tell the difference between an
// argument that reaches the spawned argv and one that is merely mentioned in
// a comment.

const ADAPTER = require.resolve(
  path.join(root, "out", "alpCli", "vscodeAdapter.js"),
);
const { SUPPORTED_CLI_VERSION } = require(
  path.join(root, "out", "alpCli", "service.js"),
);

/** One activation of `installTanCliGlobally`, with `runInTerminal` stubbed to
 *  capture the argv it was asked to run (and `notifyAsync` stubbed to capture
 *  any plan raised instead) rather than actually spawning a terminal.
 *  `extensionPath: root` is deliberate — it's the one context field the
 *  handler reads, and pointing it at the real repo root means the "bundled
 *  script exists" guard sees the ACTUAL vendored install.sh/.ps1, not a
 *  fixture that could drift from them.
 *
 *  `platform`/`arch` (default the REAL host's) let a test drive the
 *  declared-gap short-circuit for a host this machine isn't — `process.platform`
 *  is `configurable: true` in Node (confirmed, not assumed), so this restores
 *  it in a `finally` rather than leaving a later test on a fake host. */
function runInstallTanCli({ platform, arch } = {}) {
  const terminalCalls = [];
  const notifyCalls = [];
  delete require.cache[ADAPTER];
  const stubs = {
    vscode: {
      workspace: {
        getConfiguration: () => ({ get: (_key, fallback) => fallback }),
      },
    },
    "../notify/vscodeAdapter": {
      notify: async () => undefined,
      notifyAsync: (plan) => notifyCalls.push(plan),
    },
    "../util": {
      log: () => {},
      runInTerminal: (options) => terminalCalls.push(options),
    },
  };
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  const originalPlatform = process.platform;
  const originalArch = process.arch;
  if (platform)
    Object.defineProperty(process, "platform", {
      value: platform,
      configurable: true,
    });
  if (arch)
    Object.defineProperty(process, "arch", { value: arch, configurable: true });
  let adapter;
  try {
    adapter = require(ADAPTER);
    adapter.installTanCliGlobally({
      extensionPath: root,
      subscriptions: [],
      // Running this command clears a stored consent decline
      // (`DOWNLOAD_CONSENT_KEY`) — a bare stub is enough, this file doesn't
      // assert on it (see test/alpCli.downloadConsent.test.js for that).
      globalState: { update: async () => {} },
    });
  } finally {
    Module._load = originalLoad;
    delete require.cache[ADAPTER];
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
    Object.defineProperty(process, "arch", {
      value: originalArch,
      configurable: true,
    });
  }
  return { terminalCalls, notifyCalls };
}

test("installTanCliGlobally pins --version/-Version to SUPPORTED_CLI_VERSION, not the installer's own 'latest' default", () => {
  const { terminalCalls } = runInstallTanCli();
  assert.equal(
    terminalCalls.length,
    1,
    "installTanCliGlobally must run exactly one terminal command",
  );
  const { argv } = terminalCalls[0];
  const tag = `v${SUPPORTED_CLI_VERSION}`;
  const versionFlag = process.platform === "win32" ? "-Version" : "--version";
  assert.deepEqual(
    argv.slice(-2),
    [versionFlag, tag],
    `expected the installer invocation to end with ${versionFlag} ${tag} so ` +
      `it targets the pin this extension supports rather than GitHub's ` +
      `'latest' release: ${argv.join(" ")}`,
  );
});

// ── The declared-gap short-circuit (maintainer review, MAJOR 2) ────────────
//
// The vendored installers pick an asset from `uname -m` alone — they know
// nothing about `HOSTS_WITHOUT_RELEASE_ASSET`. Before this guard, running
// `installTanCliGlobally` on a declared-gap host (e.g. `linux/arm64` against
// the pinned tan v0.5.0-rc1) spawned the script anyway and let it 404 with no
// explanation, instead of the same "no prebuilt tan for your platform"
// message the managed download already gives that host.
test("installTanCliGlobally short-circuits a declared-gap host to noPrebuiltMessage, no terminal spawned", () => {
  const {
    noPrebuiltMessage,
    HOSTS_WITHOUT_RELEASE_ASSET,
    SUPPORTED_CLI_VERSION: pin,
  } = require(path.join(root, "out", "alpCli", "service.js"));
  const [gapHost] = HOSTS_WITHOUT_RELEASE_ASSET[pin] ?? [];
  assert.ok(
    gapHost,
    `HOSTS_WITHOUT_RELEASE_ASSET[${pin}] must declare at least one gap for ` +
      "this test to mean anything — if the pin moved to a release with no " +
      "gaps, point this test at a fixture pin instead of deleting it.",
  );
  const [platform, arch] = gapHost.split("/");

  const { terminalCalls, notifyCalls } = runInstallTanCli({ platform, arch });

  assert.equal(
    terminalCalls.length,
    0,
    `no terminal should spawn for the declared-gap host ${gapHost}`,
  );
  assert.equal(notifyCalls.length, 1);
  assert.equal(notifyCalls[0].message, noPrebuiltMessage(platform, arch));
  assert.ok(
    notifyCalls[0].actions.some(
      (a) => a.id === "openSettings" && a.arg === "alpSdk.cliPath",
    ),
    "the only remedy on a host with no asset is alpSdk.cliPath -- no Retry, which would just 404 again",
  );
});

test("the README names the ref the installers are pinned to", () => {
  // The pin is only useful if a human reading the directory learns the ref
  // without reading the test. The README asserted a stale divergence for
  // exactly as long as nothing tied it to the gate.
  const readme = fs.readFileSync(path.join(scriptDir, "README.md"), "utf-8");
  assert.ok(
    readme.includes(TAN_INSTALLER_REF),
    `media/tan-install/README.md must name the pinned ref (${TAN_INSTALLER_REF})`,
  );
});
