// SPDX-License-Identifier: Apache-2.0
//
// The PURE notification planner (src/notify/service.ts). These pin the four
// structural guarantees the seam exists for — a regression here is a customer
// seeing a red toast for a validation warning, a toast with nothing to click,
// an errno in the notification text, or an issue list truncated to its first
// entry.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  planCliOutcome,
  planConfirm,
  planFailure,
  planPrecondition,
  planSuccess,
} = require("../out/notify/service.js");
const {
  classifyOutcome,
  classifyUnavailable,
  noPrebuiltMessage,
  SUPPORTED_CLI_VERSION,
} = require("../out/alpCli/service.js");

/** An envelope with `issues`, shaped like the real CLI contract. */
function envelope(exitCode, ok, issues) {
  return {
    command: "validate",
    ok,
    exitCode,
    project: { root: "/w", boardYaml: "/w/board.yaml" },
    data: {},
    issues,
  };
}

function issue(message, severity = "error", code = "board.invalid") {
  return { code, severity, message };
}

/** Everything a customer-facing sentence must never carry. */
const FORBIDDEN = [
  /\bENOENT\b/,
  /\bEACCES\b/,
  /\bEPERM\b/,
  /\bexit\s+-?\d+/i,
  /\n\s*at\s/,
];

function assertClean(message, label) {
  for (const pattern of FORBIDDEN) {
    assert.doesNotMatch(
      message,
      pattern,
      `${label}: raw diagnostics leaked into the toast text — ${message}`,
    );
  }
}

// ── 1. severity comes from the outcome, and cannot be overridden ────────────

test("planCliOutcome takes severity from the outcome, never the call site", () => {
  // exit 2 (validation) and exit 4 (doctor) are WARNINGS per classifyOutcome —
  // the single most common wrong-severity bug was a call site hardcoding
  // showErrorMessage while holding exactly this outcome.
  const validation = classifyOutcome(2, envelope(2, false, [issue("bad som")]));
  assert.equal(validation.severity, "warning");
  assert.equal(
    planCliOutcome(validation, { operation: "Validating board.yaml" }).severity,
    "warning",
  );

  const doctor = classifyOutcome(4, envelope(4, false, [issue("no ninja")]));
  assert.equal(
    planCliOutcome(doctor, { operation: "Doctor" }).severity,
    "warning",
  );

  const write = classifyOutcome(3, envelope(3, false, [issue("read-only")]));
  assert.equal(
    planCliOutcome(write, { operation: "Generating" }).severity,
    "error",
  );

  const ok = classifyOutcome(0, envelope(0, true, []));
  assert.equal(
    planCliOutcome(ok, { operation: "Generating" }).severity,
    "info",
  );
});

test("planCliOutcome exposes no severity parameter to override", () => {
  const outcome = classifyOutcome(2, envelope(2, false, [issue("bad som")]));
  // The context object is the only input a call site controls, and passing a
  // severity through it changes nothing — the plan still reads the outcome.
  const plan = planCliOutcome(outcome, {
    operation: "Validating board.yaml",
    severity: "error",
  });
  assert.equal(plan.severity, "warning");
});

test("planPrecondition is always a warning, never an error", () => {
  for (const kind of [
    "noWorkspace",
    "noBoardYaml",
    "noSdk",
    "noZephyrWorkspace",
  ]) {
    const plan = planPrecondition(kind, { operation: "write launch.json" });
    assert.equal(plan.severity, "warning", `${kind} must be a warning`);
    assert.ok(plan.actions.length > 0, `${kind} must carry an action`);
  }
});

// ── 2. no dead ends ────────────────────────────────────────────────────────

test("every non-statusBar plan carries at least one action", () => {
  const plans = [
    planCliOutcome(classifyOutcome(1, null), { operation: "Building" }),
    planCliOutcome(classifyOutcome(2, envelope(2, false, [issue("bad")])), {
      operation: "Validating board.yaml",
    }),
    planFailure({
      operation: "Removing the SDK",
      cause: "The SDK folder is in use.",
    }),
    planPrecondition("noWorkspace"),
    planConfirm({
      message: "Remove SDK 0.6.0?",
      modalDetail: "This permanently deletes it.",
      confirm: { id: "deleteFromDisk" },
    }),
  ];
  for (const plan of plans) {
    if (plan.channel === "statusBar") continue;
    assert.ok(
      plan.actions.length > 0,
      `a ${plan.channel} plan with no action is a dead end: ${plan.message}`,
    );
  }
});

