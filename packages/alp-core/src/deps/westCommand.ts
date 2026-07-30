// SPDX-License-Identifier: Apache-2.0
//
// Retargeting a `west` command tan handed us onto the actual binary this host
// resolved — pure string surgery, no dispatch, which is why it lives beside
// the planner rather than in it.
//
// Three measured facts on the pinned tan v0.4.1, all from a real Windows
// binary run (`tan doctor --build --format json`, exit code 4):
//
//  - tan's `missingPrerequisites[]` names the Zephyr SDK command as a bare
//    `west sdk install --version 1.0.1 -t arm-zephyr-eabi` — it does not know,
//    and should not have to know, where THIS host's `west` lives.
//  - that `west` is not on PATH. `alp bootstrap` / `tan bootstrap` installs it
//    into the workspace venv (`.venv/Scripts/west.exe` / `.venv/bin/west`),
//    never globally, so running the command verbatim fails with `'west' is
//    not recognized` before it ever reaches west's own argument parsing.
//  - the retargeted command must reach the process as an ARGV array, never a
//    re-quoted shell string: `sendText`-ing a quoted Windows path
//    (`"C:\Program Files\...\west.exe" sdk install …`) into PowerShell — the
//    default terminal profile on Windows — puts PowerShell in EXPRESSION mode,
//    so the quoted path parses as a string literal, not a command
//    (`Unexpected token '-v' in expression or statement`). cmd.exe and `sh`
//    accept the quoted form; PowerShell does not, and there is no quoting
//    convention that satisfies all three at once — an argv spawn (no shell in
//    between) sidesteps the question entirely.
//
// tan owns WHAT to run; the host owns WHERE and WITH WHICH binary — this
// function is the host's half of that split, and it goes no further: it does
// not know or care what `--version 1.0.1 -t arm-zephyr-eabi` means, so a
// future tan changing those flags needs no change here.

/**
 * `command`, tokenized on whitespace with its leading bare `west` token
 * replaced by `westBinary` — an argv array (`[westBinary, ...rest]`), meant
 * for a shell-less spawn (`ProcessExecution` / `child_process.spawn` with no
 * `shell: true`), never for re-joining into a command line.
 *
 * `null` when the first token is not exactly `west` — token boundary matters:
 * `westtool …` and `sudo apt-get install west` both return `null`; a prefix
 * match or a search anywhere in the string would retarget a command that
 * never meant to invoke `west` at all — OR when `command` contains a `"` or a
 * `'`. A quoted argument needs real shell-quoting-aware tokenizing to survive
 * a plain whitespace split without merging or dropping tokens, and tan's
 * measured command carries none, so this function does not attempt it: a
 * quote anywhere is treated as a shape it would mangle, and the caller falls
 * back to running the command through a shell verbatim instead.
 */
export function retargetWestCommand(
  command: string,
  westBinary: string,
): string[] | null {
  if (command.includes('"') || command.includes("'")) return null;
  const tokens = command.trim().split(/\s+/);
  if (tokens[0] !== "west") return null;
  return [westBinary, ...tokens.slice(1)];
}
