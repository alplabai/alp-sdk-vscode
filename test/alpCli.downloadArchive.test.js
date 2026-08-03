// SPDX-License-Identifier: Apache-2.0
//
// The archive-unpack path (tan-cli#349): tan-cli moves from shipping one raw
// executable per target to one archive per target (`.zip` on win32, `.tar.gz`
// elsewhere) — a onedir PyInstaller freeze, because the old onefile freeze
// re-extracted 14 MB on every invocation, 13-19 s on macOS, well past this
// extension's own CLI-probe timeouts.
//
// These tests drive the REAL `downloadFile` against a local HTTP server, the
// same way `alpCli.download.test.js` and `alpCli.downloadChecksum.test.js` do
// for the raw-binary path — no mocking of the unpack itself, so a fixture
// built here is unpacked by the exact `tar` invocation production code runs.
//
// Two facts matter enough to be pinned explicitly, not just exercised:
//   - detection is by the downloaded bytes' own magic number, never by the
//     URL, `destFile`'s extension, or a version — a pin naming a RAW release
//     and a pin naming an ARCHIVE release both have to install correctly
//     through the exact same code path (see `ZIP_MAGIC` in download.ts).
//   - "the archive's checksum matched" and "the archive unpacked to a working
//     launcher" are different facts, and only the first is provable by the
//     checksum in checksums.txt — an archive can be byte-for-byte what was
//     published and still be missing the launcher, or contain a 0-byte one.

const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const {
  ChecksumError,
  downloadFile,
  resolvePublishedAsset,
} = require("../out/alpCli/download.js");
const { releaseAssetForTarget } = require("../out/alpCli/service.js");

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** The tar that BUILDS the fixtures — which is a different question from the
 *  tar the production code picks to UNPACK them.
 *
 *  These tests simulate `platform: "win32"` so `installArchive` exercises its
 *  win32 branch, but the fixture is still built by whatever machine runs the
 *  suite. Resolving System32 unconditionally made every archive test pass on
 *  Windows and fail on Linux and macOS CI with
 *
 *      Error: spawnSync C:\Windows/System32/tar.exe ENOENT
 *
 *  — green locally, red in CI, which is the worst way to be wrong.
 *
 *  On win32 the absolute System32 path still matters: a Git-for-Windows GNU
 *  tar earlier on PATH cannot write `.zip` at all, so pinning it keeps fixture
 *  creation deterministic regardless of PATH order. Everywhere else bare
 *  `tar` is both correct and the only one that exists. */
function systemTar() {
  if (process.platform !== "win32") return "tar";
  return path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "tar.exe",
  );
}

/** Whether this host's tar can CREATE a `.zip`. bsdtar (Windows System32,
 *  macOS) can; GNU tar (every Linux distro) cannot write zip at all, so the
 *  two zip fixtures below are unbuildable there. Probed once, by actually
 *  trying it -- not inferred from `process.platform`, because that is the
 *  assumption that produced `C:\Windows/System32/tar.exe ENOENT` on CI in the
 *  first place. A host that cannot build the fixture SKIPS those two cases
 *  with a named reason; it never silently passes them.
 *
 *  Production is unaffected: the release ships `.zip` only for win32, and
 *  `installArchive` picks its unpacker from the downloaded MAGIC BYTES, which
 *  the tar.gz cases below exercise on every platform. */
let ZIP_CREATE_SUPPORTED = null;
function canCreateZip() {
  if (ZIP_CREATE_SUPPORTED !== null) return ZIP_CREATE_SUPPORTED;
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), "alp-zipprobe-"));
  try {
    fs.writeFileSync(path.join(probe, "f.txt"), "x");
    execFileSync(
      systemTar(),
      ["-a", "-c", "-f", path.join(probe, "p.zip"), "f.txt"],
      {
        cwd: probe,
        stdio: "ignore",
      },
    );
    ZIP_CREATE_SUPPORTED = fs.existsSync(path.join(probe, "p.zip"));
  } catch {
    ZIP_CREATE_SUPPORTED = false;
  }
  return ZIP_CREATE_SUPPORTED;
}

