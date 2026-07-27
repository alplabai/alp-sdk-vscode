// SPDX-License-Identifier: Apache-2.0
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { CliInUseError, downloadFile } = require("../out/alpCli/download.js");
// The real planner the caller feeds this rejection to. Imported (not mimicked)
// so "the customer reads this sentence" is asserted by the code that decides
// it — `planFailure` silently demotes a `cause` carrying an errno or an
// absolute path into the channel and toasts a generic "<operation> failed."
const { planFailure } = require("../out/notify/service.js");

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

/** Swap named `fs` functions for the duration of `fn`, always restoring after.
 *  The failures under test are Windows sharing violations (a `.old` leftover
 *  that is itself running/held open). These tests also run on Linux CI, where
 *  that lock cannot be provoked at all, so inject the error instead of the
 *  condition. download.ts reads `fs.<fn>` through the compiled namespace's live
 *  getters, so patching the module object is what the code under test sees. */
async function withFsStubs(stubs, fn) {
  const saved = {};
  for (const name of Object.keys(stubs)) {
    saved[name] = fs[name];
    fs[name] = stubs[name];
  }
  try {
    return await fn();
  } finally {
    for (const name of Object.keys(saved)) {
      fs[name] = saved[name];
    }
  }
}

/** A Windows sharing violation as Node reports it. The production log said
 *  EBUSY, a controlled repro said EPERM — the fix must not key on either. */
function sharingViolation(target) {
  const error = new Error(
    `EBUSY: resource busy or locked, rename -> '${target}'`,
  );
  error.code = "EBUSY";
  return error;
}

