// SPDX-License-Identifier: Apache-2.0
//
// `scripts/resolve-vsix-channel.mjs` is the single source for the VS Code
// Marketplace publish-channel parity rule (an ODD minor version publishes
// `--pre-release`, an EVEN minor publishes stable) that BOTH
// `release-vsix.yml` packaging jobs (`package_and_publish`, the universal
// VSIX, and `package_darwin_arm64`, the bundled-CLI VSIX) must follow
// identically. Nothing previously asserted any of:
//
//   1. the mapping itself, including its failure path on a malformed
//      package.json version;
//   2. that both jobs actually CALL the script, rather than re-deriving the
//      rule inline (a second, independently-driftable copy);
//   3. that neither job's `vsce package`/`vsce publish` line hardcodes a bare
//      `--pre-release` literal instead of `$PRERELEASE_FLAG`.
//
// (3) is not a hypothetical: this file's own header comment records that
// `package_darwin_arm64` used to hardcode "always --pre-release" before it
// was switched to call the shared script. If that regresses — the flag
// literal reappearing in that job's `vsce package` line — an EVEN-minor
// STABLE cut would silently publish the darwin/arm64 VSIX to the PRE-RELEASE
// Marketplace channel. That is quiet, not loud: VS Code prefers a
// platform-specific VSIX over the universal one, so affected users just stop
// receiving stable updates, behind a fully green release run (`release_gate`
// in that workflow compares publish OUTCOMES only — it has no idea which
// channel a publish landed in).
//
// The mapping test (1) runs the REAL script file, copied byte-for-byte into a
// scratch dir alongside a synthetic package.json — the script resolves
// `../package.json` relative to its OWN file location via `import.meta.url`,
// not `cwd`, so that layout has to be preserved for the copy to read the
// fixture version rather than this repo's real one. This exercises actual
// behaviour, never a reimplementation that could drift from it.
//
// Four more gaps found by review, all fixed here:
//
// 4. The old "invokes the resolver" check only looked for the substring
//    `$(node scripts/resolve-vsix-channel.mjs)` ANYWHERE in a job body — it
//    passed identically whether that substitution was captured by a plain
//    assignment (correct) or piped straight into `read -r ... <<< "$(...)"`
//    (the exact swallowing bug this workflow was fixed to avoid: `read`
//    returns 0 even when the substitution failed, so a broken resolver
//    leaves CHANNEL empty and the `else` arm ships whatever channel that
//    arm defaults to). It also never checked that an unrecognised channel
//    fails the step. Now asserted: the resolver's output is captured by a
//    bare `VAR="$(...)"` assignment (no `export`/`local`/`declare` — all
//    three report their OWN exit status, not the substitution's, so they
//    swallow a failure identically to the old `read <<< "$(...)"` form),
//    `read` consumes THAT variable, and the `else` arm of the
//    pre-release/stable check exits non-zero.
//
// 5. The hardcoded-`--pre-release` check only looked at whichever single
//    physical line matched `vsce (package|publish)` — a `\`-continued
//    `vsce package` line with the literal on the CONTINUATION line evaded
//    it, and the >=3 floor counted prose mentions of "vsce package"/"vsce
//    publish" in this file's own narrative comments, so deleting every real
//    packaging step could still satisfy it. Both are now scanned over
//    logical, `run:`-body-only lines: shell `\`-continuations are folded
//    into their parent line first, and only text that is actually inside a
//    `run:` step's command (inline or block-scalar) is considered — a
//    comment mentioning "vsce package" can no longer inflate the floor or
//    hide a literal on a continuation line.
//
// 6. Nothing asserted WHERE `PRERELEASE_FLAG=--pre-release` gets assigned —
//    only that a `vsce` line doesn't hardcode the literal. Moving that
//    assignment into the `stable` `elif` arm (or dropping it outside the
//    `if`/`fi` entirely) would ship pre-release builds on a stable cut
//    without ever tripping check 5, since no `vsce` line would name the
//    literal. Now asserted per job: that assignment appears in the
//    pre-release branch, and nowhere else in the job.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf-8");
const REAL_SCRIPT = path.join(root, "scripts", "resolve-vsix-channel.mjs");
const RELEASE_WORKFLOW = ".github/workflows/release-vsix.yml";

