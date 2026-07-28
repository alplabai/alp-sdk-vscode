# Changelog

## Unreleased

- **Pinned to tan v0.4.0, and the envelope-contract gate now actually verifies
  something.** `SUPPORTED_CLI_VERSION` moves `0.3.1` -> `0.4.0`. That is not
  bookkeeping: v0.4.0 is the FIRST tan release to publish
  `envelope-contract.json`, and `scripts/fetch-tan-contract.mjs` builds its
  download URL from this pin. Before the bump the fetch 404'd on every run and
  five contract assertions skipped; after it they run. Skips across the suite go
  7 -> 2.

  Pointing the gate at a real artefact immediately showed it could not read one.
  `findFrozenCodes` DISCOVERED the frozen list by shape -- walking the document
  for any `*code(s)` key holding an array of code-shaped strings, or an object
  keyed by them -- because when it was written no published artefact existed to
  read the layout off. The real asset ships `issueCodes` as an array of OBJECTS
  (`{code, status, severity, consumer, consumerEffect, note}`), which matches
  neither accepted shape, so it collected nothing, `frozenCodes` came back
  `null`, and the one assertion the file exists for -- every code the pinned tan
  emits is in tan's frozen list -- SKIPPED on the very first artefact it was
  ever given. Loudly, to its credit, but skipped.

  The heuristic carried its own instruction for this moment: "when the layout is
  frozen, replace this with the one declared key and delete the heuristic rather
  than hardening it further." Done -- `doc.issueCodes`, accepting an entry as
  either a `{code}` object or a plain string, and a non-conforming entry now
  ASSERTS rather than being skipped past, because silently dropping one would
  shrink the frozen set and turn a producer-side rename into a green run.

  Verified by mutation, not by the green: renaming `bootstrap.yocto-host` to
  `bootstrap.yocto-only` inside the fetched artefact now fails the gate with
  "the match fails open -- it will never fire and nothing will say so". The same
  mutation before this change skipped, and passed.

  Stale comments in the same files are corrected while the facts are fresh: the
  artefact is no longer "does not exist yet", and its layout is no longer
  "not frozen".

- **The `tan` envelope contract is now checked against what tan publishes, not
  against a copy of it.** Every match this extension makes on tan's JSON
  envelope fails open: rename an issue code and `bootstrapHostVerdict` returns
  `{ refuse: false }`, rename a `data` field and a `?? []` yields an empty
  catalogue — no error, no log line, CI green on both sides, and the customer's
  first project scaffolds wrong. `scripts/fetch-tan-contract.mjs` (also
  `pnpm run contract:fetch`, and a CI step ahead of the tests) downloads the
  `envelope-contract.json` release asset for the pinned `SUPPORTED_CLI_VERSION`,
  and `test/tanContract.test.js` asserts every golden envelope still satisfies
  the repo's own `parseEnvelope` / `classifyExitCode`, and that the issue codes
  the pinned tan emits are in its frozen list. Nothing is copied into this repo:
  a hand-copied corpus drifts in exactly the way the gate reading it exists to
  catch.

  The six codes this extension matches by exact string are split by whether the
  PINNED tan emits them, because three of them deliberately do not. Membership
  is asserted only for the three that do; `bootstrap.windows-unsupported` is
  matched for a binary OLDER than the pin (v0.3.0 and earlier, reachable through
  `alpSdk.cliPath`) and `bootstrap.python-not-runnable` /
  `bootstrap.python-too-old` for one NEWER, so asserting either way about them
  would be wrong. What is asserted instead is that every code matched anywhere
  in `src/` is classified as exactly one of the two — a new match site cannot be
  added without someone deciding which kind it is.

  That asset does not exist yet, but not because the producer is missing:
  `alplabai/tan-cli#106` is MERGED and `release.yml` publishes
  `envelope-contract.json` on every tagged release. What is missing is a TAG —
  no tan release has been cut since #106 landed, and the newest that exists
  (v0.3.1) predates it. So the gate is built to be loudly inconclusive rather
  than quietly green. A 404 prints a `::warning::` naming the pin, the URL and the
  issue and exits 0, and the test then skips with all three facts in its reason,
  so the runner's own `# SKIP` line says the contract was not checked. A
  rate-limit, an outage or a timeout prints a second, distinctly worded
  `::warning::` and also exits 0 — "could not check" is a different fact from
  "not published", and neither is a defect in this repo. What does fail hard is
  anything that is not an availability problem: an asset that is published and
  does not parse as JSON, an unexpected non-OK status that is neither a 404, a
  rate-limit nor an outage, and an artefact that is present but yields zero
  assertions against anything only tan can be the source of —
  present-but-vacuous is the same defect wearing a different hat.