function serveBody(body) {
  return (req, res) => {
    res.writeHead(200, { "content-length": String(body.length) });
    res.end(body);
  };
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

test("downloadFile: a locked leftover the sweep cannot delete does not abort the download", async () => {
  const body = Buffer.from("fresh tan binary\n");
  await withServer(serveBody(body), async (baseUrl) => {
    const { dir, dest } = tmpDest();
    const leftover = `${dest}.old`;
    fs.writeFileSync(leftover, "a previous binary, still running");
    const realRm = fs.rmSync;
    await withFsStubs(
      {
        // `force: true` does NOT swallow this: on Windows `rmSync` raises
        // EPERM/EBUSY on a file that is still executing, and `maxRetries`
        // doesn't help because the violation lasts as long as the holder.
        rmSync: (target, options) => {
          if (target === leftover) {
            throw sharingViolation(leftover);
          }
          return realRm(target, options);
        },
      },
      // The sweep runs before a single byte is fetched, so a throw here used
      // to kill the upgrade outright.
      () => downloadFile(`${baseUrl}/asset`, dest),
    );
    assert.deepEqual(fs.readFileSync(dest), body);
    // The undeletable leftover survives to the next sweep, as documented.
    assert.ok(fs.readdirSync(dir).includes(path.basename(leftover)));
  });
});

test("downloadFile: a locked .old slot falls back to a unique suffix and completes", async () => {
  const body = Buffer.from("fresh tan binary\n");
  await withServer(serveBody(body), async (baseUrl) => {
    const { dir, dest } = tmpDest();
    fs.writeFileSync(dest, "the installed tan binary");
    const realRename = fs.renameSync;
    await withFsStubs(
      {
        // The DESTINATION of the rename-aside is what's locked (a `.old` from
        // an earlier update that is itself running), not the source.
        renameSync: (from, to) => {
          if (to === `${dest}.old`) {
            throw sharingViolation(to);
          }
          return realRename(from, to);
        },
      },
      () => downloadFile(`${baseUrl}/asset`, dest),
    );
    assert.deepEqual(
      fs.readFileSync(dest),
      body,
      "the upgrade must land even though `<dest>.old` was taken",
    );
    const aside = fs
      .readdirSync(dir)
      .filter((e) => e.endsWith(".old") && e !== `${path.basename(dest)}.old`);
    assert.equal(aside.length, 1, `expected one uniquely-named .old: ${aside}`);
    assert.equal(
      fs.readFileSync(path.join(dir, aside[0]), "utf8"),
      "the installed tan binary",
      "the previous binary is moved aside, not destroyed",
    );
    // …and it is sweepable: same prefix + `.old` suffix the sweep matches.
    assert.ok(aside[0].startsWith(path.basename(dest)));
  });
});

test("downloadFile: a first-ever download (no previous binary) stays silent", async () => {
  const body = Buffer.from("first install\n");
  await withServer(serveBody(body), async (baseUrl) => {
    const { dir, dest } = tmpDest();
    const targets = [];
    const realRename = fs.renameSync;
    await withFsStubs(
      {
        renameSync: (from, to) => {
          targets.push(to);
          return realRename(from, to);
        },
      },
      // Nothing at `dest`, so the rename-aside throws a real ENOENT. That is
      // the expected first-download case, not a locked destination: it must
      // not escalate to the unique-suffix retry (which would ENOENT too, and
      // surface as a bogus "CLI is in use" failure).
      () => downloadFile(`${baseUrl}/asset`, dest),
    );
    assert.deepEqual(fs.readFileSync(dest), body);
    assert.deepEqual(
      fs.readdirSync(dir),
      [path.basename(dest)],
      "no `.old` of any name is created when there was no previous binary",
    );
    assert.deepEqual(
      targets,
      [`${dest}.old`, dest],
      "exactly one retry-free aside attempt",
    );
  });
});

test("downloadFile: when the installed binary cannot be moved aside at all, the failure is a CliInUseError the customer can act on", async () => {
  const body = Buffer.from("fresh tan binary\n");
  await withServer(serveBody(body), async (baseUrl) => {
    const { dir, dest } = tmpDest();
    fs.writeFileSync(dest, "the installed tan binary");
    const realRename = fs.renameSync;
    let rejection;
    await withFsStubs(
      {
        renameSync: (from, to) => {
          if (to.endsWith(".old")) {
            throw sharingViolation(to);
          }
          return realRename(from, to);
        },
      },
      async () => {
        rejection = await downloadFile(`${baseUrl}/asset`, dest).then(
          () => null,
          (error) => error,
        );
      },
    );
    assert.ok(rejection, "a silent no-op strands the customer on the old CLI");
    // TAGGED, not sniffed: the caller (src/alpCli/vscodeAdapter.ts) has to
    // present this failure backwards from every other one — no "Retry", since
    // the identical rename hits the identical holder — and it branches on the
    // type. A plain Error sends it down the network-outage wording instead.
    assert.ok(
      rejection instanceof CliInUseError,
      `the both-renames-failed rejection must be a CliInUseError, got ${rejection.name}`,
    );
    // The caller uses this message as the TOAST body, so it must read as a
    // remedy, not as a bare errno.
    assert.match(rejection.message, /already installed is in use/);
    assert.match(rejection.message, /Close any other VS Code windows/);
    assert.doesNotMatch(
      rejection.message,
      /\bE(?:BUSY|PERM|ACCES|NOENT)\b/,
      "an errno in the sentence gets the whole toast demoted to a generic one",
    );
    assert.doesNotMatch(
      rejection.message,
      /[A-Za-z]:[\\/]|(?:^|[\s"'(])\/(?:home|Users|tmp|var)\//,
      "an absolute path in the sentence gets the toast demoted the same way",
    );
    // …and the raw errno is not lost, it just travels on the channel-only side.
    assert.match(rejection.detail, /EBUSY/);
    assert.ok(
      rejection.detail.includes(dest),
      "the locked path belongs on the channel-only detail",
    );
    // The end of the wire: exactly what `cliInUsePlan` builds. The sentence has
    // to survive `planFailure` intact — if it doesn't, the customer reads
    // "Updating the tan CLI failed." and the one instruction that helps is
    // behind a Show Output click, which is the defect this test pins shut.
    const plan = planFailure({
      operation: "Updating the tan CLI",
      cause: rejection.message,
      detail: rejection.detail,
      actions: [{ id: "reloadWindow" }],
    });
    assert.equal(
      plan.message,
      rejection.message,
      "the in-use sentence must reach the toast, not the output channel",
    );
    assert.match(plan.detail, /EBUSY/, "the errno still reaches the channel");
    assert.deepEqual(
      plan.actions.map((a) => a.id),
      ["reloadWindow"],
      "no Retry: re-running the same rename against the same holder cannot work",
    );
    assert.equal(
      fs.readFileSync(dest, "utf8"),
      "the installed tan binary",
      "the working binary stays in place",
    );
    assert.deepEqual(
      fs.readdirSync(dir),
      [path.basename(dest)],
      "no temp file left behind",
    );
  });
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