/**
 * Copies the real resolver script into a fresh scratch dir next to a
 * synthetic package.json (same relative layout: `scripts/resolve-vsix-
 * channel.mjs` + `../package.json`), runs it there, and returns its outcome.
 * Never touches this repo's own package.json.
 */
function runResolver(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "resolve-vsix-channel-"));
  try {
    const scriptsDir = path.join(dir, "scripts");
    fs.mkdirSync(scriptsDir);
    const scratchScript = path.join(scriptsDir, "resolve-vsix-channel.mjs");
    fs.copyFileSync(REAL_SCRIPT, scratchScript);
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ version }),
    );
    try {
      const stdout = execFileSync("node", [scratchScript], {
        encoding: "utf-8",
      });
      return { status: 0, stdout, stderr: "" };
    } catch (error) {
      return {
        status: error.status,
        stdout: error.stdout ?? "",
        stderr: error.stderr ?? "",
      };
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("resolve-vsix-channel.mjs maps package.json version to '<channel> <major> <minor>' by odd/even minor", () => {
  // Only the MINOR's parity decides the channel — the patch digit is along
  // for the ride, which is why 0.5.0 and 0.5.1 both land on pre-release.
  const cases = [
    ["0.4.0", "stable", "0", "4"],
    ["0.4.1", "stable", "0", "4"],
    ["0.5.0", "pre-release", "0", "5"],
    ["0.5.1", "pre-release", "0", "5"],
    ["1.0.0", "stable", "1", "0"],
    ["1.1.0", "pre-release", "1", "1"],
    ["2.3.7", "pre-release", "2", "3"],
  ];
  for (const [version, channel, major, minor] of cases) {
    const { status, stdout } = runResolver(version);
    assert.equal(
      status,
      0,
      `version "${version}" should resolve successfully, got exit ${status}`,
    );
    const fields = stdout.trim().split(/\s+/);
    assert.equal(
      fields.length,
      3,
      `resolve-vsix-channel.mjs must print exactly 3 fields ("<pre-release|stable> <major> <minor>"), ` +
        `got: ${JSON.stringify(stdout)}`,
    );
    assert.deepEqual(
      fields,
      [channel, major, minor],
      `version "${version}" should resolve to "${channel} ${major} ${minor}", got "${stdout.trim()}"`,
    );
  }
});

test("resolve-vsix-channel.mjs exits non-zero with the documented ::error:: on a malformed version, printing nothing to stdout", () => {
  const { status, stdout, stderr } = runResolver("0-5-2");
  assert.notEqual(status, 0, "a malformed version must not exit 0");
  // The caller-contract comment in the script is explicit about why this
  // matters: `read -r ... <<< "$(cmd)"` returns 0 even when cmd exits
  // non-zero (the here-string is merely empty), so a non-empty stdout on
  // failure is how that trap would resurface — CHANNEL would read as
  // whatever garbage was printed instead of failing loudly upstream.
  assert.equal(
    stdout,
    "",
    `must print nothing to stdout on failure, got: ${JSON.stringify(stdout)}`,
  );
  assert.match(
    stderr,
    /::error::Could not resolve a major\.minor version from package\.json version "0-5-2"/,
  );
});

/**
 * Slices a YAML file's top-level `jobs:` block into per-job line arrays, keyed
 * by job id, from a 2-space-indented `<job-id>:` line up to the next
 * 2-space-indented key (another job) or EOF. release-vsix.yml's job bodies are
 * indented 4+ spaces, so this only matches job boundaries, never a nested key.
 */
function sliceJobs(contents, jobIds) {
  const lines = contents.split(/\r?\n/);
  const bodies = {};
  let current = null;
  for (const line of lines) {
    const jobStart = /^ {2}([A-Za-z0-9_]+):\s*$/.exec(line);
    if (jobStart && jobIds.includes(jobStart[1])) {
      current = jobStart[1];
      bodies[current] = [];
      continue;
    }
    if (jobStart && current) {
      current = null; // hit the next top-level job; left the one we were capturing
    }
    if (current) bodies[current].push(line);
  }
  return bodies;
}

/**
 * Finds the line that captures resolve-vsix-channel.mjs's command
 * substitution into a BARE shell variable — `VAR="$(node scripts/resolve-
 * vsix-channel.mjs)"` — with nothing between line-start and the variable
 * name. That excludes `export VAR=...`/`local VAR=...`/`declare VAR=...`:
 * all three report their OWN exit status rather than the substitution's, so
 * they swallow a failing resolver exactly like the `read -r ... <<< "$(...)"`
 * form this replaced (`read` returns 0 even when the here-string's command
 * failed). Returns the RegExp match (with the captured variable name) or
 * null.
 */
function findPlainResolverAssignment(body) {
  const PLAIN_ASSIGN =
    /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)="\$\(\s*node scripts\/resolve-vsix-channel\.mjs\s*\)"[ \t]*$/m;
  return PLAIN_ASSIGN.exec(body);
}