- **A release that pins an unpublished `tan` version now says so.** When
  `SUPPORTED_CLI_VERSION` named a tan-cli tag that was not published, the
  darwin-arm64 packaging job died on `curl: (22) The requested URL returned
  error: 404` and exit 22 — a bare status line that named neither the pin, nor
  the URL, nor what to do. The step now reports the resolved pin, the exact
  asset URL, the HTTP status and curl's exit code as `::error::` annotations
  (so they land on the run summary, not only in the raw log), and separates a
  404 — the tan release has to be published *before* the extension is tagged —
  from a network, proxy or permissions failure, which is a re-run rather than a
  repin. It stays fatal on purpose: this job exists only to ship the bundled
  binary, VS Code prefers a platform-specific VSIX over the universal one, and a
  darwin-arm64 VSIX with no `bin/tan` would be the universal VSIX wearing a
  platform label. A zero-byte 200 is now caught too, and every failure path
  removes `bin/tan` — which is cleanup after this change's own doing, not a
  pre-existing leak: the old step's `curl -f` suppressed the response body, so a
  404 wrote nothing at all (driven on curl 8.5.0: exit 22, `bin/` empty). `-f`
  is dropped here so curl's exit code reports transport health alone —
  `http_status=404 curl_exit=0` reads "the network was fine, the server said
  no", where `-f` collapses every HTTP error into exit 22 — and the price of
  that is curl writing the non-2xx body, GitHub's 9-byte `Not Found`, straight
  to `bin/tan`. The `rm` is what keeps it out of the package. Scope, for the
  record: the
  two packaging jobs are independent — nothing in the workflow declares
  `needs:` — so this failure never blocked the universal VSIX, which still
  packages, releases and publishes; what it lost was the darwin-arm64 VSIX, and
  the run went red.
- **The tan CLI download now goes through a proxy when there is one.** Node
  honours no proxy variable of its own and the extension never read VS Code's
  `http.proxy`, so on a machine behind a corporate proxy the download could not
  succeed at all — and the customer was told "Couldn't download the tan CLI …
  retry when you're back online", advice for an outage that was not happening.
  The download now resolves `http.proxy` first (a setting the user chose
  deliberately outranks the environment), then `HTTPS_PROXY` / `https_proxy` for
  https and `HTTP_PROXY` / `http_proxy` for http, with `NO_PROXY` / `no_proxy`
  bypassing either — `*`, an exact host, a leading-dot suffix, and an optional
  `:port`. https is tunnelled with `CONNECT` and http is sent in absolute form;
  `http.proxyStrictSSL` maps to TLS `rejectUnauthorized` inside the tunnel, so a
  TLS-inspecting proxy can be accepted, while a DIRECT download keeps full
  certificate verification either way (this transfer has no checksum of its own,
  so TLS is the only thing vouching for the bytes). No new dependency: this is
  `http.request({ method: "CONNECT" })` plus `tls.connect({ socket })`.
- **A proxy failure now says "proxy".** A refused or unresolvable proxy names
  the proxy and says it could not be reached; a rejected `CONNECT` names the
  status, with its own sentence for `407 Proxy Authentication Required`; a
  certificate rejection through the tunnel points at `http.proxyStrictSSL`. All
  three offer Settings before Retry, because retrying a blocked hop cannot work.
  Proxy credentials are stripped from every message, error and output-channel
  line — a proxy URL may be `user:password@host:port`, and the output channel is
  what customers paste into issue reports.

- **Documented what the `native_sim` debug session actually does**, after
  driving the generated configuration through a real CodeLLDB adapter rather
  than reasoning about it: the breakpoint verifies and hits inside the
  application's `main`, locals report real values, and `readMemory` works. Also
  corrects a claim in `docs/DEBUG.md` — the transitively installed debug views
  are not uniformly "installed but empty" on this path. `MEMORY` and `xRTOS`
  list debug types in their `activationEvents` and `lldb` is in neither, so on
  a `native_sim` session they do not attach at all; only `XPeripherals`
  activates and then hides itself for want of an SVD.