test("planSuccess is always the status bar, and may be action-free", () => {
  const plan = planSuccess("Alp: wrote the Zephyr .conf");
  assert.equal(plan.channel, "statusBar");
  assert.equal(plan.severity, "info");
  assert.deepEqual(plan.actions, []);
});

// ── 3. raw diagnostics never reach the message ─────────────────────────────

test("planFailure demotes a raw cause into detail", () => {
  const raw = "EACCES: permission denied, mkdir '/home/me/proj/.vscode'";
  const plan = planFailure({ operation: "Writing launch.json", cause: raw });
  assertClean(plan.message, "planFailure(errno)");
  assert.equal(plan.message, "Writing launch.json failed.");
  assert.match(plan.detail, /EACCES/);

  const exit = planFailure({
    operation: "west flash",
    cause: "west flash failed (exit 1)",
  });
  assertClean(exit.message, "planFailure(exit code)");
  assert.match(exit.detail, /exit 1/);

  const win = planFailure({
    operation: "Removing the west workspace",
    cause: "failed to remove C:\\Users\\me\\proj\\.west: EBUSY",
  });
  assertClean(win.message, "planFailure(windows path)");
  assert.match(win.detail, /EBUSY/);
});

test("planFailure keeps a clean customer sentence verbatim", () => {
  const plan = planFailure({
    operation: "Removing the SDK",
    cause: "A build is still using this SDK folder.",
    detail: "EBUSY: resource busy or locked",
  });
  assert.equal(plan.message, "A build is still using this SDK folder.");
  assertClean(plan.message, "planFailure(clean)");
  assert.match(plan.detail, /EBUSY/);
});

test("an unavailable CLI keeps its errno out of the message", () => {
  const outcome = classifyOutcome(-1, null);
  outcome.unavailable = {
    reason: classifyUnavailable("spawn tan ENOENT"),
    detail: "spawn tan ENOENT",
  };
  const plan = planCliOutcome(outcome, { operation: "Validating board.yaml" });
  assertClean(plan.message, "planCliOutcome(unavailable)");
  assert.equal(plan.detail, "spawn tan ENOENT");
});

test("the exit code of a failed envelope is detail, never the message", () => {
  const outcome = classifyOutcome(3, envelope(3, false, [issue("read-only")]));
  const plan = planCliOutcome(outcome, {
    operation: "Generating the DTS overlay",
  });
  assertClean(plan.message, "planCliOutcome(envelope)");
  assert.match(plan.detail, /exit 3 \(write\)/);
});

// ── 4. every issue stays reachable ─────────────────────────────────────────

test("a multi-issue outcome names the first, counts the rest, and carries them all", () => {
  const issues = [
    issue("som.sku is not a known module"),
    issue("peripherals[2].pin conflicts with peripherals[0].pin"),
    issue("libraries.foo is unknown", "warning"),
  ];
  const outcome = classifyOutcome(2, envelope(2, false, issues));
  const plan = planCliOutcome(outcome, { operation: "Validating board.yaml" });

  assert.match(plan.message, /som\.sku is not a known module/);
  assert.match(plan.message, /\(\+2 more\)/);
  assert.deepEqual(
    plan.issues,
    issues,
    "the WHOLE array must travel on the plan",
  );
  assert.ok(
    plan.actions.some((a) => a.id === "showIssues"),
    "a plan with issues must offer a way to see all of them",
  );
});

test("a single-issue outcome names it with no count", () => {
  const outcome = classifyOutcome(2, envelope(2, false, [issue("bad som")]));
  const plan = planCliOutcome(outcome, { operation: "Validating board.yaml" });
  assert.match(plan.message, /bad som/);
  assert.doesNotMatch(plan.message, /more\)/);
});