/**
 * Pulls every `run:` step's shell command text out of a workflow file —
 * inline (`run: <cmd>`), block-scalar (`run: |`/`run: >`, all subsequent
 * more-indented lines), and a plain inline value ending in a literal `\`
 * continued onto the next more-indented line — as `{ text, lineNo }` entries.
 * Everything else (job/step keys, `if:`, `name:`, and step-level `#`
 * comments that sit BEFORE a `run:` key) is excluded, which is the point:
 * this file's own narrative prose repeatedly says "vsce package"/"vsce
 * publish" and must never be mistaken for a real packaging step.
 */
function extractRunBodyLines(contents) {
  const rawLines = contents.split(/\r?\n/);
  const result = [];
  let mode = null; // "block" | "continuation" | null
  let keyIndent = null;
  let continuePending = false;

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const raw = rawLines[i];

    if (mode === "block") {
      if (raw.trim() === "") {
        result.push({ text: raw, lineNo });
        continue;
      }
      const indent = raw.match(/^[ \t]*/)[0].length;
      if (indent > keyIndent) {
        result.push({ text: raw, lineNo });
        continue;
      }
      mode = null;
      keyIndent = null;
      // fall through: re-check this line as a fresh key
    } else if (mode === "continuation") {
      const indent = raw.match(/^[ \t]*/)[0].length;
      if (continuePending && indent > keyIndent) {
        result.push({ text: raw, lineNo });
        continuePending = /\\[ \t]*$/.test(raw);
        if (!continuePending) {
          mode = null;
          keyIndent = null;
        }
        continue;
      }
      mode = null;
      keyIndent = null;
      // fall through: re-check this line as a fresh key
    }

    const keyMatch = /^([ \t]*)run:[ \t]*(.*)$/.exec(raw);
    if (!keyMatch) continue;
    const [, indentStr, rest] = keyMatch;
    if (rest === "" || /^[|>][-+]?$/.test(rest.trim())) {
      mode = "block";
      keyIndent = indentStr.length;
      continue;
    }
    result.push({ text: rest, lineNo });
    if (/\\[ \t]*$/.test(rest)) {
      mode = "continuation";
      keyIndent = indentStr.length;
      continuePending = true;
    }
  }
  return result;
}

/**
 * Folds shell `\`-continued run-body lines (from extractRunBodyLines) into
 * single logical lines, keyed by the FIRST physical line's number, so a
 * split like `vsce package ... \` / `  --pre-release ...` is scanned as one
 * line instead of two half-matches.
 */
