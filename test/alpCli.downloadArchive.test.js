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

const { ChecksumError, downloadFile } = require("../out/alpCli/download.js");

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** The real bsdtar Windows ships in System32 — used here to BUILD fixtures,
 *  not just to unpack them. A bare `"tar"` would risk resolving to Git for
 *  Windows' GNU tar on a dev machine (it cannot write `.zip` at all), so
 *  fixture creation is pinned to the same absolute path production code
 *  resolves for the `win32` extraction case (see `tarExecutable` in
 *  download.ts) — deterministic regardless of this host's PATH order. */
function systemTar() {
  return path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "tar.exe",
  );
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

test("downloadFile: archive vs raw binary is decided by the downloaded bytes, not by destFile's own extension", async () => {
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
});

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

test("downloadFile: an archive's checksum is verified BEFORE it is ever unpacked", async () => {
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
});