/** Build a `.zip` or `.tar.gz` fixture from `files` (relative path → file
 *  content), optionally wrapped in one top-level directory named `wrap` — the
 *  common release-archive convention `installArchive` unwraps. Returns the
 *  archive's absolute path. */
function buildArchive(kind, files, { wrap } = {}) {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "alp-archive-src-"));
  const root = wrap ? path.join(stage, wrap) : stage;
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  const archivePath = path.join(
    stage,
    kind === "zip" ? "archive.zip" : "archive.tar.gz",
  );
  const topEntries = wrap
    ? [wrap]
    : [...new Set(Object.keys(files).map((f) => f.split(/[\\/]/)[0]))];
  execFileSync(systemTar(), ["-a", "-c", "-f", archivePath, ...topEntries], {
    cwd: stage,
  });
  return archivePath;
}

/** Start a server on 127.0.0.1:0 serving `archivePath`'s bytes at `/asset`
 *  (and, when `manifest` is given, at `/checksums.txt`), run `fn(baseUrl)`,
 *  and always close the server after. */
async function withReleaseServer(archivePath, manifest, fn) {
  const body = fs.readFileSync(archivePath);
  const server = http.createServer((req, res) => {
    if (req.url === "/checksums.txt") {
      const text = manifest ?? "";
      res.writeHead(200, { "content-length": String(Buffer.byteLength(text)) });
      res.end(text);
      return;
    }
    res.writeHead(200, { "content-length": String(body.length) });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`, body);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function tmpCacheDir(launcherName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-archive-test-"));
  return { dir, dest: path.join(dir, launcherName) };
}

async function rejectionOf(promise) {
  return promise.then(
    () => undefined,
    (error) => error,
  );
}

/** Run `fn` with Windows' own `System32` (bsdtar) put ahead of this dev
 *  machine's PATH, restoring it after.
 *
 *  ONLY the non-win32 (`"tar"`, bare PATH lookup) production code path needs
 *  this, and only in THIS test environment: on a real macOS or Linux host —
 *  where that branch actually runs in production — there is no second `tar`
 *  to collide with. Here there is: Git for Windows ships its own `tar.exe`
 *  (GNU tar) in `usr/bin`, often ahead of `System32` on a dev machine's PATH,
 *  and GNU tar reads an absolute Windows path's drive letter (`C:\...`) as a
 *  `host:path` remote-tar spec and tries to rsh-connect to a host named `C`
 *  (confirmed here: `tar: Cannot connect to C: resolve failed`) — a
 *  Windows-path-vs-remote-tar-syntax collision that cannot occur on a real
 *  POSIX host, where paths never carry a drive-letter colon. Forcing bsdtar
 *  for this one test keeps it proving the production LOGIC (the bare-`"tar"`
 *  branch, the wrapper unwrap, the launcher search, the install order) — the
 *  one thing it cannot prove is GNU tar's own behaviour, which is what the
 *  real Linux CI runner exercises instead. */
async function withSystem32TarFirst(fn) {
  // Pass-through off win32: this whole dance exists only because a
  // WINDOWS dev machine has a second, colliding `tar`. On a real macOS or
  // Linux host -- where the bare-`"tar"` production branch actually runs --
  // there is nothing to shadow, and prepending a `C:\Windows\System32`
  // that does not exist is how this test failed on CI.
  if (process.platform !== "win32") return fn();
  const system32 = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
  );
  const original = process.env.PATH;
  process.env.PATH = `${system32}${path.delimiter}${original}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = original;
  }
}

for (const wrap of [undefined, "tan-x86_64-pc-windows-msvc"]) {
  test(
    `downloadFile: a .zip archive (win32) installs the launcher and its support files at destFile` +
      (wrap ? ", wrapped in one top-level directory" : ", with no wrapper"),
    {
      skip: canCreateZip()
        ? false
        : "this host's tar cannot CREATE a .zip (GNU tar on Linux); the fixture is unbuildable here, so this case is SKIPPED rather than silently passed. The .tar.gz cases cover the same magic-byte detection, unwrap and install-order logic on every platform.",
    },
    async () => {
      const archive = buildArchive(
        "zip",
        {
          "tan.exe": "the launcher\n",
          "_internal/lib.txt": "a support file\n",
        },
        { wrap },
      );
      await withReleaseServer(archive, null, async (baseUrl) => {
        const { dir, dest } = tmpCacheDir("tan.exe");
        await downloadFile(`${baseUrl}/asset`, dest, null, {
          platform: "win32",
        });
        assert.equal(fs.readFileSync(dest, "utf8"), "the launcher\n");
        assert.equal(
          fs.readFileSync(path.join(dir, "_internal", "lib.txt"), "utf8"),
          "a support file\n",
        );
        // Only the launcher and its support directory remain — the staging
        // directory and the downloaded archive are both cleaned up.
        assert.deepEqual(fs.readdirSync(dir).sort(), ["_internal", "tan.exe"]);
      });
    },
  );
}

test("downloadFile: a .tar.gz archive (non-win32) installs the launcher and its support files at destFile", async () => {
  const archive = buildArchive(
    "gzip",
    { tan: "the launcher\n", "_internal/lib.txt": "a support file\n" },
    { wrap: "tan-x86_64-unknown-linux-gnu" },
  );
  await withSystem32TarFirst(() =>
    withReleaseServer(archive, null, async (baseUrl) => {
      const { dir, dest } = tmpCacheDir("tan");
      await downloadFile(`${baseUrl}/asset`, dest, null, {
        platform: "linux",
      });
      assert.equal(fs.readFileSync(dest, "utf8"), "the launcher\n");
      assert.equal(
        fs.readFileSync(path.join(dir, "_internal", "lib.txt"), "utf8"),
        "a support file\n",
      );
      assert.deepEqual(fs.readdirSync(dir).sort(), ["_internal", "tan"]);
    }),
  );
});

test(
  "downloadFile: archive vs raw binary is decided by the downloaded bytes, not by destFile's own extension",
  {
    skip: canCreateZip()
      ? false
      : "host tar cannot create a .zip; see the zip loop above",
  },
  async () => {
    // `dest` is named `tan.exe`, exactly as every pre-archive release already
    // installs it — the same asset NAME the extension has always requested (see
    // service.ts's `releaseAssetForTarget`). What decides the install path is
    // the CONTENT that arrived at that name, not the name itself.
    const archive = buildArchive("zip", { "tan.exe": "the launcher\n" });
    await withReleaseServer(archive, null, async (baseUrl) => {
      const { dir, dest } = tmpCacheDir("tan.exe");
      await downloadFile(`${baseUrl}/asset`, dest, null, { platform: "win32" });
      assert.equal(fs.readFileSync(dest, "utf8"), "the launcher\n");
      assert.deepEqual(fs.readdirSync(dir), ["tan.exe"]);
    });
  },
);

test("downloadFile: bytes that merely start with 'PK' but are not the full zip magic install as a raw binary", async () => {
  // Regression guard on the sniff itself: a two-byte coincidence must not
  // misfire into an unpack attempt against a body that is not an archive.
  const body = Buffer.from("PKuseless raw binary bytes, not a zip\n");
  await withReleaseServer(
    (() => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-archive-src-"));
      const p = path.join(dir, "not-a-zip.bin");
      fs.writeFileSync(p, body);
      return p;
    })(),
    null,
    async (baseUrl) => {
      const { dir, dest } = tmpCacheDir("tan.exe");
      await downloadFile(`${baseUrl}/asset`, dest, null, {
        platform: "win32",
      });
      assert.deepEqual(fs.readFileSync(dest), body);
      assert.deepEqual(fs.readdirSync(dir), ["tan.exe"]);
    },
  );
});