function foldContinuations(entries) {
  const logical = [];
  let buffer = "";
  let startLineNo = null;
  for (const { text, lineNo } of entries) {
    if (startLineNo === null) startLineNo = lineNo;
    if (/\\[ \t]*$/.test(text)) {
      buffer += text.replace(/\\[ \t]*$/, " ");
    } else {
      buffer += text;
      logical.push({ line: buffer, lineNo: startLineNo });
      buffer = "";
      startLineNo = null;
    }
  }
  if (buffer) logical.push({ line: buffer, lineNo: startLineNo });
  return logical;
}

test("both release-vsix.yml packaging jobs invoke resolve-vsix-channel.mjs for the publish channel", () => {
  const contents = read(RELEASE_WORKFLOW);
  const jobs = sliceJobs(contents, [
    "package_and_publish",
    "package_darwin_arm64",
  ]);

  // The real invocation is a command substitution assigned to a variable:
  // `RESOLVED="$(node scripts/resolve-vsix-channel.mjs)"`. Anchored to the
  // `$( ... )` form so a comment merely NAMING the script — this file's own
  // header prose does it, repeatedly, and so does release-vsix.yml's — cannot
  // satisfy this; only a real command substitution can.
  const INVOKES_RESOLVER =
    /\$\(\s*node scripts\/resolve-vsix-channel\.mjs\s*\)/;

  for (const jobId of ["package_and_publish", "package_darwin_arm64"]) {
    assert.ok(
      jobs[jobId],
      `${RELEASE_WORKFLOW} no longer has a "${jobId}" job — if it was renamed or removed, ` +
        `update this test alongside it.`,
    );
    assert.match(
      jobs[jobId].join("\n"),
      INVOKES_RESOLVER,
      `${RELEASE_WORKFLOW}'s "${jobId}" job does not call scripts/resolve-vsix-channel.mjs to ` +
        `resolve its publish channel — any copy of the odd/even rule outside that one script is a ` +
        `second, independently-driftable implementation of it.`,
    );
  }
});

test("both release-vsix.yml packaging jobs capture the resolver's output in a plain variable, then read FROM that variable", () => {
  const contents = read(RELEASE_WORKFLOW);
  const jobs = sliceJobs(contents, [
    "package_and_publish",
    "package_darwin_arm64",
  ]);

  for (const jobId of ["package_and_publish", "package_darwin_arm64"]) {
    const body = jobs[jobId].join("\n");
    const assignMatch = findPlainResolverAssignment(body);
    assert.ok(
      assignMatch,
      `${RELEASE_WORKFLOW}'s "${jobId}" job does not assign resolve-vsix-channel.mjs's command ` +
        `substitution to a bare shell variable (no export/local/declare) before reading it. That ` +
        `plain assignment is what carries the substitution's exit status forward under \`set -e\`; ` +
        `piping it straight into \`read -r ... <<< "$(...)"\` — or hiding the assignment behind ` +
        `export/local/declare, which report their OWN exit status instead — resurrects the ` +
        `swallowed-failure bug: a failing resolver leaves CHANNEL empty and the workflow publishes ` +
        `on whatever the else-branch does, to an unrecoverable spent tag.`,
    );
    const varName = assignMatch[1];
    const READ_FROM_VAR = new RegExp(
      `read\\s+-r\\s+[A-Za-z_]\\w*(?:\\s+[A-Za-z_]\\w*)*\\s*<<<\\s*"\\$${varName}"`,
    );
    assert.match(
      body,
      READ_FROM_VAR,
      `${RELEASE_WORKFLOW}'s "${jobId}" job assigns the resolver's output to $${varName} but its ` +
        `\`read\` does not consume that same variable — it must read FROM the already-captured ` +
        `variable, never re-run a fresh "$(node scripts/resolve-vsix-channel.mjs)" inline inside ` +
        `<<<, which is the exact form whose exit status \`read\` discards.`,
    );
  }
});