- **`Native host` debugging now says why it cannot work on Windows.** `native_sim`
  is a POSIX target — Zephyr's own board documentation says it creates "a normal
  Linux executable" — but the extension offered the target on every host with no
  check, wrote a launch configuration pointing at a binary Windows can never
  produce, and left the customer to discover that at F5. The preflight now fails
  on a Windows host with `native_sim builds a Linux executable, so it cannot run
  on this Windows host.` and names the way forward: reopen the folder in WSL, or
  use a Linux or macOS host. The target is still offered, because it becomes
  valid one click later and the same picker feeds the doctor and the support
  bundle.
- **A closing window is no longer reported as a failure.** When the extension
  host tears down — a window closing or reloading, or a folder-open replacing the
  workspace — VS Code rejects every pending request. Nine places treated that as
  a fault: a bootstrap "failed to start", "couldn't set the active SDK",
  "Couldn't download the tan CLI", "The tan CLI update failed", a project
  creation reported as failed on the one path where it had actually succeeded,
  and three unhandled rejections naming nothing at all. Each now returns quietly
  and says what was abandoned. A genuine error whose message merely mentions
  cancellation is still reported — the distinction is tested in both directions.
- Taking the offered **Reopen in WSL** action no longer opens a browser tab
  telling you to install Remote-WSL when you already have it: the reload that
  action triggers was being read as the command being absent.


- **One Dependencies panel replaces the Toolchain Doctor and folds in the SDK
  Manager.** It answers "is my machine ready, and is it current" in one table:
  every dependency `tan` checks — the SDK, the workspace, west, CMake, Ninja,
  the Zephyr SDK and the rest — with its installed version, the latest known
  version, the status `tan` reported, and one action. Rows are **derived** from
  what `tan` reports rather than listed here, so a check added upstream appears
  with no change to the extension, and a test asserts membership against a
  captured envelope rather than shape.
- **The old panel's Fix button was dead on every machine where `tan` resolves.**
  It rendered only when a per-check fix id was attached, and the CLI path never
  attached one. Buttons now say what they actually do — "Install", "Open install
  guide", "Run bootstrap" — each with a tooltip naming the effect, because two
  of the available fixes open a web page and install nothing.
- **The old panel could report "All required tools present" while Ninja was
  missing.** It treated `tan`'s `warn` as "not required", and `tan` caps an
  absent build tool at `warn` today. The new panel publishes no readiness
  verdict at all — it shows `tan`'s own three counts. When tan-cli#103 lands and
  a missing build tool becomes a `fail`, that number becomes a truthful blocking
  verdict with no change here.
- Versions are never invented: a cell `tan` cannot fill renders a dash, and a
  probed version is shown only for a row `tan` itself reports as passing. The
  pinned `tan` CLI is shown as pinned and never offered an "update" to a version
  older than the one installed.
- `[setup] readiness check failed: Canceled: Canceled` is gone. It was the
  extension host tearing down its RPC channel on window close — the check had
  not failed, the window went away — reported to the customer as a fault. Two
  defects rode with it: bookkeeping writes ran *before* the notification they
  could suppress, and the notification helper had no rejection handler, so a
  teardown produced an unhandled rejection naming nothing.
- The extension now recognises all three of `tan`'s bootstrap refusals. It knew
  only `bootstrap.prerequisites-missing`; a Python that is too old or not
  runnable fell through, so the real bootstrap ran anyway and the customer saw
  the same refusal twice with its guidance lost.
- A failed readiness refresh no longer replaces good state with an empty one, so
  a transient hiccup stops repainting a provisioned machine as "nothing
  installed".
- `vsce package` can no longer leave a stale bundle where `tsc --build` will not
  replace it: bundling now invalidates the build info, so an ordinary `compile`
  restores the real output.