test("summarize() itself reports the extra issues instead of dropping them", () => {
  // The old summarize() returned issues[0].message alone, so every surface
  // reading outcome.message showed one of N problems with no hint of the rest.
  const outcome = classifyOutcome(
    2,
    envelope(2, false, [issue("first"), issue("second"), issue("third")]),
  );
  assert.equal(outcome.message, "first (+2 more)");
});

test("an issue-free failure still gets an actionable, composed message", () => {
  // The six generic summarize() fallbacks ("The command failed.") must never
  // be the last word: the planner composes from the operation and attaches a
  // remedy, so a generic string can only ever be supporting text in the log.
  const outcome = classifyOutcome(1, envelope(1, false, []));
  const plan = planCliOutcome(outcome, { operation: "Building the project" });
  assert.equal(plan.message, "Building the project failed.");
  assert.ok(plan.actions.length > 0);
});

// ── 5. "not installed yet" and "broken" are different notifications ─────────

test("notInstalled and a broken install differ in both text and remedy", () => {
  const missing = classifyOutcome(-1, null);
  missing.unavailable = { reason: "notInstalled", detail: "spawn tan ENOENT" };
  const broken = classifyOutcome(-1, null);
  broken.unavailable = {
    reason: "notNative",
    detail: 'tan --version printed "hello"',
  };

  const a = planCliOutcome(missing, { operation: "Validating board.yaml" });
  const b = planCliOutcome(broken, { operation: "Validating board.yaml" });

  assert.notEqual(a.message, b.message);
  assert.match(a.message, /isn't installed yet/);
  assert.ok(
    a.actions.some((x) => x.id === "installTanCli"),
    "the never-installed case must offer Install",
  );
  assert.ok(
    b.actions.some(
      (x) => x.id === "openSettings" && x.arg === "alpSdk.cliPath",
    ),
    "the wrong-binary case must offer the setting that repoints it",
  );

  const noPrebuilt = classifyOutcome(-1, null);
  noPrebuilt.message = noPrebuiltMessage("win32", "arm64");
  noPrebuilt.unavailable = {
    reason: "noPrebuilt",
    detail: "No prebuilt tan CLI for win32/arm64.",
  };
  assert.notEqual(
    planCliOutcome(noPrebuilt, { operation: "Validating board.yaml" }).message,
    a.message,
  );
});

// ── alp-sdk-vscode#445 ─────────────────────────────────────────────────────
//
// A tan release that publishes no asset for the customer's platform used to
// reach them as a download failure from a URL this extension constructed
// itself. The remedy button was right; the sentence named neither the machine
// nor the release, so it read as "this vendor's release is broken".
test("a host the pinned release publishes nothing for is EXPLAINED, not reported as a failed download", () => {
  const outcome = classifyOutcome(-1, null);
  // Exactly what `unavailableOutcome` (src/alpCli/vscodeAdapter.ts) puts here:
  // the resolver's own authored sentence, which is the only place the host and
  // the release are named.
  outcome.message = noPrebuiltMessage("win32", "arm64");
  outcome.unavailable = {
    reason: "noPrebuilt",
    detail: "no prebuilt tan CLI for win32/arm64",
  };

  const plan = planCliOutcome(outcome, { operation: "Validating board.yaml" });

  // The sentence survives to the toast verbatim — composing over it is what
  // dropped both facts.
  assert.equal(plan.message, outcome.message);
  assert.match(plan.message, /win32\/arm64/);
  assert.match(plan.message, new RegExp(`tan v${SUPPORTED_CLI_VERSION}`));
  assert.match(plan.message, /rather than a broken install/);

  // The remedy is the one route that works on this host…
  assert.ok(
    plan.actions.some(
      (x) => x.id === "openSettings" && x.arg === "alpSdk.cliPath",
    ),
  );
  // …and NOT a retry or an install: both re-enter a download this release can
  // never satisfy, so either button is dead by construction here.
  assert.ok(
    !plan.actions.some((x) => x.id === "retry" || x.id === "installTanCli"),
    "a host with no asset must not be offered a download that cannot exist",
  );

  // Distinct from the genuine transport failure it used to be flattened into.
  const failed = classifyOutcome(-1, null);
  failed.unavailable = { reason: "downloadFailed", detail: "HTTP 404" };
  assert.notEqual(
    plan.message,
    planCliOutcome(failed, { operation: "Validating board.yaml" }).message,
  );
});

test("classifyUnavailable splits the resolver's failures by remedy", () => {
  assert.equal(
    classifyUnavailable(
      "No prebuilt tan CLI for win32/arm64. Set alpSdk.cliPath…",
    ),
    "noPrebuilt",
  );
  assert.equal(
    classifyUnavailable("The tan CLI download did not produce a binary."),
    "corrupt",
  );
  assert.equal(
    classifyUnavailable("Download failed (HTTP 404) for https://example/tan"),
    "downloadFailed",
  );
  assert.equal(classifyUnavailable("tan CLI timed out after 60s"), "timeout");
  assert.equal(classifyUnavailable("spawn tan ENOENT"), "notInstalled");
  assert.equal(
    classifyUnavailable("EACCES: permission denied, open '/home/me/.alp/tan'"),
    "corrupt",
  );
  assert.equal(
    classifyUnavailable("tan CLI output exceeded 16 MB"),
    "spawnFailed",
  );
  // #414: the lazy per-command consent gate's refusal (resolveAlpBinary's
  // `download` arm — see TAN_CLI_DOWNLOAD_CONSENT_NEEDED, src/alpCli/service.ts)
  // must classify to its OWN reason, not fall into `corrupt`/`spawnFailed` and
  // offer a "Run Doctor" button for a binary that was never even fetched.
  assert.equal(
    classifyUnavailable(
      "The tan CLI download needs consent before it can run.",
    ),
    "consentDeclined",
  );
});

// ── #414: the lazy-download consent refusal names the fix, not the binary ──

test("consentDeclined names the setting, alpSdk.cliPath, and both explicit commands — never Run Doctor", () => {
  const outcome = classifyOutcome(-1, null);
  outcome.unavailable = {
    reason: "consentDeclined",
    detail: "The tan CLI download needs consent before it can run.",
  };
  const plan = planCliOutcome(outcome, { operation: "Building the project" });

  assert.match(plan.message, /tanCliDownloadConsent/);
  assert.match(plan.message, /alpSdk\.cliPath/);
  assert.ok(plan.actions.some((a) => a.id === "installTanCli"));
  assert.ok(plan.actions.some((a) => a.id === "updateCli"));
  assert.ok(
    plan.actions.some(
      (a) =>
        a.id === "openSettings" && a.arg === "alpSdk.tanCliDownloadConsent",
    ),
  );
  // Nothing about the BINARY is broken here — it was never fetched — so
  // Doctor (which diagnoses an installed-but-failing tan) is the wrong tool.
  assert.deepEqual(
    plan.actions.filter((a) => a.id === "runDoctor"),
    [],
  );
  // The raw refusal text stays channel-only, never rendered.
  assert.doesNotMatch(plan.message, /needs consent before it can run/);
});

// ── channel routing ────────────────────────────────────────────────────────

test("a clean CLI success goes to the status bar, an inline surface stays silent", () => {
  const ok = classifyOutcome(0, envelope(0, true, []));
  assert.equal(
    planCliOutcome(ok, { operation: "Validating board.yaml" }).channel,
    "statusBar",
  );
  assert.equal(
    planCliOutcome(ok, { operation: "Validating board.yaml", inline: true })
      .channel,
    "silent",
  );
  const failed = classifyOutcome(2, envelope(2, false, [issue("bad")]));
  assert.equal(
    planCliOutcome(failed, { operation: "Validating", inline: true }).channel,
    "silent",
  );
});

test("planConfirm keeps its consequence text ON the dialog", () => {
  const plan = planConfirm({
    message: "Remove SDK 0.6.0?",
    modalDetail: "This permanently deletes /home/me/.alp/sdk/0.6.0.",
    confirm: { id: "deleteFromDisk" },
  });
  assert.equal(plan.channel, "modal");
  // modalDetail is rendered by VS Code; `detail` is channel-only and would
  // hide the path a destructive confirm has to show.
  assert.match(plan.modalDetail, /permanently deletes/);
  assert.equal(plan.detail, undefined);
  assert.deepEqual(plan.actions, [{ id: "deleteFromDisk" }]);
});