test("both release-vsix.yml packaging jobs fail closed (non-zero exit) when the resolved channel is neither pre-release nor stable", () => {
  const contents = read(RELEASE_WORKFLOW);
  const jobs = sliceJobs(contents, [
    "package_and_publish",
    "package_darwin_arm64",
  ]);

  for (const jobId of ["package_and_publish", "package_darwin_arm64"]) {
    const body = jobs[jobId].join("\n");
    const ifBlockMatch =
      /if\s*\[\s*"\$CHANNEL"\s*=\s*"pre-release"\s*\]\s*;\s*then[\s\S]*?\n[ \t]*fi\b/.exec(
        body,
      );
    assert.ok(
      ifBlockMatch,
      `${RELEASE_WORKFLOW}'s "${jobId}" job has no 'if [ "$CHANNEL" = "pre-release" ]; then ... fi' ` +
        `block — cannot verify it fails closed on an unrecognised channel.`,
    );
    const block = ifBlockMatch[0];
    assert.match(
      block,
      /elif\s*\[\s*"\$CHANNEL"\s*=\s*"stable"\s*\]\s*;\s*then/,
      `${RELEASE_WORKFLOW}'s "${jobId}" job's channel check has no explicit ` +
        `'elif [ "$CHANNEL" = "stable" ]' arm — the stable case must be checked explicitly rather ` +
        `than falling into a catch-all default.`,
    );
    const elseMatch = /\belse\b([\s\S]*?)\n[ \t]*fi\b/.exec(block);
    assert.ok(
      elseMatch,
      `${RELEASE_WORKFLOW}'s "${jobId}" job's channel check has no bare 'else' arm to catch an ` +
        `unrecognised channel.`,
    );
    assert.match(
      elseMatch[1],
      /exit\s+[1-9][0-9]*/,
      `${RELEASE_WORKFLOW}'s "${jobId}" job's else-arm does not exit non-zero on an unrecognised ` +
        `channel — a CHANNEL that is neither "pre-release" nor "stable" (e.g. empty, from a failed ` +
        `resolver that this test's sibling now catches too) must fail the step, not fall through ` +
        `silently into whichever branch a bare else without a check would take.`,
    );
  }
});

test("no vsce package/publish line in release-vsix.yml hardcodes a bare --pre-release literal", () => {
  const contents = read(RELEASE_WORKFLOW);
  // Scanned over `run:`-body-only lines with shell `\`-continuations folded
  // into their parent line first — see extractRunBodyLines/foldContinuations
  // above for why: a raw per-physical-line scan (the previous approach) (a)
  // treats this file's own narrative prose ("vsce package"/"vsce publish"
  // appear repeatedly in header and step comments) as real packaging lines,
  // which alone can satisfy a length floor even with every real step
  // deleted, and (b) misses a hardcoded literal placed on the SECOND line of
  // a `\`-continued `vsce package`/`vsce publish` command.
  const vsceLines = foldContinuations(extractRunBodyLines(contents)).filter(
    ({ line }) => /\bvsce (package|publish)\b/.test(line),
  );

  // Four today: package_and_publish's `vsce package` + `vsce publish`, and
  // package_darwin_arm64's `vsce package` + `vsce publish` (packagePath-only,
  // but still a real `vsce publish` invocation) — >= 3 is the floor that also
  // catches "this whole mechanism got deleted", now that it can only be
  // satisfied by real `run:`-body lines, not this file's own prose.
  assert.ok(
    vsceLines.length >= 3,
    `${RELEASE_WORKFLOW} has fewer real "vsce package"/"vsce publish" run-step lines than expected ` +
      `(found ${vsceLines.length}) — if a publish step genuinely moved or was removed, ` +
      `update this test alongside it.`,
  );

  for (const { line, lineNo } of vsceLines) {
    // Strip legitimate $PRERELEASE_FLAG references first, then check what's
    // left for the literal — the flag's own name does not itself contain
    // "--pre-release", so this only ever strips the variable reference.
    const withoutVariableReference = line.replace(/\$PRERELEASE_FLAG/g, "");
    assert.ok(
      !withoutVariableReference.includes("--pre-release"),
      `${RELEASE_WORKFLOW}:${lineNo} hardcodes a literal --pre-release on a vsce package/publish line ` +
        `instead of reading $PRERELEASE_FLAG — this is package_darwin_arm64's old bug (always ` +
        `--pre-release, ignoring the odd/even parity rule) returning: an even-minor STABLE cut would ` +
        `silently ship this VSIX to the pre-release Marketplace channel behind a green run. Line: ${line}`,
    );
  }
});

