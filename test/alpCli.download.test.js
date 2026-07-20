// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { downloadFile } = require("../out/alpCli/download.js");

/** Start a server on 127.0.0.1:0, run `fn(baseUrl)`, and always close it after
 *  (so a rejected/hanging download never leaves a listening handle around). */
async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function tmpDest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alp-dl-test-"));
  return { dir, dest: path.join(dir, "tan.exe") };
}

test(
  "downloadFile: truncated body (content-length lies) rejects and leaves no file behind",
  { timeout: 10_000 },
  async () => {
    await withServer(
      (req, res) => {
        res.writeHead(200, { "content-length": "1000" });
        res.write(Buffer.alloc(10, "a"));
        // Simulate a dropped connection well short of the advertised length.
        setTimeout(() => res.destroy(), 20);
      },
      async (baseUrl) => {
        const { dir, dest } = tmpDest();
        await assert.rejects(() => downloadFile(`${baseUrl}/asset`, dest));
        assert.ok(!fs.existsSync(dest), "destination must not exist");
        assert.deepEqual(
          fs.readdirSync(dir),
          [],
          "no leftover temp file in the destination directory",
        );
      },
    );
  },
);

test("downloadFile: success writes the exact expected bytes to the destination", async () => {
  const body = Buffer.from("hello from the tan-cli release asset\n");
  await withServer(
    (req, res) => {
      res.writeHead(200, { "content-length": String(body.length) });
      res.end(body);
    },
    async (baseUrl) => {
      const { dir, dest } = tmpDest();
      await downloadFile(`${baseUrl}/asset`, dest);
      assert.ok(fs.existsSync(dest));
      assert.deepEqual(fs.readFileSync(dest), body);
      // No leftover temp file next to the renamed-into-place destination.
      assert.deepEqual(fs.readdirSync(dir), [path.basename(dest)]);
    },
  );
});

test("downloadFile: HTTP 404 rejects", async () => {
  await withServer(
    (req, res) => {
      res.writeHead(404);
      res.end("not found");
    },
    async (baseUrl) => {
      const { dest } = tmpDest();
      await assert.rejects(
        () => downloadFile(`${baseUrl}/missing`, dest),
        /Download failed \(HTTP 404\)/,
      );
    },
  );
});

test(
  "downloadFile: a redirect loop past the cap rejects (does not hang)",
  { timeout: 10_000 },
  async () => {
    await withServer(
      (req, res) => {
        // Every request redirects back to the same relative path — an
        // unbounded loop without the depth cap.
        res.writeHead(302, { location: req.url });
        res.end();
      },
      async (baseUrl) => {
        const { dest } = tmpDest();
        await assert.rejects(
          () => downloadFile(`${baseUrl}/loop`, dest),
          /Too many redirects/,
        );
      },
    );
  },
);
