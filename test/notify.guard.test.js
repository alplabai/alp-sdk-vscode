// SPDX-License-Identifier: Apache-2.0
//
// Structural guard on the notification surface.
//
// Every customer-facing notification routes through the seam in
// `src/notify/` — a pure planner (`service.ts`) that derives severity from the
// CLI outcome and guarantees an action, plus a single presenter
// (`vscodeAdapter.ts`) that is the only file allowed to call
// `vscode.window.show*Message`.
//
// The anti-pattern this file exists to keep dead:
//
//     void vscode.window.showErrorMessage(`Alp: ${outcome.message}`);
//
// — a raw toast whose text is an interpolated internal string (so raw stderr,
// an errno, an exit code or an absolute path leaks into the notification) and
// which carries no action button, leaving the customer with nothing to click.
// It occupied src/loader.ts:110/:149/:192 among others before the seam landed.
//
// These tests read SOURCE, not compiled output: the point is to fail review
// when the pattern is re-typed, which a behavioural test cannot see.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.join(__dirname, "..", "src");

/** The sole file permitted to call `vscode.window.show*Message` directly. */
const PRESENTER = path.join("notify", "vscodeAdapter.ts");

/**
 * Files still allowed a raw `vscode.window.show*Message` call, each with the
 * reason. Keep this EMPTY unless a site genuinely cannot route through the
 * presenter — an entry here is a hole in the guard, not a formality.
 */
const ALLOWLIST = new Map([
  [
    path.join("util.ts"),
    "runInTerminal's busy-guard is synchronous and util.ts must not import " +
      "src/notify/vscodeAdapter.ts (the presenter imports log/showOutput/" +
      "revealRunInTerminal from util.ts — importing back would be a cycle).",
  ],
]);

function tsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(full));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * Blank out comments so prose that merely NAMES the anti-pattern (this repo
 * documents it in several doc comments) is not mistaken for a call. Replaces
 * comment bodies with spaces so byte offsets — and therefore line numbers —
 * are preserved.
 */
function stripComments(source) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i++;
      }
    } else if (two === "/*") {
      while (i < source.length && source.slice(i, i + 2) !== "*/") {
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      out += "  ";
      i += 2;
    } else {
      out += source[i];
      i++;
    }
  }
  return out;
}

const CALL = /\.show(?:Error|Warning|Information)Message\s*\(/g;

/** Read the first argument of a call whose `(` sits at `open`. */
function firstArgument(source, open) {
  let i = open + 1;
  while (i < source.length && /\s/.test(source[i])) i++;
  if (source[i] !== "`") return { isTemplate: false, text: "" };
  let j = i + 1;
  let text = "";
  while (j < source.length) {
    if (source[j] === "\\") {
      text += source.slice(j, j + 2);
      j += 2;
      continue;
    }
    if (source[j] === "`") break;
    text += source[j];
    j++;
  }
  return { isTemplate: true, text };
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function callSites() {
  const sites = [];
  for (const file of tsFiles(SRC)) {
    const rel = path.relative(SRC, file);
    const source = stripComments(fs.readFileSync(file, "utf8"));
    for (const match of source.matchAll(CALL)) {
      const open = match.index + match[0].length - 1;
      sites.push({
        rel,
        line: lineOf(source, match.index),
        ...firstArgument(source, open),
      });
    }
  }
  return sites;
}

test("no raw show*Message toast is built from an interpolated string", () => {
  const offenders = callSites()
    .filter((s) => s.rel !== PRESENTER && !ALLOWLIST.has(s.rel))
    .filter((s) => s.isTemplate && s.text.includes("${"))
    .map((s) => `src/${s.rel.replace(/\\/g, "/")}:${s.line}  \`${s.text}\``);

  assert.deepEqual(
    offenders,
    [],
    "A notification is being built by interpolating a value straight into the " +
      "toast text. That leaks raw stderr / errno / exit codes / absolute paths " +
      "to the customer and skips the seam that guarantees an action button.\n" +
      "Build a plan instead — planCliOutcome / planFailure / planPrecondition " +
      "(src/notify/service.ts) — putting the customer-facing sentence in " +
      "`message` and the interpolated detail in `detail`, which is logged to " +
      "the Alp SDK output channel and never rendered in the toast.\n" +
      "Offenders:\n  " +
      offenders.join("\n  "),
  );
});

test("the notify presenter is the only caller of vscode.window.show*Message", () => {
  const offenders = callSites()
    .filter((s) => s.rel !== PRESENTER && !ALLOWLIST.has(s.rel))
    .map((s) => `src/${s.rel.replace(/\\/g, "/")}:${s.line}`);

  assert.deepEqual(
    offenders,
    [],
    "A notification bypasses the seam. Severity must come from the envelope " +
      "(CliOutcome.severity via classifyOutcome), not the call site, and every " +
      "toast must carry an action — both of which only the planner in " +
      "src/notify/service.ts guarantees. Route through notify()/notifyAsync() " +
      "from src/notify/vscodeAdapter.ts.\nOffenders:\n  " +
      offenders.join("\n  "),
  );
});

test("the guard can actually see an offending call", () => {
  // Proves the scanner is not vacuously green: a real regression is detected,
  // and a doc comment merely naming the pattern is not.
  const fixture = stripComments(
    [
      "// void vscode.window.showErrorMessage(`Alp: ${outcome.message}`);",
      "/* also prose: showErrorMessage(`${x}`) */",
      "void vscode.window.showErrorMessage(`Alp: ${outcome.message}`);",
      'void vscode.window.showInformationMessage("a literal is fine");',
    ].join("\n"),
  );

  const found = [...fixture.matchAll(CALL)].map((m) => {
    const open = m.index + m[0].length - 1;
    return { line: lineOf(fixture, m.index), ...firstArgument(fixture, open) };
  });

  assert.equal(found.length, 2, "comments must not register as call sites");
  assert.deepEqual(
    found
      .filter((f) => f.isTemplate && f.text.includes("${"))
      .map((f) => f.line),
    [3],
    "the interpolated call on line 3 must be the only offender detected",
  );
});

// ── Button label vs command-palette title ───────────────────────────────────
//
// These two are different strings for the same action and prose keeps quoting
// the wrong one. A toast button reading "Install tan CLI" was described in four
// places — a doc comment, the CHANGELOG and two test comments — as
// "Install tan CLI (global)", which is the COMMAND PALETTE entry. Nothing
// caught it: the label is real, just not the one the customer sees on that
// toast, so every gate stayed green and it took a review round.
//
// Pinning both, together, puts the distinction somewhere executable. A rename
// of either reds this test and the message says which surface it belongs to,
// so the renamer sweeps the prose instead of leaving it to a reviewer.
test("the notification button and the palette title stay distinct, and prose quotes the right one", () => {
  const presenter = fs.readFileSync(path.join(SRC, PRESENTER), "utf8");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
  );

  const buttonTitle = /installTanCli:\s*\{\s*title:\s*"([^"]+)"/.exec(
    presenter,
  )?.[1];
  const paletteTitle = manifest.contributes.commands.find(
    (command) => command.command === "alp.installTanCli",
  )?.title;

  assert.equal(
    buttonTitle,
    "Install tan CLI",
    "the ACTIONS title is what a notification button renders; prose across " +
      "src/ and CHANGELOG.md quotes this string, so a rename has to sweep them",
  );
  assert.equal(
    paletteTitle,
    "Alp: Install tan CLI (global)",
    "the package.json command title is what the palette renders — never what " +
      "a toast button says",
  );
  assert.notEqual(
    buttonTitle,
    paletteTitle,
    "if these ever converge, delete this test rather than weakening it",
  );
});
