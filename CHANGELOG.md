# Changelog

## Unreleased

- **A new customer can now find the getting-started walkthrough.** It was
  promoted only to workspaces that already contained a `board.yaml` — the file
  its own third step exists to create — so the one guided path through setup was
  shown only to people who had already finished it. The gate is gone.
- **The walkthrough no longer tells you to bootstrap before you have a project.**
  Its order was "install SDK, bootstrap, open a project, build", but bootstrap
  needs an open folder and creating a project is what produces one. Following it
  literally with nothing open ran the CLI against a directory the customer never
  chose: with no folder, `cwd` was undefined and the child inherited the
  extension host's working directory. Bootstrap and the Toolchain Doctor now
  refuse with "Open a folder to …" and a button that does it, and the terminal
  helper's `cwd` is a required argument so the compiler finds any future site
  that forgets one.
- The "Install the Alp SDK" step now completes when an SDK is actually made
  active, not when the SDK Manager is merely opened, and the step says that
  installing and activating are two separate clicks. The other three steps still
  complete on a click; there is no honest signal to observe yet, and that is
  recorded rather than papered over.
- The **Flash** button on the last step ran the legacy plain-`west` command
  instead of the tan-backed one the status bar uses. It now runs the same
  command as the status bar.
- **A tan CLI newer than the pinned one is no longer silent.** A newer patch
  release stays quiet — it cannot move the envelope contract — but a newer minor
  or major warns once, because this extension matches exact issue-code strings
  and unversioned envelope field names that all fail open: a rename there skips a
  check instead of erroring. The warning's button used to be labelled "Update"
  while actually downgrading the CLI to the pinned version; it now says what it
  does and offers updating the extension too.
- A pre-release CLI no longer passes as the finished release — `tan 0.4.0-rc.1`
  compared equal to `0.4.0`.
- The "build tools changed since last session" notice no longer fires for a
  change the customer did not make. Its stored fingerprint carries a format tag,
  so a value written by an older build is treated as not comparable instead of as
  drift, and the "already shown" gate now lives in the same scope as the data it
  gates rather than suppressing the notice in every other workspace.
- The extension records whether an activation is a first install or an upgrade,
  and says which in the output channel — the first thing worth knowing when a
  customer reports that something behaves differently than it used to.
- `capabilities.untrustedWorkspaces` is declared, so a customer in Restricted
  Mode is told why the extension is unavailable instead of it silently vanishing.
- The end-to-end gate is pinned to VS Code 1.129.1. On 1.130.0 the downloaded
  archive build ships no signature-verifying tool, so installing *any* extension
  fails with `Signature verification failed with 'ENOENT' error.` and the suite
  died before its first check.

- **"Alp: Native Sim Debug" can start.** It emitted `"type": "codelldb"`, which
  is not a debug type any extension registers — CodeLLDB registers `lldb`, and
  `codelldb` is only the extension's name — so pressing F5 died with
  `Configured debug type 'codelldb' is not supported.` native_sim is the only
  target reachable with no probe and no board, so this was the first debugging
  experience anyone had, and it had never worked. Two unit assertions named the
  broken value and passed; both are corrected, and a new test asserts every
  emitted debug type is one an extension this package declares actually
  contributes. The end-to-end suite now starts a real debug session in a real
  VS Code, so a debug type that does not exist can no longer reach a release.
- Native-sim debugging no longer demands an LLDB on `PATH`. The preflight
  probed `lldb-dap`/`lldb`, but CodeLLDB ships its own, so a stock machine was
  told the session was not launchable and offered "Start Anyway". Preflight and
  the Toolchain Doctor now agree that no debug server is needed for that target.
- Hand-edited launch configurations survive. `launch.json` is rewritten before
  every session, and the whole matching configuration was replaced — so a device
  name typed in by hand was silently overwritten on the next F5. The write now
  merges: a value already filled in is kept when the freshly generated one is
  still an unresolved placeholder, while everything else refreshes.
- A launch configuration that cannot start now says which fact is missing — the
  J-Link device name, the pyOCD target id, the OpenOCD board config — in the
  customer's terms, and offers to open `launch.json`. The Alp SDK does not
  publish that probe metadata yet; alp-sdk#987 tracks it, alp-sdk#948 tracks the
  SVD half.
- The peripheral/register view is wired for Zephyr targets, not just baremetal,
  and a missing SVD no longer blocks a launch — it is optional to cortex-debug
  and only feeds that view, so a customer can set breakpoints without one. An
  unresolved SVD path is now omitted rather than written as a literal
  `<resolved-svd>`, which cortex-debug would have tried to open as a file.