test("downloadFile: an archive missing the launcher is refused, and nothing is installed", async () => {
  const archive = buildArchive(
    "zip",
    { "_internal/lib.txt": "a support file, but no launcher\n" },
    { wrap: "tan-x86_64-pc-windows-msvc" },
  );
  await withReleaseServer(archive, null, async (baseUrl) => {
    const { dir, dest } = tmpCacheDir("tan.exe");
    const rejection = await rejectionOf(
      downloadFile(`${baseUrl}/asset`, dest, null, { platform: "win32" }),
    );
    assert.ok(rejection, "an archive with no launcher must not resolve");
    assert.match(rejection.message, /did not contain tan\.exe/);
    assert.ok(!fs.existsSync(dest));
    assert.deepEqual(
      fs.readdirSync(dir),
      [],
      "nothing from the archive — not even the support directory — is installed",
    );
  });
});

test("downloadFile: an archive that unpacks to a 0-byte launcher is refused, and nothing is installed", async () => {
  const archive = buildArchive(
    "zip",
    { "tan.exe": "", "_internal/lib.txt": "a support file\n" },
    { wrap: "tan-x86_64-pc-windows-msvc" },
  );
  await withReleaseServer(archive, null, async (baseUrl) => {
    const { dir, dest } = tmpCacheDir("tan.exe");
    const rejection = await rejectionOf(
      downloadFile(`${baseUrl}/asset`, dest, null, { platform: "win32" }),
    );
    assert.ok(rejection, "a 0-byte extracted launcher must not resolve");
    assert.match(rejection.message, /0-byte tan\.exe/);
    assert.ok(!fs.existsSync(dest));
    assert.deepEqual(
      fs.readdirSync(dir),
      [],
      "the checksum on the ARCHIVE proves nothing about what came out of it",
    );
  });
});

