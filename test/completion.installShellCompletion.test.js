// SPDX-License-Identifier: Apache-2.0
//
// `src/completion.ts` — `alp.installShellCompletion` (#621). Loaded through
// the same `Module._load` swap `test/alpCli.doctor.test.js` uses, but
// `./notify/service` is deliberately left UNSTUBBED: it is pure (no vscode,
// no fs — see its own file header) and is loaded for real out of `out/`, so
// these tests check the REAL `NotificationPlan` shapes this module hands to
// the presenter, not a hand-rolled guess at them. Everything that actually
// touches the outside world — `vscode`, `fs`, `os`, the `tan` spawn, and the
// presenter itself (`./notify/vscodeAdapter`) — is faked.
//
// `fs` and `os` default to THROWING on every call unless a test explicitly
// scripts a response: a stub that silently no-ops on an unscripted write is
// exactly how an accidental bash/zsh filesystem write would go unnoticed.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");

const root = path.join(__dirname, "..");

function loadCompletion(stubs) {
  // The cwd seam EVERY tan spawn resolves through (#605), defaulted here rather
  // than repeated in thirteen stub tables. The real one reads
  // `vscode.workspace`, which none of these cases build; a case that wants to
  // observe the cwd can still override it.
  stubs = {
    "./project/vscodeAdapter": { readOnlyProjectCwd: () => "/home/dev/proj" },
    ...stubs,
  };
  const modPath = require.resolve(path.join(root, "out", "completion.js"));
  delete require.cache[modPath];
  const originalLoad = Module._load;
  Module._load = function (request, ...rest) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad.call(this, request, ...rest);
  };
  try {
    return require(modPath);
  } finally {
    Module._load = originalLoad;
    delete require.cache[modPath];
  }
}

function throwingFsStub(overrides = {}) {
  const calls = { existsSync: [], mkdirSync: [], writeFileSync: [] };
  const fs = {};
  for (const name of ["existsSync", "mkdirSync", "writeFileSync"]) {
    fs[name] = (...args) => {
      calls[name].push(args);
      if (overrides[name]) return overrides[name](...args);
      throw new Error(
        `unscripted fs.${name}(${args.map((a) => String(a)).join(", ")})`,
      );
    };
  }
  return { fs, calls };
}

function throwingOsStub() {
  return {
    homedir: () => {
      throw new Error("unscripted os.homedir()");
    },
  };
}

function osStubWithHomedir(homedir) {
  return { homedir: () => homedir };
}

function makeVscodeStub({ quickPickResult } = {}) {
  const calls = {
    showQuickPick: [],
    openTextDocument: [],
    showTextDocument: [],
  };
  const vscode = {
    window: {
      showQuickPick: async (items, options) => {
        calls.showQuickPick.push({ items, options });
        return typeof quickPickResult === "function"
          ? quickPickResult(items, options)
          : quickPickResult;
      },
      showTextDocument: async (doc, options) => {
        calls.showTextDocument.push({ doc, options });
      },
    },
    workspace: {
      openTextDocument: async (options) => {
        calls.openTextDocument.push(options);
        return { __fakeDoc: true, ...options };
      },
    },
  };
  return { vscode, calls };
}

function makeRunAlpCommandStub(impl) {
  const calls = [];
  return {
    calls,
    mod: {
      runAlpCommand: async (...args) => {
        calls.push(args);
        return impl(...args);
      },
    },
  };
}

function makeNotifyStub({ notifyResult } = {}) {
  const notifyCalls = [];
  const notifyAsyncCalls = [];
  return {
    notifyCalls,
    notifyAsyncCalls,
    mod: {
      notify: async (plan) => {
        notifyCalls.push(plan);
        return typeof notifyResult === "function"
          ? notifyResult(plan)
          : notifyResult;
      },
      notifyAsync: (plan) => {
        notifyAsyncCalls.push(plan);
      },
    },
  };
}

function makeLogStub() {
  const lines = [];
  return {
    lines,
    mod: { log: (line, level) => lines.push({ line, level: level ?? "info" }) },
  };
}