- Every notification now says what failed and carries the button that fixes it.
  A failed terminal command used to surface only VS Code's `failed to launch
  (exit code: 1)` — its wording for any non-zero exit, which reads as if `tan`
  never started — plus a toast naming the same exit number and nothing else.
  Commands now route through one seam (`src/notify/`): a pure planner that
  derives severity from the classified CLI outcome and guarantees an action,
  and a single presenter that is the only caller of `vscode.window.show*Message`.
  Concretely: `summarize()` no longer drops every issue after the first (the
  toast names the first plus a count, and an action opens the full list); raw
  `stderr`, errnos, stack frames and exit codes are demoted to the "Alp SDK"
  output channel instead of being rendered in the toast; a CLI that was never
  installed no longer reads like one that is broken, and the two offer different
  remedies; first-run preconditions (no folder, no `board.yaml`, no SDK) are
  warnings carrying New Project / Open Setup rather than red errors with an
  interpolated path; and transient successes moved from dismissible toasts to
  the status bar. 86 call sites across 19 files were audited and either fixed or
  justified. `test/notify.guard.test.js` fails if a raw interpolated
  `show*Message` reappears.
- The tan CLI download, the tan CLI update and the SDK install are cancellable.
  All three could run for minutes with no way to stop them, which reads as a
  hung window. Cancelling now aborts the real child process, and a cancelled SDK
  install removes the partial clone — `git clone` refuses a non-empty directory,
  so leaving it behind made the *next* install of that version fail for an
  unrelated-looking reason.

- A stranded west workspace no longer stays silent. Switching or uninstalling an
  SDK never touched `<topdir>/.west/config`, whose `[manifest] path` `west`
  reads directly and independently of the active-SDK pointer — so removing the
  version it named left the workspace's only manifest pointer naming a directory
  that no longer exists. Nothing surfaced it: `west` fell back to whatever
  `$ZEPHYR_BASE` named and a flash failed with `unknown runner "alif_flash"`.
  Activation, SDK removal and the Toolchain Doctor now inspect that pointer and
  warn with the stale value, offering Bootstrap. Only the SDK's own topdir is
  inspected — an unrelated `~/zephyrproject` or `$ZEPHYR_BASE` tree is never
  reported, since switching an SDK does not invalidate it. Closes #349.
- The Toolchain Doctor now offers its bootstrap fix for a workspace that is
  present but broken, not only for one that is absent. Its `workspace` check
  asks whether a workspace resolves, and an ambient `$ZEPHYR_BASE` pointing at
  any unrelated Zephyr checkout is enough to keep that green — which is why the
  offer never appeared for the workspace that was actually broken. The check is
  also rendered as failing in that case, so the panel no longer reports
  "toolchain OK" while the toast says the workspace is broken. For that case
  the fix runs `tan bootstrap` rather than `tan doctor --build --fix`, which
  bootstraps only when its own `workspace` check fails and so would have
  repaired nothing.
- The Zephyr-workspace readiness probe stops accepting a workspace whose
  manifest names a missing directory. This demotes only when *every* candidate
  dangles: a healthy candidate later in the list still satisfies the probe, so a
  legitimate `$ZEPHYR_BASE` workspace is demoted, never disqualified, and a
  config that cannot be parsed unambiguously still counts as initialized so
  parse ambiguity never demotes a working setup.
- The repair itself stays in `tan` (`tan bootstrap` since tan-cli #31,
  `tan sdk switch` since tan-cli #74); the extension only detects and reports.
  Delegating the switch is queued behind a `SUPPORTED_CLI_VERSION` bump to the
  first tan-cli release carrying tan-cli #74. Note that `tan bootstrap` skips
  the reconcile when it reuses an existing `$ZEPHYR_BASE` workspace, so the
  logged line also carries the manual fix.

## 0.3.7

- Bump the `alp-sdk-upstream` submodule pin from `v0.12.0` to `v0.13.0`.
- Re-vendor `src/lsp/generated/kconfig-metadata.json` and
  `test/fixtures/alp-kconfig-symbols.txt` against the new pin (219 metadata
  entries, 343 `ALP_*` symbols — unchanged counts; only the recorded
  `submoduleRev` moved).
- The kconfig contract-fixture drift gate
  (`test/lsp.kconfigContractFixture.test.js`) now runs instead of skipping:
  the submodule pin has advanced past alp-sdk#897, which added the canonical
  `tests/fixtures/kconfig-contract/emit-kconfig.golden.json` fixture that
  alp-sdk, tan, and this extension all test against byte-for-byte. Closes
  #301.
- `SUPPORTED_CLI_VERSION` -> `0.3.0` to track the tan-cli v0.3.0 release.
- Linux downloads switch from the `-gnu` to the `-musl` release asset
  (`x86_64`/`aarch64-unknown-linux-musl`, published starting at tan-cli
  v0.3.0): the `-gnu` binary carries a glibc 2.31 floor and fails with
  `GLIBC_2.39 not found` on older distros, while `-musl` is fully static and
  runs anywhere, including the `-gnu` asset's own build host. `win32`/`darwin`
  targets are unchanged.
- `media/tan-install/install.sh` (the standalone global-install script,
  distinct from the extension's own managed download) switches to the same
  musl asset, with a clearer error when a download fails.
- Each tagged release now also cuts a GitHub Release with `alp-sdk.vsix`
  attached, instead of leaving a tag with no visible release page.