test(
  "downloadFile: an archive's checksum is verified BEFORE it is ever unpacked",
  {
    skip: canCreateZip()
      ? false
      : "this host's tar cannot CREATE a .zip (GNU tar); the fixture is unbuildable here. The tar.gz cases cover the same magic-byte detection and install path.",
  },
  async () => {
    const published = buildArchive("zip", { "tan.exe": "the real launcher\n" });
    const publishedBytes = fs.readFileSync(published);
    const tampered = Buffer.from(publishedBytes);
    // Flip a byte inside the local-file-header region rather than past the
    // central directory, so tar still recognizes SOMETHING zip-shaped — the
    // point is that the checksum must catch this before extraction is ever
    // attempted, not that a corrupt zip would necessarily fail to parse.
    tampered[10] ^= 0x01;
    await withReleaseServer(
      (() => {
        const p = `${published}.tampered`;
        fs.writeFileSync(p, tampered);
        return p;
      })(),
      `${sha256(publishedBytes)}  tan-x86_64-pc-windows-msvc.exe\n`,
      async (baseUrl) => {
        const { dir, dest } = tmpCacheDir("tan.exe");
        const rejection = await rejectionOf(
          downloadFile(
            `${baseUrl}/asset`,
            dest,
            {
              assetName: "tan-x86_64-pc-windows-msvc.exe",
              checksumsUrl: `${baseUrl}/checksums.txt`,
            },
            { platform: "win32" },
          ),
        );
        assert.ok(
          rejection instanceof ChecksumError,
          `expected a ChecksumError, got ${rejection && rejection.name}`,
        );
        assert.match(rejection.message, /does not match the checksum/);
        assert.ok(
          !fs.existsSync(dest),
          "an unverified archive is never unpacked",
        );
        assert.deepEqual(fs.readdirSync(dir), []);
      },
    );
  },
);

// ── traversal safety: an archive entry cannot be written outside the
//    destination. Built as RAW ustar bytes rather than shelled out to the
//    host `tar -c`, because tar implementations disagree on whether `..` in a
//    member name given at CREATE time is normalized away before it ever
//    reaches the archive — the point of this test is what `runTar`'s
//    EXTRACTING invocation (`tar -xf …`, no `-P`/`--insecure`) does with a
//    member name that already contains `..`, which only a hand-built archive
//    guarantees. ─────────────────────────────────────────────────────────────

/** One minimal ustar (POSIX tar) header + content block for `name`/`content`.
 *  Just enough of the format for a single regular-file entry: name, size,
 *  checksum, typeflag '0', the "ustar\0"+"00" magic/version. Every other
 *  field is zero-filled, which every real tar accepts. */
function ustarEntry(name, content) {
  const body = Buffer.from(content, "utf8");
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8"); // name (100 bytes)
  header.write("0000644\0", 100, "utf8"); // mode
  header.write("0000000\0", 108, "utf8"); // uid
  header.write("0000000\0", 116, "utf8"); // gid
  header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124, "utf8"); // size
  header.write("00000000000\0", 136, "utf8"); // mtime
  header.write("        ", 148, "utf8"); // chksum placeholder: 8 spaces
  header.write("0", 156, "utf8"); // typeflag: regular file
  header.write("ustar\x0000", 257, "utf8"); // magic "ustar\0" + version "00"
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "utf8"); // chksum, for real this time
  const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512);
  body.copy(padded);
  return Buffer.concat([header, padded]);
}

