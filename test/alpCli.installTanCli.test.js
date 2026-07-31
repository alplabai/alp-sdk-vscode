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
// TO RE-VENDOR (e.g. at tan-cli v0.4.1): copy the new upstream files in, bump
// TAN_INSTALLER_REF and BOTH hashes, and re-check `deviations` — if upstream
// has adopted a deviation, delete it rather than carrying it forever.
//   node -e "const c=require('crypto'),f=require('fs');for(const n of ['install.sh','install.ps1'])console.log(n,c.createHash('sha256').update(f.readFileSync('media/tan-install/'+n,'utf-8').replace(/\r\n/g,'\n'),'utf-8').digest('hex'))"
const TAN_INSTALLER_REF = "v0.4.0";
const VENDORED_INSTALLERS = {
  "install.sh": {
    upstream:
      "51449e2d01822207a66d71ea8db8e23a3899f323e986c752a3a70086b1a651ba",
    vendored:
      "8e6fce1801e80f9b5642b80360e15a315f11a020d4f6de29436e92201336af2c",
    // Upstream v0.4.0 maps Linux to `unknown-linux-musl`, correct for the Rust
    // releases it shipped against. From v0.5.0 the binary is a PyInstaller
    // freeze, which cannot produce musl's static artefact -- a musl freeze is
    // dynamically linked against /lib/ld-musl-x86_64.so.1 and would not start
    // on Ubuntu/Debian/Fedora at all (alp-sdk-vscode#447, mirroring the
    // `TARGETS` rationale in src/alpCli/service.ts, #444). -gnu has published
    // at every tan-cli tag since v0.1.0, so the pre-v0.3.0 musl-floor note this
    // also removes no longer applies to anything. A future re-vendor at the
    // tan-cli tag that ships this fix upstream should delete both entries.
    deviations: [
      {
        upstream:
          '# musl (static): no glibc floor, runs on any distro; TLS is rustls/ring so\n# there are no extra runtime deps either. Only published from tan-cli\n# v0.3.0 onward — see the --version 404 note below.\nLinux) os_part="unknown-linux-musl" ;;',
        vendored:
          '# gnu, NOT musl. From v0.5.0 the binary is a PyInstaller freeze of the Python\n# port, and PyInstaller cannot produce the "static, runs on any libc" artefact\n# the old Rust -musl target did — a musl freeze is dynamically linked against\n# /lib/ld-musl-x86_64.so.1 and runs ONLY on musl distros. -gnu has been\n# published at every tan-cli tag since v0.1.0, so this needs no version floor.\nLinux) os_part="unknown-linux-gnu" ;;',
      },
      {
        upstream:
          '\techo "install.sh: download failed: ${url}" >&2\n\t# Only name the musl floor when the requested tag is actually below it --\n\t# a DNS/proxy/500 failure, or a perfectly valid >=v0.3.0 tag, gets no\n\t# invented explanation.\n\tif [ "$os_part" = "unknown-linux-musl" ]; then\n\t\tcase "$VERSION" in\n\t\tv0.0.* | v0.1.* | v0.2.*)\n\t\t\techo "install.sh: note — Linux musl assets only exist from v0.3.0 onward; ${VERSION} predates that and has no ${asset} asset." >&2\n\t\t\t;;\n\t\tesac\n\tfi\n\texit 1\nfi',
        vendored: '\techo "install.sh: download failed: ${url}" >&2\n\texit 1\nfi',
      },
    ],
  },
  "install.ps1": {
    upstream:
      "eb8dd7e697b17c71d2996fd1390256109b76dd97de0f02f355836e4fd61198fb",
    vendored:
      "dd2856659a9302014d7995513651ae0d08edcaa6709ea1a685133b33d522724c",
    // Upstream v0.4.0 ships two non-ASCII characters in Write-Host strings and
    // no BOM. Windows PowerShell 5.1 -- which is exactly what the handler's
    // `powershell` argv resolves to -- then decodes the file as the ANSI
    // codepage: on cp1252 the em dash's E2 80 94 becomes `â€”`, whose third
    // character is U+201D, which PowerShell honours as a string terminator.
    // Driven on 5.1.26100.8894: 2 parse errors, the script does not run at all.
    // So these two substitutions are a defect fix, not a style preference.
    //
    // ASCII rather than a BOM on purpose: ASCII decodes identically under every
    // codepage and under the documented `irm ... | iex` path, while a BOM only
    // helps `-File`. Either way a wholesale re-vendor overwrites this, so the
    // fix worth making is the one upstream is also likely to hold -- and as of
    // 2026-07-29 tan-cli's unreleased installer rework had independently made
    // these same two substitutions. If a release ships it, delete this entry.
    deviations: [
      {
        upstream:
          'Write-Host "install.ps1: downloading tan ($archPart, $Version)…"',
        vendored:
          'Write-Host "install.ps1: downloading tan ($archPart, $Version)..."',
      },
      {
        upstream:
          '\tWrite-Host "install.ps1: added $Dir to the $scope Path — restart the terminal for it to take effect."',
        vendored:
          '\tWrite-Host "install.ps1: added $Dir to the $scope Path -- restart the terminal for it to take effect."',
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
 *  capture the argv it was asked to run rather than actually spawning a
 *  terminal. `extensionPath: root` is deliberate — it's the one context field
 *  the handler reads, and pointing it at the real repo root means the
 *  "bundled script exists" guard sees the ACTUAL vendored install.sh/.ps1,
 *  not a fixture that could drift from them. */
function runInstallTanCli() {
  const terminalCalls = [];
  delete require.cache[ADAPTER];
  const stubs = {
    vscode: {
      workspace: {
        getConfiguration: () => ({ get: (_key, fallback) => fallback }),
      },
    },
    "../notify/vscodeAdapter": {
      notify: async () => undefined,
      notifyAsync: () => {},
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
  let adapter;
  try {
    adapter = require(ADAPTER);
  } finally {
    Module._load = originalLoad;
    delete require.cache[ADAPTER];
  }
  adapter.installTanCliGlobally({
    extensionPath: root,
    subscriptions: [],
    // Running this command clears a stored consent decline
    // (`DOWNLOAD_CONSENT_KEY`) — a bare stub is enough, this file doesn't
    // assert on it (see test/alpCli.downloadConsent.test.js for that).
    globalState: { update: async () => {} },
  });
  return terminalCalls;
}

test("installTanCliGlobally pins --version/-Version to SUPPORTED_CLI_VERSION, not the installer's own 'latest' default", () => {
  const calls = runInstallTanCli();
  assert.equal(
    calls.length,
    1,
    "installTanCliGlobally must run exactly one terminal command",
  );
  const { argv } = calls[0];
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