/** Mutate `process.env` for the duration of `fn`, then restore it exactly —
 *  `detectShellFromEnv`/`resolveShell` read `process.env` directly (by
 *  design: see `src/completion.ts`'s own doc on why that stays a parameter
 *  everywhere else but the one real call site). */
async function withEnv(patch, fn) {
  const original = {};
  for (const key of Object.keys(patch)) {
    original[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  }
}

function okOutcome(shell, script, issues = []) {
  return {
    outcome: {
      ok: true,
      exitCode: 0,
      kind: "success",
      severity: "info",
      message: "ok",
      envelope: {
        command: "completion",
        ok: true,
        exitCode: 0,
        project: { root: null, boardYaml: null },
        data: { schemaVersion: "1", shell, script },
        issues,
      },
    },
  };
}

// ── pure helpers ─────────────────────────────────────────────────────────

test("detectShellFromEnv reads $SHELL's basename, case-insensitively, and rejects anything unsupported", () => {
  const { detectShellFromEnv } = loadCompletion({
    vscode: {},
    fs: {},
    os: {},
    "./alpCli/vscodeAdapter": {
      runAlpCommand: () => {
        throw new Error("unscripted");
      },
    },
    "./notify/vscodeAdapter": {
      notify: () => {
        throw new Error("unscripted");
      },
      notifyAsync: () => {
        throw new Error("unscripted");
      },
    },
    "./util": { log() {} },
  });

  assert.equal(detectShellFromEnv({ SHELL: "/bin/bash" }), "bash");
  assert.equal(detectShellFromEnv({ SHELL: "/usr/bin/ZSH" }), "zsh");
  assert.equal(detectShellFromEnv({ SHELL: "/opt/homebrew/bin/fish" }), "fish");
  assert.equal(
    detectShellFromEnv({ SHELL: "/bin/sh" }),
    null,
    "a real but unsupported shell must not be silently mapped to one tan supports",
  );
  assert.equal(
    detectShellFromEnv({}),
    null,
    "no $SHELL at all -> null, never a guessed default",
  );
});

test("fishCompletionPath follows fish's own XDG convention, not a guess", () => {
  const { fishCompletionPath } = loadCompletion({
    vscode: {},
    fs: {},
    os: {},
    "./alpCli/vscodeAdapter": { runAlpCommand: () => {} },
    "./notify/vscodeAdapter": { notify: () => {}, notifyAsync: () => {} },
    "./util": { log() {} },
  });

  assert.equal(
    fishCompletionPath({ XDG_CONFIG_HOME: "/custom/cfg" }, "/home/dev"),
    path.join("/custom/cfg", "fish", "completions", "tan.fish"),
  );
  assert.equal(
    fishCompletionPath({}, "/home/dev"),
    path.join("/home/dev", ".config", "fish", "completions", "tan.fish"),
    "no XDG_CONFIG_HOME -> fish's own documented fallback, ~/.config",
  );
  assert.equal(
    fishCompletionPath({ XDG_CONFIG_HOME: "   " }, "/home/dev"),
    path.join("/home/dev", ".config", "fish", "completions", "tan.fish"),
    "a blank XDG_CONFIG_HOME is not a real override",
  );
});

test("isCompletionEnvelopeData narrows strictly — missing or mistyped fields are rejected, never coerced", () => {
  const { isCompletionEnvelopeData } = loadCompletion({
    vscode: {},
    fs: {},
    os: {},
    "./alpCli/vscodeAdapter": { runAlpCommand: () => {} },
    "./notify/vscodeAdapter": { notify: () => {}, notifyAsync: () => {} },
    "./util": { log() {} },
  });

  assert.equal(
    isCompletionEnvelopeData({
      schemaVersion: "1",
      shell: "bash",
      script: "x",
    }),
    true,
  );
  assert.equal(isCompletionEnvelopeData(null), false);
  assert.equal(isCompletionEnvelopeData("a raw script string"), false);
  assert.equal(
    isCompletionEnvelopeData({ schemaVersion: "1", shell: "bash" }),
    false,
    "a missing `script` key must fail closed, not read as an empty script",
  );
  assert.equal(
    isCompletionEnvelopeData({
      schemaVersion: "1",
      shell: "bash",
      script: 123,
    }),
    false,
    "a wrong-typed `script` must fail closed",
  );
});

// ── installShellCompletion: shell resolution ───────────────────────────────

test("a detected $SHELL skips the picker and passes args/cwd/options to runAlpCommand verbatim", async () => {
  const vs = makeVscodeStub();
  const run = makeRunAlpCommandStub(async () => okOutcome("zsh", "echo zsh"));
  const notifySeam = makeNotifyStub();
  const logSeam = makeLogStub();
  const { fs } = throwingFsStub();

  const { installShellCompletion } = loadCompletion({
    vscode: vs.vscode,
    fs,
    os: throwingOsStub(),
    "./alpCli/vscodeAdapter": run.mod,
    "./notify/vscodeAdapter": notifySeam.mod,
    "./util": logSeam.mod,
  });

  await withEnv({ SHELL: "/usr/bin/zsh" }, () =>
    installShellCompletion({ marker: "ctx" }),
  );

  assert.equal(
    vs.calls.showQuickPick.length,
    0,
    "a detected shell must never show the picker",
  );
  assert.equal(run.calls.length, 1);
  const [context, args, cwd, options] = run.calls[0];
  assert.deepEqual(context, { marker: "ctx" });
  assert.deepEqual(args, ["completion", "--shell", "zsh"]);
  assert.equal(
    cwd,
    "/home/dev/proj",
    "`completion` emits a static script and does not read the project, so " +
      "this is the one spawn here where cwd genuinely changes nothing — but " +
      '"changes nothing today" is not a reason to inherit the extension ' +
      "host's own directory (on Windows, the VS Code install directory), and " +
      "`test/tan.spawnCwd.test.js` rightly refuses to special-case a verb on " +
      "that argument (#605)",
  );
  assert.deepEqual(options, { interactive: true });
});

test("no $SHELL and a dismissed picker installs nothing and never calls tan", async () => {
  const vs = makeVscodeStub({ quickPickResult: undefined });
  const run = makeRunAlpCommandStub(async () => {
    throw new Error(
      "runAlpCommand must not be called after a dismissed picker",
    );
  });
  const notifySeam = makeNotifyStub();
  const logSeam = makeLogStub();
  const { fs } = throwingFsStub();

  const { installShellCompletion } = loadCompletion({
    vscode: vs.vscode,
    fs,
    os: throwingOsStub(),
    "./alpCli/vscodeAdapter": run.mod,
    "./notify/vscodeAdapter": notifySeam.mod,
    "./util": logSeam.mod,
  });

  await withEnv({ SHELL: undefined }, () => installShellCompletion({}));

  assert.equal(vs.calls.showQuickPick.length, 1);
  assert.equal(run.calls.length, 0);
  assert.equal(notifySeam.notifyCalls.length, 0);
  assert.equal(notifySeam.notifyAsyncCalls.length, 0);
});

test("no $SHELL falls back to a picker offering exactly bash/zsh/fish, and the pick is what tan is asked for", async () => {
  const vs = makeVscodeStub({
    quickPickResult: (items) => items.find((i) => i.shell === "fish"),
  });
  const run = makeRunAlpCommandStub(async () =>
    okOutcome("fish", "complete -c tan"),
  );
  // The fish confirm gate fires after resolution — decline it so this test
  // stays about the picker contract, not the write path (covered below).
  const notifySeam = makeNotifyStub({ notifyResult: undefined });
  const logSeam = makeLogStub();
  const { fs, calls: fsCalls } = throwingFsStub({ existsSync: () => false });

  const { installShellCompletion } = loadCompletion({
    vscode: vs.vscode,
    fs,
    os: osStubWithHomedir("/home/dev"),
    "./alpCli/vscodeAdapter": run.mod,
    "./notify/vscodeAdapter": notifySeam.mod,
    "./util": logSeam.mod,
  });

  await withEnv({ SHELL: undefined }, () => installShellCompletion({}));

  const { items } = vs.calls.showQuickPick[0];
  assert.deepEqual(
    items.map((i) => i.shell),
    ["bash", "zsh", "fish"],
  );
  assert.equal(run.calls.length, 1);
  assert.deepEqual(run.calls[0][1], ["completion", "--shell", "fish"]);
  assert.equal(
    fsCalls.writeFileSync.length,
    0,
    "a declined confirm must not write",
  );
});

// ── installShellCompletion: CLI outcome handling ────────────────────────────

test("tan being unavailable surfaces the real planCliOutcome plan, fire-and-forget, and does nothing else", async () => {
  const vs = makeVscodeStub();
  const run = makeRunAlpCommandStub(async () => ({
    outcome: {
      ok: false,
      exitCode: -1,
      kind: "unknown",
      severity: "error",
      message: "Could not run the tan CLI.",
      envelope: null,
      unavailable: { reason: "notInstalled" },
    },
  }));
  const notifySeam = makeNotifyStub();
  const logSeam = makeLogStub();
  const { fs } = throwingFsStub();

  const { installShellCompletion } = loadCompletion({
    vscode: vs.vscode,
    fs,
    os: throwingOsStub(),
    "./alpCli/vscodeAdapter": run.mod,
    "./notify/vscodeAdapter": notifySeam.mod,
    "./util": logSeam.mod,
  });

  await withEnv({ SHELL: "/bin/bash" }, () => installShellCompletion({}));

  assert.equal(
    notifySeam.notifyCalls.length,
    0,
    "a CLI failure must never open a confirm dialog",
  );
  assert.equal(notifySeam.notifyAsyncCalls.length, 1);
  const plan = notifySeam.notifyAsyncCalls[0];
  // This is the REAL `planCliOutcome`'s `notInstalled` sentence
  // (`src/notify/service.ts`'s `unavailablePlan`), not a guess at it.
  assert.equal(
    plan.message,
    "Fetching the tan shell completion script needs the tan CLI, which isn't installed yet.",
  );
  assert.equal(plan.severity, "error");
  assert.deepEqual(plan.actions, [{ id: "installTanCli" }, { id: "retry" }]);
  assert.equal(vs.calls.openTextDocument.length, 0);
});

test("ok:true with an unreadable payload is reported as a failure, never as a success (narrow, never cast)", async () => {
  const vs = makeVscodeStub();
  const run = makeRunAlpCommandStub(async () => ({
    outcome: {
      ok: true,
      exitCode: 0,
      kind: "success",
      severity: "info",
      message: "ok",
      envelope: {
        command: "completion",
        ok: true,
        exitCode: 0,
        project: { root: null, boardYaml: null },
        // `script` missing entirely — the exact shape a future tan schema
        // drift would produce, and the shape `?? ""` would silently paper
        // over as an empty "success".
        data: { schemaVersion: "2", shell: "bash" },
        issues: [],
      },
    },
  }));
  const notifySeam = makeNotifyStub();
  const logSeam = makeLogStub();
  const { fs } = throwingFsStub();

  const { installShellCompletion } = loadCompletion({
    vscode: vs.vscode,
    fs,
    os: throwingOsStub(),
    "./alpCli/vscodeAdapter": run.mod,
    "./notify/vscodeAdapter": notifySeam.mod,
    "./util": logSeam.mod,
  });

  await withEnv({ SHELL: "/bin/bash" }, () => installShellCompletion({}));

  assert.equal(notifySeam.notifyAsyncCalls.length, 1);
  const plan = notifySeam.notifyAsyncCalls[0];
  assert.equal(
    plan.message,
    "Alp: tan didn't return a completion script this extension could read.",
    "must never claim success off an unreadable payload",
  );
  assert.equal(vs.calls.openTextDocument.length, 0);
});

test("issues[] are logged to the channel on every outcome, including ok:true", async () => {
  const vs = makeVscodeStub();
  const run = makeRunAlpCommandStub(async () =>
    okOutcome("bash", "echo hi", [
      {
        code: "completion.stub-note",
        severity: "warning",
        message: "a stub-only note",
      },
    ]),
  );
  const notifySeam = makeNotifyStub();
  const logSeam = makeLogStub();
  const { fs } = throwingFsStub();

  const { installShellCompletion } = loadCompletion({
    vscode: vs.vscode,
    fs,
    os: throwingOsStub(),
    "./alpCli/vscodeAdapter": run.mod,
    "./notify/vscodeAdapter": notifySeam.mod,
    "./util": logSeam.mod,
  });

  await withEnv({ SHELL: "/bin/bash" }, () => installShellCompletion({}));

  assert.ok(
    logSeam.lines.some((l) => l.line.includes("warning: a stub-only note")),
    "an issue present on an ok:true outcome must still reach the channel",
  );
});

// ── installShellCompletion: bash/zsh — the conservative shape ──────────────

for (const shell of ["bash", "zsh"]) {
  test(`${shell}: the script is shown in an untitled editor with a one-line instruction, never written to disk`, async () => {
    const vs = makeVscodeStub();
    const run = makeRunAlpCommandStub(async () =>
      okOutcome(shell, `# ${shell} completion body`),
    );
    const notifySeam = makeNotifyStub();
    const logSeam = makeLogStub();
    // No fs/os call is scripted at all — either one firing throws and fails
    // the test, which is exactly the point for a shell with no unambiguous
    // conventional write target.
    const { fs } = throwingFsStub();

    const { installShellCompletion } = loadCompletion({
      vscode: vs.vscode,
      fs,
      os: throwingOsStub(),
      "./alpCli/vscodeAdapter": run.mod,
      "./notify/vscodeAdapter": notifySeam.mod,
      "./util": logSeam.mod,
    });

    await withEnv({ SHELL: `/bin/${shell}` }, () => installShellCompletion({}));

    assert.equal(vs.calls.openTextDocument.length, 1);
    const opened = vs.calls.openTextDocument[0];
    assert.equal(opened.language, "shellscript");
    assert.ok(
      opened.content.startsWith("# tan completion for " + shell),
      "the one-line instruction must lead the document",
    );
    assert.ok(opened.content.includes(`# ${shell} completion body`));
    assert.equal(vs.calls.showTextDocument.length, 1);
    assert.equal(vs.calls.showTextDocument[0].options.preview, false);
    // No confirm, no toast — opening an editor is the whole action.
    assert.equal(notifySeam.notifyCalls.length, 0);
    assert.equal(notifySeam.notifyAsyncCalls.length, 0);
  });
}

// ── installShellCompletion: fish — the one real write path ─────────────────

test("fish: the confirm names the exact path, and a decline falls back to the editor without writing", async () => {
  const vs = makeVscodeStub();
  const run = makeRunAlpCommandStub(async () =>
    okOutcome("fish", "complete -c tan -f"),
  );
  const notifySeam = makeNotifyStub({ notifyResult: undefined }); // Cancel/dismiss
  const logSeam = makeLogStub();
  const { fs, calls: fsCalls } = throwingFsStub({ existsSync: () => false });

  const { installShellCompletion } = loadCompletion({
    vscode: vs.vscode,
    fs,
    os: osStubWithHomedir("/home/dev"),
    "./alpCli/vscodeAdapter": run.mod,
    "./notify/vscodeAdapter": notifySeam.mod,
    "./util": logSeam.mod,
  });

  await withEnv({ SHELL: "/usr/bin/fish", XDG_CONFIG_HOME: undefined }, () =>
    installShellCompletion({}),
  );

  assert.equal(notifySeam.notifyCalls.length, 1);
  const confirmPlan = notifySeam.notifyCalls[0];
  const expectedPath = path.join(
    "/home/dev",
    ".config",
    "fish",
    "completions",
    "tan.fish",
  );
  assert.ok(
    confirmPlan.modalDetail.includes(expectedPath),
    "the confirm must name the exact path that would be written",
  );
  assert.equal(confirmPlan.channel, "modal");

  assert.equal(fsCalls.writeFileSync.length, 0, "a decline must never write");
  assert.equal(fsCalls.mkdirSync.length, 0);
  assert.equal(
    vs.calls.openTextDocument.length,
    1,
    "decline falls back to the editor",
  );
  assert.ok(
    vs.calls.openTextDocument[0].content.includes("complete -c tan -f"),
  );
});

test("fish: an accepted confirm writes the whole file at the exact path and reports success", async () => {
  const vs = makeVscodeStub();
  const script = "complete -c tan -f\n";
  const run = makeRunAlpCommandStub(async () => okOutcome("fish", script));
  const notifySeam = makeNotifyStub({ notifyResult: "custom" }); // the Install button
  const logSeam = makeLogStub();
  const { fs, calls: fsCalls } = throwingFsStub({
    existsSync: () => true, // pre-existing file -> the confirm must say "overwrite"
    mkdirSync: () => undefined,
    writeFileSync: () => undefined,
  });

  const { installShellCompletion } = loadCompletion({
    vscode: vs.vscode,
    fs,
    os: osStubWithHomedir("/home/dev"),
    "./alpCli/vscodeAdapter": run.mod,
    "./notify/vscodeAdapter": notifySeam.mod,
    "./util": logSeam.mod,
  });

  await withEnv(
    { SHELL: "/usr/bin/fish", XDG_CONFIG_HOME: "/home/dev/.config" },
    () => installShellCompletion({}),
  );

  const expectedPath = path.join(
    "/home/dev/.config",
    "fish",
    "completions",
    "tan.fish",
  );
  assert.ok(
    notifySeam.notifyCalls[0].modalDetail.includes("overwrite"),
    "an existing file must be named as an overwrite, not a silent create",
  );
  assert.equal(fsCalls.mkdirSync.length, 1);
  assert.equal(fsCalls.mkdirSync[0][0], path.dirname(expectedPath));
  assert.equal(fsCalls.writeFileSync.length, 1);
  assert.equal(fsCalls.writeFileSync[0][0], expectedPath);
  assert.equal(
    fsCalls.writeFileSync[0][1],
    script,
    "the whole script, verbatim — never appended to anything",
  );
  assert.equal(
    vs.calls.openTextDocument.length,
    0,
    "a successful write needs no editor fallback",
  );

  assert.equal(notifySeam.notifyAsyncCalls.length, 1);
  assert.equal(notifySeam.notifyAsyncCalls[0].severity, "info");
});

test("fish: a failed write reports the failure and still falls back to the editor", async () => {
  const vs = makeVscodeStub();
  const script = "complete -c tan -f\n";
  const run = makeRunAlpCommandStub(async () => okOutcome("fish", script));
  const notifySeam = makeNotifyStub({ notifyResult: "custom" });
  const logSeam = makeLogStub();
  const { fs, calls: fsCalls } = throwingFsStub({
    existsSync: () => false,
    mkdirSync: () => undefined,
    writeFileSync: () => {
      throw Object.assign(new Error("EACCES: permission denied"), {
        code: "EACCES",
      });
    },
  });

  const { installShellCompletion } = loadCompletion({
    vscode: vs.vscode,
    fs,
    os: osStubWithHomedir("/home/dev"),
    "./alpCli/vscodeAdapter": run.mod,
    "./notify/vscodeAdapter": notifySeam.mod,
    "./util": logSeam.mod,
  });

  await withEnv({ SHELL: "/usr/bin/fish", XDG_CONFIG_HOME: undefined }, () =>
    installShellCompletion({}),
  );

  assert.equal(fsCalls.writeFileSync.length, 1);
  assert.equal(notifySeam.notifyAsyncCalls.length, 1);
  const plan = notifySeam.notifyAsyncCalls[0];
  assert.equal(plan.message, "Alp: couldn't write the fish completion file.");
  assert.ok(
    !/EACCES/.test(plan.message),
    "the raw errno must never reach the customer-facing message",
  );
  assert.ok(
    plan.detail.includes("EACCES"),
    "the raw errno belongs on channel-only detail",
  );
  assert.equal(
    vs.calls.openTextDocument.length,
    1,
    "a failed write must still hand the customer the script",
  );
});
