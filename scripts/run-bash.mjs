#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Run a repo shell script under a bash that can actually see the Windows
// toolchain. `npm`/`pnpm` resolve a bare `bash` off PATH, and on a stock
// Windows 11 box the first hit is
// C:\Users\<you>\AppData\Local\Microsoft\WindowsApps\bash.exe — the WSL
// launcher. WSL is a different filesystem with a different PATH, so the
// script starts and then dies on the first tool it needs:
//
//     > bash ./scripts/install-vscode.sh
//     node is required but not found on PATH.
//
// Git Bash is the shell these scripts are written for on Windows (MSYS paths,
// the Windows node/pnpm/code binaries). On Linux and macOS plain `bash` is
// already correct, so this shim is a no-op passthrough there.
//
// Usage: node scripts/run-bash.mjs <script.sh> [args...]
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** True for the WSL launcher shim, which must never be chosen: it runs in a
 *  Linux root where the Windows node/pnpm/code on PATH do not exist. */
function isWslLauncher(p) {
  return /[\\/]WindowsApps[\\/]/i.test(p);
}

/**
 * Locate a Git Bash. Asking git where IT lives is the reliable route — it
 * follows a custom install dir, a portable install, and winget/choco layouts,
 * none of which the hardcoded Program Files guesses below would find.
 * `git --exec-path` returns <gitRoot>/mingw64/libexec/git-core, so bash.exe is
 * three levels up in <gitRoot>/bin.
 */
function findGitBash() {
  const git = spawnSync("git", ["--exec-path"], { encoding: "utf-8" });
  if (git.status === 0) {
    const execPath = git.stdout.trim().replace(/\//g, path.sep);
    // <gitRoot>/mingw64/libexec/git-core -> <gitRoot>
    const root = path.resolve(execPath, "..", "..", "..");
    for (const rel of [
      ["bin", "bash.exe"],
      ["usr", "bin", "bash.exe"],
    ]) {
      const candidate = path.join(root, ...rel);
      if (existsSync(candidate)) return candidate;
    }
  }
  const guesses = [
    path.join(
      process.env.ProgramFiles ?? "C:\\Program Files",
      "Git",
      "bin",
      "bash.exe",
    ),
    path.join(
      process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "Git",
      "bin",
      "bash.exe",
    ),
    path.join(
      process.env.LOCALAPPDATA ?? "",
      "Programs",
      "Git",
      "bin",
      "bash.exe",
    ),
  ];
  return guesses.find((p) => p && existsSync(p)) ?? null;
}

function resolveBash() {
  if (process.platform !== "win32") return "bash";
  const gitBash = findGitBash();
  if (gitBash) return gitBash;
  // No Git Bash. Only accept a PATH `bash` that isn't the WSL launcher, so a
  // real MSYS2/Cygwin bash still works; otherwise fail with the fix, rather
  // than handing the script to WSL and letting it die on a missing `node`.
  const where = spawnSync("where.exe", ["bash"], { encoding: "utf-8" });
  const usable = (where.stdout ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !isWslLauncher(l));
  if (usable.length) return usable[0];
  console.error(
    "No Git Bash found. These scripts need Git Bash on Windows — the `bash` on\n" +
      "PATH is the WSL launcher, which cannot see the Windows node/pnpm/code.\n" +
      "Install Git for Windows (https://git-scm.com/download/win), or run the\n" +
      "script directly:\n" +
      '  & "C:\\Program Files\\Git\\bin\\bash.exe" ./scripts/install-vscode.sh',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("usage: node scripts/run-bash.mjs <script.sh> [args...]");
  process.exit(2);
}

const result = spawnSync(resolveBash(), args, { stdio: "inherit" });
if (result.error) {
  console.error(`failed to launch bash: ${result.error.message}`);
  process.exit(1);
}
// A signal-killed child has status null; report it the way a shell would.
process.exit(result.status ?? 1);