/** A `.tar.gz` containing exactly the given `{name, content}` entries, built
 *  byte-for-byte rather than through any tar CLI — see the section banner
 *  above for why. */
function buildRawTarGz(entries) {
  const blocks = entries.map(({ name, content }) => ustarEntry(name, content));
  blocks.push(Buffer.alloc(1024)); // two zero blocks = the tar EOF marker
  return zlib.gzipSync(Buffer.concat(blocks));
}

test("downloadFile: an archive entry named with a path-traversal ('../../') prefix never lands outside the destination", async () => {
  const marker = `alp-traversal-marker-${process.pid}-${Date.now()}.txt`;
  const archiveDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "alp-traversal-src-"),
  );
  const archiveFile = path.join(archiveDir, "archive.tar.gz");
  fs.writeFileSync(
    archiveFile,
    buildRawTarGz([
      { name: "tan", content: "the launcher\n" },
      // Two levels: `installArchive` extracts into a staging dir ONE level
      // inside the cache dir (`<destFile>.extract.<pid>.<ts>.tmp`), so `../`
      // alone would only reach the cache dir itself — `../../` is what it
      // takes to escape the cache dir into the shared OS temp root, the
      // sharpest version of "written outside the destination" this test can
      // demonstrate without touching a real filesystem root.
      { name: `../../${marker}`, content: "must never land here\n" },
    ]),
  );
  await withSystem32TarFirst(() =>
    withReleaseServer(archiveFile, null, async (baseUrl) => {
      const { dir, dest } = tmpCacheDir("tan");
      const outcome = await rejectionOf(
        downloadFile(`${baseUrl}/asset`, dest, null, { platform: "linux" }),
      );
      // #465 finding 5: MEASURED on both extractors this repo runs on (GNU
      // tar 1.34, bsdtar 3.8.4/System32) — a `../../` member makes `tar`
      // exit non-zero and refuse the whole archive, which `runTar` turns
      // into a rejection. Pinned as an assertion, not an assumption: if a
      // future host's tar instead SANITIZED the entry (stripped the leading
      // `../../` and wrote it under the extraction root) this would catch
      // that shift rather than silently taking the `outcome` truthy branch
      // below on a host where it happens not to hold — which is what made
      // the un-taken branch here dead in the first place.
      assert.ok(
        outcome,
        "a `../../` archive member did not cause a refusal — extractor " +
          "behaviour changed, and the containment assumptions below need " +
          "re-checking against it",
      );
      assert.ok(
        !fs.existsSync(dest),
        "a refused archive must leave nothing installed, including the launcher",
      );
      // Whichever way the host tar handles the unsafe member — silently
      // sanitized (GNU tar strips a leading `../`; bsdtar refuses to write
      // outside the extraction root by default) or an outright non-zero exit
      // `runTar` turns into a rejection — is acceptable; what must NEVER be
      // true is the marker existing outside `dir`.
      assert.ok(
        !fs.existsSync(path.join(os.tmpdir(), marker)),
        "a `../../` archive member escaped into the shared OS temp root",
      );
      // THE CACHE DIR ITSELF, not `path.join(dir, "..", marker)` — `dir` is
      // already an `os.tmpdir()` mkdtemp, so that path and the one above
      // resolve to the SAME location and neither one checks the spot a
      // STRIPPED (not refused) member would actually land: one `../` from
      // the extraction root (`installArchive`'s staging dir, one level
      // inside `dir`) reaches `dir` itself, and `installArchive`'s own move
      // loop (download.ts, "every extracted top-level entry is moved into
      // the cache dir") would then install it there as a top-level sibling
      // of the launcher.
      assert.ok(
        !fs.existsSync(path.join(dir, marker)),
        "a `../../` archive member landed as a top-level entry in the cache directory",
      );
    }),
  );
});