test("PRERELEASE_FLAG=--pre-release is only ever assigned inside the pre-release branch, in both jobs' resolve step", () => {
  const contents = read(RELEASE_WORKFLOW);
  const jobs = sliceJobs(contents, [
    "package_and_publish",
    "package_darwin_arm64",
  ]);
  const ASSIGNMENT = /PRERELEASE_FLAG=--pre-release\b/g;

  // The vsce-line check above only catches the literal reappearing on a
  // `vsce package`/`vsce publish` line itself. It says nothing about WHERE
  // `PRERELEASE_FLAG` gets set to `--pre-release` in the first place — moving
  // that `echo` into the `stable` `elif` arm (or out of the if/fi entirely)
  // ships pre-release builds on a stable cut while every `vsce` line still
  // reads `$PRERELEASE_FLAG` exactly as it should, evading that check
  // completely.
  for (const jobId of ["package_and_publish", "package_darwin_arm64"]) {
    const body = jobs[jobId].join("\n");
    const ifBlockMatch =
      /if\s*\[\s*"\$CHANNEL"\s*=\s*"pre-release"\s*\]\s*;\s*then[\s\S]*?\n[ \t]*fi\b/.exec(
        body,
      );
    assert.ok(
      ifBlockMatch,
      `${RELEASE_WORKFLOW}'s "${jobId}" job has no 'if [ "$CHANNEL" = "pre-release" ]; then ... fi' ` +
        `block — cannot verify where PRERELEASE_FLAG gets assigned.`,
    );
    const block = ifBlockMatch[0];
    const thenIdx = block.indexOf("then") + "then".length;
    const branchEndIdx = (() => {
      const elifIdx = block.search(/\belif\b/);
      if (elifIdx !== -1) return elifIdx;
      const elseIdx = block.search(/\belse\b/);
      return elseIdx !== -1 ? elseIdx : block.length;
    })();
    const preReleaseBranch = block.slice(thenIdx, branchEndIdx);
    const restOfBlock = block.slice(branchEndIdx);
    const outsideBlock =
      body.slice(0, ifBlockMatch.index) +
      body.slice(ifBlockMatch.index + block.length);

    assert.match(
      preReleaseBranch,
      ASSIGNMENT,
      `${RELEASE_WORKFLOW}'s "${jobId}" job's pre-release branch does not assign ` +
        `PRERELEASE_FLAG=--pre-release — nothing arms the flag for the odd-minor case.`,
    );
    assert.doesNotMatch(
      restOfBlock,
      ASSIGNMENT,
      `${RELEASE_WORKFLOW}'s "${jobId}" job assigns PRERELEASE_FLAG=--pre-release inside the ` +
        `elif/else arm of its channel check — that ships a pre-release build on a channel this job ` +
        `itself resolved as "stable" (or unrecognised), the darwin/arm64-to-pre-release-channel bug ` +
        `returning through a path the vsce-literal check above cannot see.`,
    );
    assert.doesNotMatch(
      outsideBlock,
      ASSIGNMENT,
      `${RELEASE_WORKFLOW}'s "${jobId}" job assigns PRERELEASE_FLAG=--pre-release outside its ` +
        `pre-release/stable if/fi block entirely — it must only ever be armed by that explicit check.`,
    );
  }
});