- **A Windows upgrade could strand a customer on the old `tan` CLI.** Replacing
  the installed binary renames it aside first, and that rename fails when the
  `.old` slot is itself held — measured here as a hard, non-transient failure,
  so a retry loop would only ever have failed on customer machines. The move now
  falls back to a uniquely-suffixed name, and the leftover sweep can no longer
  abort the download by throwing on a file it cannot delete (it ran first, so a
  single locked leftover killed the upgrade before a byte was fetched). When the
  binary genuinely cannot be replaced the failure is now explicit, with the
  remedy on the toast rather than only in the log: closing the other window
  holding it is what helps, not retrying the download.
- **An E1M-AEN701 owner could not pick their own module.** The fallback hardware
  list used before an SDK resolves — the first-run path — was missing that
  released Alif Ensemble E7 module, and the wizard blocks until a module is
  chosen, so the nearest option was an E8 part. `tan init --som` then wrote the
  wrong silicon into `board.yaml`. The list, the shipped `board.yaml` snippets
  and the editor's SKU completion now all offer every SoM the SDK ships, and a
  test pins them against the SDK's own manifests instead of asserting shape.
- Six build and flash commands no longer run the CLI when no folder is open;
  they say what to open, as bootstrap and the Toolchain Doctor already did.
- Build and Flash are no longer offered while a bootstrap is still running.
  tan 0.4.0 stops reusing a workspace across a patch-level Zephyr bump, so that
  window grows from seconds to minutes.
- `tan 0.4.0-rc.1` no longer compares equal to `0.4.0`, and a newer-than-pinned
  CLI reports honestly instead of silently.
- An upgrade from a build older than 0.3.7 is no longer reported as a first
  install. The marker that distinguishes them did not exist before 0.3.7, so
  state left by the older build is what tells them apart — without it the whole
  existing customer base was misreported on the one activation where knowing it
  was an upgrade matters.
- `pnpm run typecheck` now type-checks the extension, the shared core and the
  webview, and runs in CI. The webview built with no type checking at all, and
  the fast check people reach for (esbuild) strips types without checking them —
  it passed a null-dereference that `tsc` caught.

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

- The debug launch configuration now comes from `tan debug-config` instead of
  being drafted a second time in TypeScript. The extension had its own copy of
  that decision, and both copies shipped the same unresolved
  `"device": "<resolved-device>"` placeholders — fixing either left the other
  handing out a `launch.json` that cannot start a session. `tan` resolves
  `device` / `gdbPath` / `serverpath` / `searchDir` / `configFiles` from the
  build's own `runners.yaml` and writes the file; there is deliberately no
  fallback draft. What stays in-process is the readiness report, which probes
  which debugger extensions are installed — host state a separate process
  cannot observe. Closes #339.
- **Requires `tan` 0.4.0 or newer.** This is a hard requirement, not a
  preference: an older binary has no `--core` flag (it exits 2 with
  `error: unexpected argument '--core' found`) and carries no
  `data.configuration`, so it cannot produce a debug configuration at all. The
  command now says so and points at "Alp: Update CLI" rather than reporting a
  failure and "Command completed." in the same breath.
- Debug pre-launch works instead of aborting. Every generated profile
  references a pre-launch task by label — `alp: build active target`,
  `alp: build baremetal target`, `alp: build native_sim target`,
  `alp: deploy and start gdbserver` — and nothing defined them, so VS Code
  could not resolve the task and refused to start the session, pointing at a
  `launch.json` that looked perfectly fine. The extension now contributes all
  four as an `alp` task type: the three build labels run the project build (the
  same run the Build button dispatches, so the two can never race), and the
  Yocto one names the manual deploy step and fails rather than dropping the
  user into a session with no `gdbserver` on the other end.
- A `launch.json` that still holds `<resolved-…>` values now says which ones.
  The "not launchable yet" warning listed nothing at all (`resolve: .`) because
  the finding never reached the readiness report's checks; the unresolved
  fields and their fix are now in the report and in the Alp SDK channel.
- A bootstrap refused over Python is reported instead of dying as a launch
  failure. `tan` refuses with `bootstrap.python-not-runnable` or
  `bootstrap.python-too-old` (e.g. a Microsoft Store stub, or 3.9 against the
  3.10 floor) and only `bootstrap.prerequisites-missing` was recognised, so
  those refusals fell through to a real bootstrap terminal that died with
  `failed to launch (exit code: 1)` — hiding tan's own actionable message.
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