// ── #463: which candidate NAME a release published, resolved from its own
//    checksums.txt — the bug this file's other tests do not cover, because
//    they all start from a URL that already names the right asset. A pin
//    naming a RAW release and a pin naming an ARCHIVE release must both
//    resolve `releaseAssetForTarget`'s two candidates (raw, archive) to the
//    one the release actually published, without comparing against a
//    version — see `resolvePublishedAsset` in download.ts. ──────────────────

/** Serve `manifest` at `/checksums.txt` on 127.0.0.1, run `fn(checksumsUrl)`,
 *  and always close the server after. Narrower than `withReleaseServer`
 *  above: these tests drive candidate SELECTION, which reads only
 *  `checksums.txt` and never touches an asset body. */
async function withChecksumsServer(manifest, fn) {
  const server = http.createServer((req, res) => {
    const body = manifest ?? "";
    res.writeHead(200, { "content-length": String(Buffer.byteLength(body)) });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}/checksums.txt`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** The four hosts tan-cli's PyInstaller matrix actually publishes an asset
 *  for (alplabai/tan-cli#252) — win32/arm64 and linux/arm64 are declared
 *  gaps and covered separately below. `{}` for `gaps`, same reason
 *  `scripts/check-cli-pin.mjs` passes it: these rows probe candidate NAMES,
 *  not whether the ACTIVE pin happens to publish this host. */
const PUBLISHED_HOSTS = [
  ["win32", "x64"],
  ["darwin", "x64"],
  ["darwin", "arm64"],
  ["linux", "x64"],
];

test("resolvePublishedAsset: each of the four published targets resolves to the ARCHIVE candidate when that is what checksums.txt lists", async () => {
  for (const [platform, arch] of PUBLISHED_HOSTS) {
    const asset = releaseAssetForTarget(platform, arch, "0.6.0", {});
    const [rawCandidate, archiveCandidate] = asset.candidates;
    const digest = sha256(Buffer.from("archive body"));
    await withChecksumsServer(
      `${digest}  ${archiveCandidate.assetName}\n`,
      async (checksumsUrl) => {
        const resolved = await resolvePublishedAsset(
          asset.candidates,
          checksumsUrl,
          {},
        );
        // #465: resolved carries the digest this same manifest read already
        // found, so `download` never fetches checksums.txt a second time.
        assert.deepEqual(
          resolved,
          { ...archiveCandidate, digest },
          `${platform}/${arch}: expected the archive candidate ` +
            `(${archiveCandidate.assetName}), not the raw one ` +
            `(${rawCandidate.assetName})`,
        );
      },
    );
  }
});

test("resolvePublishedAsset: the currently pinned RAW shape still resolves to the extensionless/.exe candidate", async () => {
  for (const [platform, arch] of PUBLISHED_HOSTS) {
    // 0.5.0-rc4 IS the currently pinned raw-shape release (SUPPORTED_CLI_VERSION
    // at the time of writing) — pinned by version string here so this test
    // keeps meaning "the raw shape" even after the pin itself moves on.
    const asset = releaseAssetForTarget(platform, arch, "0.5.0-rc4", {});
    const [rawCandidate] = asset.candidates;
    const digest = sha256(Buffer.from("raw body"));
    await withChecksumsServer(
      `${digest}  ${rawCandidate.assetName}\n`,
      async (checksumsUrl) => {
        const resolved = await resolvePublishedAsset(
          asset.candidates,
          checksumsUrl,
          {},
        );
        assert.deepEqual(resolved, { ...rawCandidate, digest });
      },
    );
  }
});

test("resolvePublishedAsset: a release listing BOTH candidates (a transition tag) resolves to the ARCHIVE, not candidates[0] (#465 finding 2)", async () => {
  // A release kept BOTH names for backward compatibility with an older
  // resolver that only knows the raw one. Picking raw here — "first match in
  // array order", i.e. `candidates[0]`, which is what `releaseAssetForTarget`
  // builds as [raw, archive] — would silently resurrect the 13.25-19.74 s
  // macOS onefile startup tan-cli#349 exists to kill: a VALID asset, correctly
  // verified, just the slow shape, with no error to catch the regression.
  const asset = releaseAssetForTarget("linux", "x64", "0.6.0", {});
  const [rawCandidate, archiveCandidate] = asset.candidates;
  const rawDigest = sha256(Buffer.from("raw body"));
  const archiveDigest = sha256(Buffer.from("archive body"));
  await withChecksumsServer(
    `${rawDigest}  ${rawCandidate.assetName}\n` +
      `${archiveDigest}  ${archiveCandidate.assetName}\n`,
    async (checksumsUrl) => {
      const resolved = await resolvePublishedAsset(
        asset.candidates,
        checksumsUrl,
        {},
      );
      assert.deepEqual(resolved, {
        ...archiveCandidate,
        digest: archiveDigest,
      });
    },
  );
});

test("resolvePublishedAsset: a release listing NEITHER candidate refuses loudly, naming both names tried — no crash, no silent fall-through", async () => {
  const asset = releaseAssetForTarget("linux", "x64", "0.6.0", {});
  await withChecksumsServer(
    // A real but UNRELATED entry — proves this is "neither candidate is
    // here", not "the file is empty/unparseable".
    `${sha256(Buffer.from("x"))}  some-other-tool-x86_64-unknown-linux-gnu\n`,
    async (checksumsUrl) => {
      const rejection = await rejectionOf(
        resolvePublishedAsset(asset.candidates, checksumsUrl, {}),
      );
      assert.ok(
        rejection instanceof ChecksumError,
        `expected a ChecksumError, got ${rejection && rejection.name}`,
      );
      assert.equal(rejection.kind, "unlisted");
      assert.match(rejection.message, /does not list any of the asset names/);
      for (const candidate of asset.candidates) {
        assert.ok(
          rejection.detail.includes(candidate.assetName),
          `detail must name the tried candidate ${candidate.assetName}: ${rejection.detail}`,
        );
      }
    },
  );
});

test("resolvePublishedAsset: an unfetchable checksums.txt refuses loudly rather than guessing a candidate", async () => {
  const asset = releaseAssetForTarget("linux", "x64", "0.6.0", {});
  const rejection = await rejectionOf(
    // Port 1 on loopback: refused immediately. No network, no waiting.
    resolvePublishedAsset(
      asset.candidates,
      "http://127.0.0.1:1/checksums.txt",
      {},
    ),
  );
  assert.ok(
    rejection instanceof ChecksumError,
    `expected a ChecksumError, got ${rejection && rejection.name}`,
  );
  assert.equal(rejection.kind, "unfetchable");
});

test("resolveAsset → download: checksums.txt is fetched ONCE for a managed download, not twice (#465 finding 3)", async () => {
  const RAW_NAME = "tan-x86_64-unknown-linux-gnu";
  const BODY = "raw body";
  const digest = sha256(Buffer.from(BODY));
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url === "/checksums.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(`${digest}  ${RAW_NAME}\n`);
      return;
    }
    res.writeHead(200, { "content-length": String(Buffer.byteLength(BODY)) });
    res.end(BODY);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { dir, dest } = tmpCacheDir(RAW_NAME);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const checksumsUrl = `${base}/checksums.txt`;
    const candidates = [
      { assetName: RAW_NAME, url: `${base}/asset` },
      { assetName: `${RAW_NAME}.tar.gz`, url: `${base}/asset.tar.gz` },
    ];

    // The exact wiring `downloadCli` (adapterCore.ts) drives: resolve the
    // candidate + its digest from ONE read of checksums.txt, then hand that
    // digest straight to the transfer rather than letting it fetch the same
    // file again to re-derive the value.
    const resolved = await resolvePublishedAsset(candidates, checksumsUrl, {});
    await downloadFile(resolved.url, dest, {
      assetName: resolved.assetName,
      checksumsUrl,
      digest: resolved.digest,
    });

    assert.equal(fs.readFileSync(dest, "utf8"), BODY);
    // tan-cli#176's design is TWO requests per managed download: checksums.txt
    // once, the asset once. Measured at THREE before #465 — resolveAsset's own
    // read, discarded after picking the candidate, then downloadFile fetching
    // checksums.txt again inside `publishedSha256` to re-derive the digest it
    // had a moment earlier.
    assert.deepEqual(
      requests,
      ["/checksums.txt", "/asset"],
      `expected exactly [checksums.txt, asset], got ${JSON.stringify(requests)}`,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
