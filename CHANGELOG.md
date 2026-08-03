# Changelog

## 0.5.2

**Pre-release.** Continues `0.5`'s odd-minor pre-release channel —
`release-vsix.yml` still publishes this build with `--pre-release`, reaching
only Marketplace/Open VSX users opted into pre-release updates.

- **The managed `tan` download now unpacks an archive release, not just a raw
  binary (tan-cli#349).** tan-cli's onefile PyInstaller freeze re-extracted
  itself on every invocation — 14 MB, 13-19 s on macOS — which could outrun
  this extension's own `commandOnPath` probe and version checks well before a
  user ever ran a build. A onedir freeze zipped/tarred into one archive per
  target fixes that, at the cost of `download.ts` needing an unpack step it
  never had.

  `.zip` (win32) and `.tar.gz` (elsewhere) are both unpacked with the OS's own
  `tar` — Windows has shipped a real `tar.exe` in `System32` since 10 1803
  (bsdtar/libarchive, which reads `.zip` as readily as `.tar.gz`), and macOS
  and Linux ship one too; Node's stdlib has no tar reader and nothing was
  added to work around that. Windows resolves it by absolute path rather than
  a PATH lookup, deliberately: Git for Windows ships its own `tar.exe` (GNU
  tar) which cannot read `.zip` at all, and a bare `"tar"` risks finding that
  one first on a great many developer machines.

  Which of the two install paths runs (extract vs. rename-straight-in) is
  decided by the downloaded bytes' own magic number — never by the pinned
  version, which is what lets a pin naming any release through `v0.5.0-rc4`
  (a raw binary) and a pin naming an archive release both keep installing
  correctly through the exact same code, with nothing here to edit on
  tan-cli's next release either way. The archive's checksum is still verified
  before anything is unpacked, exactly as the raw binary always was;
  unpacking it is checked again afterward, since a checksum on the archive
  proves it arrived intact, not that what came out of it is a working
  launcher.

- **Fix: which ASSET NAME to even request was still guessed, not resolved
  (#463).** The archive and raw shapes are published under *different* asset
  names — `tan-<triple>[.exe]` vs `tan-<triple>.zip`/`.tar.gz` — not the same
  name with different bytes, so the `tan-<triple>[.exe]` sentence two
  paragraphs up was wrong the moment an archive release existed: requesting
  the raw name against one 404s outright. `resolvePublishedAsset`
  (`download.ts`) now reads the release's own `checksums.txt` once and takes
  whichever candidate name has an entry, before a single asset byte is
  fetched — never a per-version table, which is the same trap
  `HOSTS_WITHOUT_RELEASE_ASSET` exists to avoid for a different question.

- **Fix: the cached-binary integrity digest covered the launcher only, not
  the installed tree (#464).** A PyInstaller onedir release is not one file:
  libpython, every native extension module and the Python bytecode live in a
  `_internal/` sibling `installArchive` moves in beside the launcher, and none
  of that was ever hashed — a rewrite of a `_internal/` entry after install
  matched the (launcher-only) recorded digest forever, and the extension
  spawned it having reported the resolution as verified. `sha256Tree`
  (`vscodeAdapter.ts`) now digests the whole installed tree, per-file
  memoized so an unchanged resolution re-reads nothing and a real tamper pays
  only for the entry that changed.

- **Fix: candidate resolution preferred the raw shape over the archive when a
  release listed both (#465).** `resolvePublishedAsset` searched `[raw,
  archive]` in that array order and took the first match; a release kept for
  a transition period would have resolved to raw every time, silently
  resurrecting the 13.25-19.74s macOS onefile startup tan-cli#349 exists to
  kill, with no error to catch it. It now prefers the archive whenever both
  are listed.

- **Fix: `checksums.txt` was fetched twice per managed download (#465) —
  measured at three requests where tan-cli#176's design is two.**
  `resolvePublishedAsset` already reads the manifest once to pick a
  candidate and discarded the digest it found; `downloadFile` then fetched
  the same file again to re-derive it. The digest is now threaded through
  `resolveAsset`'s result (`ResolvedAssetCandidate`) to `download`, so it is
  read once — which also makes "the digest came from the same manifest as
  the candidate choice" a fact by construction rather than an assumption
  resting on the URL returning identical bytes twice.

- **Docs: the ADR 0021 citation for the consent dialog's no-network-before-
  consent rule named a "Tier A requirement 4" that does not exist in the
  ADR.** The ADR says "three tiers, one consent screen" naming
  artifact/source/size/licence, and "install after one consent click" for
  Tier A — not doing zero network activity before the click, which is this
  extension's own tighter rule. Restated as this repo's own rule at both
  citing sites (`service.ts`, `vscodeAdapter.ts`) instead of citing text the
  ADR does not contain.

- **`SUPPORTED_CLI_VERSION` moves to `0.5.0-rc4`, was `0.5.0-rc2`.** This
  extension release has not shipped yet, so rc3 never reached a user through
  it; the pin goes straight to rc4 rather than stacking two entries for what is
  one bump from a user's point of view.

  Both RCs came from running the *published* binary end to end on real Windows,
  macOS and Linux hosts rather than from testing the source. Four of their
  fixes matter directly to this extension's users: the macOS asset shipped with
  no CA trust anchors at all, so every HTTPS call failed
  `CERTIFICATE_VERIFY_FAILED` (tan-cli#304); `tan doctor` exited 4 on every
  fresh install because "west in the venv, absent from PATH" — the guaranteed
  state of a GUI-launched VS Code — was reported as a broken host
  (tan-cli#299); `tan init` and `tan generate` could follow a symlinked parent
  and write outside the project while reporting success (tan-cli#325); and
  `envelope.serialize-failed` printed `exitCode: 5` while the process exited
  `0`, breaking the `process exit code == stdout envelope.exitCode` invariant
  this extension relies on to decide whether a run failed (tan-cli#327).

  `HOSTS_WITHOUT_RELEASE_ASSET` carries the identical `win32/arm64` /
  `linux/arm64` gap forward. Checked against the published rc4 tag rather than
  carried on the assumption it would hold: rc4 ships the same four binaries as
  rc1–rc3, and tan-cli's `release.yml` names that omission deliberate rather
  than incidental.

## 0.5.1

**Pre-release.** Continues `0.5`'s odd-minor pre-release channel —
`release-vsix.yml` still publishes this build with `--pre-release`, reaching
only Marketplace/Open VSX users opted into pre-release updates.

- **`SUPPORTED_CLI_VERSION` moves to `0.5.0-rc2`, was `0.5.0-rc1`.** The
  previous pin, `0.5.0-rc1`, is a published tag but was never the target of a
  follow-up bump, so nobody on the pre-release channel actually received it.
  `0.5.0-rc2` is the RC that fixes the venv resolver, the bootstrap
  relocation, and the six dropped `doctor` checks. `HOSTS_WITHOUT_RELEASE_ASSET`
  carries the identical `win32/arm64` / `linux/arm64` gap forward — rc2's
  release matrix ships the same four assets as rc1, not a wider one.

- **The Toolchain Doctor's build fix now runs `tan bootstrap`, not `tan doctor
  --build --fix`.** The flag does not exist on the Python `tan` — it exits 2
  with `No such option: --fix` and returns a `cli` usage envelope, not a
  doctor envelope, so the fix path got neither a report nor a usable error.
  `tan bootstrap` is what the flag was meant to trigger in the first place (it
  only bootstraps when its own `workspace` check fails). tan-cli#295.

## 0.5.0

**Pre-release.** `0.5` is an odd minor, so `release-vsix.yml` publishes this
build with `--pre-release` — it reaches only Marketplace/Open VSX users opted
into pre-release updates. Stable users stay on the even-minor `0.4.x` line,
pinned to a Rust `tan`, untouched. This is the first extension build that pins
a **Python** `tan` (`alplabai/tan-cli`'s PyInstaller-freeze port) instead of
the Rust binary every prior release used.

- **`SUPPORTED_CLI_VERSION` moves to `0.5.0-rc1`, the first Python `tan`
  release candidate.** Its own commit, deliberately not combined with this
  extension's version bump — the two are different numbers that happen to
  look alike. The items below are its direct prerequisites.

- **`TARGETS`' `linux/x64` now resolves `x86_64-unknown-linux-gnu`, not
  `-musl`.** A PyInstaller Linux freeze is musl-*dynamic* (its bootloader
  declares ELF interpreter `/lib/ld-musl-x86_64.so.1`), not the static
  artefact the Rust `-musl` build was, so it does not start on
  Ubuntu/Debian/Fedora at all — `-gnu` is the only usable Linux asset a Python
  `tan` release publishes. It is built inside `python:3.12-slim-bullseye`
  (Debian 11, glibc 2.31); the measured floor over the PyInstaller payload is
  `GLIBC_2.30`, for the same reason the Rust `-musl` asset was chosen: to run
  on the widest range of distros without a version floor surprise. (Not a
  `manylinux2014` container — static CPython there fails PyInstaller's own
  build.) `win32/arm64` and `linux/arm64` are unaffected by this change and
  remain declared gaps (below).

- **`win32/arm64` and `linux/arm64` are now declared unpublished for
  `0.5.0-rc1`, not silently expected to resolve.** `alplabai/tan-cli`'s
  PyInstaller build cannot cross-compile, and its release publishes exactly
  four assets (Windows x64, macOS x64/arm64, Linux x64) — none for either
  arm64 host. `HOSTS_WITHOUT_RELEASE_ASSET["0.5.0-rc1"]` records both, so the
  "no prebuilt tan CLI for this platform" message (below) fires instead of a
  download that 404s, and `scripts/check-cli-pin.mjs` verifies the declaration
  against the real release rather than trusting it.

- **`install.sh`/`install.ps1` (the standalone global-install scripts bundled
  under `media/tan-install/`) re-vendor to tan-cli `v0.4.1` and stop naming a
  Linux `-musl` asset a Python `tan` release does not publish.** `v0.4.1`
  shipped a checksum-verification rework of both scripts (237/169 lines) that
  the prior `v0.4.0` pin predates — installing via the global command put an
  **unverified** binary on PATH while the extension's own managed download
  already refused one (#386/#389). On top of that base, `install.sh`'s Linux
  case now maps to `-gnu`, with a pre-download refusal on an actual musl host
  (Alpine): without it, the script would download the `-gnu` asset, verify its
  sha256 (proves the bytes match what was published, not that they can
  execute on this libc), install it, and exit 0 having silently produced a
  binary that can never run. Both scripts' vendored-parity test
  (`test/alpCli.installTanCli.test.js`) declares all of this as tracked
  deviations from the upstream `v0.4.1` files, reverse-applied and re-hashed
  against the real upstream bytes — the sha256 parity gate stays honest about
  the edits rather than silently accepting a hand change. Every doc naming
  `tan-x86_64-unknown-linux-musl`, and every comment arguing the old
  musl-over-gnu rationale, now names `-gnu` and explains why a PyInstaller
  freeze cannot use musl instead.

- **`installTanCliGlobally` ("Install tan CLI (global)") now short-circuits a
  declared-gap host instead of running the installer script and letting it
  404.** The vendored scripts pick an asset from `uname -m` alone — they know
  nothing about `HOSTS_WITHOUT_RELEASE_ASSET` — so `win32/arm64` and
  `linux/arm64` used to split from the managed download's behaviour: that
  path already explained the gap with no network call, but this command ran
  the script anyway (`install.ps1`: a raw `Invoke-WebRequest` exception;
  `install.sh`: `download failed: ...`, exit 1). Now shows the identical
  "no prebuilt tan CLI for your platform" message and remedy
  (`alpSdk.cliPath`) either way.

- **A tan release candidate now compares by number, so an installed `rc9` is no
  longer read as newer than a pinned `rc10`.** Two pre-releases on the same
  `MAJOR.MINOR.PATCH` were compared as plain text, which is correct up to `rc9`
  and silently wrong from `rc10` on: the older binary looked ahead of the pin,
  nothing reported it as behind, and the stale-cache self-heal never ran — no
  error, no prompt, the user simply stayed on the older release candidate. The
  single comparison every skew decision routes through now walks the
  pre-release identifier by identifier, comparing digit runs as numbers, so
  both spellings tan may tag (`0.5.0-rc1` and `0.5.0-rc.1`) order correctly and
  compare equal to each other. Ordering against a finished release is
  unchanged: a release candidate is still older than its own release.

- **A `tan` release that publishes no binary for your platform is now an
  explained state instead of a download that 404s.** Which platforms a release
  ships is a property of that release — a PyInstaller-built `tan` cannot
  cross-compile, so it publishes fewer assets than the cargo-built ones did —
  and the extension now knows which hosts the pinned release skips before it
  builds a URL for one. Those hosts get a sentence naming the platform and the
  `tan` version, saying the gap belongs to that release rather than to their
  install, and pointing at `alpSdk.cliPath` for a locally built or
  `pip install`ed `tan`; every other platform keeps the managed download
  unchanged. The declaration cannot go stale: the `SUPPORTED_CLI_VERSION` CI
  gate probes every mapped platform against the pinned release and now fails
  both ways — a platform declared unpublished whose asset does exist is a
  stale entry, exactly as loudly as an asset that is genuinely missing.

- **`SUPPORTED_CLI_VERSION` can now name a tan prerelease.** The three places
  that resolved the pin by pattern — the release workflow's darwin packaging
  job, CI's macOS bundled-binary check, and the envelope-contract fetch script —
  all matched `MAJOR.MINOR.PATCH` only, so a pin such as `0.5.0-rc1` resolved to
  the empty string and failed the job. All three accept a SemVer prerelease
  suffix now, in both greps of the shell pipeline so the suffix cannot be
  silently truncated to a version the pin never named, and
  `test/cliPin.prerelease.test.js` drives the real patterns against real
  prerelease fixtures. The pin's value is unchanged.

- **A release now verifies up front that the pinned tan tag is published.**
  `scripts/check-cli-pin.mjs`, already a CI gate, runs on the release path too:
  it HEADs the release asset for every host the extension downloads for, so a
  missing tag or a half-uploaded release stops the run instead of reaching
  customers as a 404 loop on activation. Only a 404 fails it — a rate-limit or
  an outage reports as skipped.

## 0.4.1

- **New setting `alpSdk.tanCliDownloadConsent` (`ask` / `allow` / `deny`,
  default `ask`, machine-overridable) gates the extension's first managed
  download of the `tan` CLI.** The first time nothing else resolves a `tan`
  binary, the extension shows a one-time consent dialog (artifact, source,
  size, licence) before fetching it; the answer is remembered, so it asks only
  once. `allow`/`deny` pre-answer it for a managed/CI image and never prompt.
  `deny` is honoured in every state where nothing is currently running a `tan`
  — including a machine with a stale, not-yet-checksum-verified copy left in
  the extension's global storage and nothing on PATH, which is still "nothing
  running", not a binary to migrate off of. Two later self-heals of a `tan` a
  customer ALREADY HAS — a stale-cache version update, and the one-time
  re-verification of a binary cached before this extension started recording
  checksums — stay ungated by design and never consult this setting; the
  second of those now applies only to a customer who is actually running the
  unverified copy via the PATH fallback, the one case it exists to heal.
  Running **Install tan CLI (global)** or **Update tan CLI** from the command
  palette always proceeds regardless of a stored decline, and now clears it,
  so declining once does not shadow a later explicit ask. This dialog is
  reserved for a command the customer just triggered (build/validate/
  generate/debug-config/sdk-switch/materialise/the Dependencies panel's
  explicit Refresh click/opening the Build Plan panel/…); a resolution that
  runs on its own — the language server's completion-catalog refresh, the
  Dependencies panel's focus/settings-edit/bootstrap-boundary re-derives, the
  Build Plan panel's file-watcher refresh, a background version check — never
  raises it, and several such resolutions racing in the same window (e.g. two
  open `prj.conf` tabs) now share one resolution instead of each opening its
  own dialog or running its own download. A decline reaching a status surface
  that reads the outcome directly (e.g. the Dependencies panel) now names the
  setting explicitly and shows as a warning rather than a red error.

- **A click that lands while a BACKGROUND resolution (activation's version
  check, or another non-user-triggered caller) is still resolving the `tan`
  binary now still raises its own consent dialog, instead of silently
  inheriting the background caller's refusal.** The in-flight dedupe above
  shares one resolution among concurrent callers, but joining it verbatim also
  meant joining its `interactive` flag — so an unanswered "ask" left a real
  click (the Dependencies panel's Refresh, opening the Build Plan panel)
  quietly refused with nothing shown, on any window where the background
  check was still running (it spawns `tan --version` with a 5 s cap on every
  activation). It does not fork a second resolution to fix this — two
  attempts racing to the download step is exactly what the dedupe exists to
  prevent — it chains: the click's own resolution now waits for the
  background one first, and only opens the dialog if that one failed
  specifically because consent was unanswered; any other outcome (success, or
  an unrelated failure) is used as-is.

- **The Zephyr SDK row's Install button now runs, instead of failing with
  `'west' is not recognized`.** The pinned tan v0.4.1's `west sdk install
  --version 1.0.1 -t arm-zephyr-eabi` command is correct, but `west` is not on
  PATH after `tan bootstrap` — it lives in the workspace venv
  (`.venv/Scripts/west.exe` / `.venv/bin/west`) — and the button ran the
  command verbatim in a plain terminal. It now retargets the leading `west`
  token onto the resolved venv binary and runs it from the west workspace's
  top-level directory (the one holding `.west/`), which `west sdk install`
  requires and the open project folder is not — as an argv array dispatched
  with no shell in between, never a re-quoted command line: a quoted Windows
  venv path put PowerShell, the default Windows terminal profile, into
  expression mode instead of running it. tan still owns the command string end
  to end; only WHERE it runs and WITH WHICH binary are the host's to decide.
  When no west workspace can be found at all, or one is found but its venv has
  no `west` in it, the button no longer opens a terminal that can only print
  "not in a west installation" — it shows a notice pointing at Bootstrap
  instead. On native Windows, when tan's own `sevenZip` check is not `pass`,
  the post-install notice also names the 7-Zip binaries (`7z` / `7za` / `7zr` /
  `7zz` / `7zzs` / `unar`) west's `.7z` extraction needs on PATH (#412).

## 0.4.0

Re-vendored the `board.yaml` schema from alp-sdk **v0.14.0**: the `peripherals`
enum gains `dac` and `i3c`, and the Configurator's peripheral picker now offers
both. The `alp-sdk-upstream` submodule pin and the derived Kconfig LSP fixtures
(`src/lsp/generated/kconfig-metadata.json`, `test/fixtures/alp-kconfig-symbols.txt`)
move with it.

The bundled `tan` CLI this build targets moves to **v0.4.1**. That is also the
first `tan` release published as a full release rather than a pre-release, so
`releases/latest` now resolves to it — until it existed, `latest` pointed at
v0.3.1, which is what made "Install tan CLI (global)" able to re-land a stale
binary. The installer is version-pinned either way now, so nothing here depends
on what `latest` means.

v0.4.1 also freezes two issue codes this extension matches by name,
`bootstrap.python-not-runnable` and `bootstrap.python-too-old`. Through v0.4.0
`tan` declared them at no status, so a rename would have broken the prerequisite
refusal path with neither repo's CI noticing; the contract gate tracked that
deliberately and moved with this pin.

First release on the **stable** Marketplace channel. Every release before this
one shipped as a pre-release, so an install that has only ever tracked stable
is arriving here from nothing.

Worth knowing before you upgrade: on macOS and Linux, build/flash/image/clean
now run through your **login shell**, so they see what your `~/.zshrc`,
`~/.bashrc` or `~/.profile` exports — the PATH a VS Code started from the dock
or an application launcher never had. That is what makes `west` resolvable from
a GUI-launched editor. It recovers what your login profile exports, so a
toolchain that only reaches your PATH when you run `activate` by hand still
needs that activation; put it in your profile if you want the IDE to find it.
Windows is unaffected — the extension host already has the login environment
there.

- **"Install tan CLI (global)" no longer traps a customer in a loop with
  `alpSdk.preferGlobalCli` on, and it now installs the version this extension
  targets rather than whatever GitHub calls `latest`.** With that setting on
  and an outdated `tan` already on PATH, the extension's only offered fix was
  the same "Install" button — which ran the bundled installer with no
  `--version`, so it fell through to GitHub's `latest` release, whatever tag
  that currently is. The installer now runs pinned to the version this build
  supports, matching the version the extension's own managed download already
  uses. The pin alone does not guarantee the loop ends, though: the bundled
  scripts default to a user-local install directory, and a `tan` previously
  installed with `--system`/`-System` sits elsewhere on PATH — so a freshly
  pinned install can still lose to the old one, and the extension host's own
  PATH is not re-read either way. The warning now also offers turning
  `alpSdk.preferGlobalCli` off, and says so in the sentence rather than
  leaving an unlabelled button — clearing the setting always ends the loop by
  handing control back to the extension's own managed copy, whatever PATH
  currently resolves to.

- **The Dependencies panel now checks your host tools with no folder open, and
  reports the host checks it could never see before.** The panel refused
  outright without a project folder, which closed a loop a customer following
  the published walkthrough could not open: the prerequisite table needed a
  folder, the folder needed the SDK, the SDK needed git, and git was installed
  from the prerequisite table — and nothing said that opening any unrelated
  folder unlocked it. Host-tool checks are facts about the machine, not the
  project, so they now run either way. The checks that genuinely read a project
  (`sdk`, `board.yaml`, the Zephyr workspace, west-in-the-workspace) stay in the
  table as "not checked" rows saying why, rather than vanishing or — worse —
  answering about whatever directory the checker happened to start in. They
  count toward nothing in the pass/warn/fail header. Separately, the panel ran
  only `tan doctor --build`, which deliberately omits a set of checks that plain
  `tan doctor` carries; five of them are taken here — Windows long paths,
  home-directory spaces, whether the Zephyr SDK publishes a build for this host,
  the bootstrap prerequisite gate, and LLDB. The first is a build that dies deep
  in CMake complaining about a file that plainly exists, on the stock Windows
  default — with no row anywhere in the IDE to explain it. Both doctor runs now
  happen, concurrently, so opening the panel costs about as long as the slower
  of the two rather than their sum; it is twice the process work per refresh.
  Rows keep tan's order, `--build`'s block first and the host block after it,
  though the table draws as one list with no separator, so the boundary is not
  visible to a reader who does not already know it. One consequence worth
  knowing: a single missing tool can now be counted twice in the header, once
  as its own row and once inside the bootstrap prerequisite gate that also
  names it.

- **Installing a dependency from the panel now says what actually makes the row
  go green.** A `winget install` from a row's button puts the tool on the
  machine's PATH, which the already-running extension host cannot see — so the
  row the customer just fixed kept reading as missing, with nothing on screen
  saying why. The notice now says to press Refresh when the install finishes,
  which is enough in the common case because winget's shim lands in a directory
  that was already on PATH when the editor started. It does NOT offer a window
  reload: reloading re-forks the extension host from a main process whose
  environment was captured at launch — VS Code skips shell-environment
  resolution on Windows entirely — so the reload cannot pick up a new PATH, and
  pressing it mid-install would take the install's own terminal with it. Where
  Refresh is not enough the notice says to close VS Code completely and reopen.

- **Installing an SDK on a machine without Git now says so, and offers the
  download.** Installing an SDK is a `git clone`, and it is the only
  implementation there is — so on a clean Windows 11 box, which ships no Git,
  the very first step of the walkthrough failed with `Alp: couldn't install SDK
  v0.13.0.` and a single Retry button that re-ran the identical missing-binary
  spawn — a spawn that does not merely fail again but never returns. Nothing on
  any surface named Git; the only mention of it was `Install failed: Error:
  spawn git ENOENT` in the panel. The toast now names Git and carries **Download
  Git**, which opens git-scm.com's download page. Retry is gone from that one
  case and kept everywhere else: only a `spawn` that never started a process is
  treated as a missing Git, so a clone that DID run and failed — no network, a
  proxy refusing `CONNECT`, a tag that does not exist — keeps the Retry that can
  actually fix it, and is never reported as a missing Git to someone who has
  Git. The errno still goes only to the "Alp SDK" output channel. Neither
  sentence claims Git is absent from the machine, only that Alp could not find
  it: what the extension actually knows is that its own process could not
  resolve `git`, and a Git installed while VS Code is running is invisible to it
  either way. That is also why the advice is to reopen VS Code rather than to
  press Install again — on Windows a new `PATH` does not reach an already-running
  editor, and not on a window reload either, because the extension host is
  forked from a main process whose environment was captured at launch.
  **Download Git** is a pointer, not a second installer: the per-host install
  lines live in the SDK's `metadata/bootstrap.json` and reach the IDE through
  tan's doctor envelope, and a copy of them here would be exactly the drift the
  Dependencies panel is built to avoid. Once a project folder is open, the
  Dependencies panel carries tan's own `git` row with its per-host install
  command; this toast is the reachable pointer for the case that comes before
  any folder exists.

- **The Zephyr SDK row in the dependency table now has a button, and it says
  what the docs page does not.** The row is the one every Zephyr-on-M customer
  hits, and on Windows it arrived as a bare `warn` with no action at all: tan
  builds the `missingPrerequisites` list inside its `push_tool` helper, and the
  `zephyrSdk` check is pushed as a plain struct literal that never goes through
  it, so the tool can never appear in that list however missing it is. The
  planner was reading "tan named no prerequisite for this check" as "there is
  nothing to offer" and returning no action. It now falls back to the fix this
  extension knows whenever tan's list is silent about a non-passing check —
  general, so any check tan forgets to route through `push_tool` is covered, not
  just this one. An entry tan DID emit still wins outright, `command: null`
  included: that is tan's answer, not an invitation to look elsewhere. The
  button is labelled **Open install guide**, not Install — pressing it opens the
  Zephyr SDK page and installs nothing, and the row stays `warn` until the
  customer acts. What is new is the tooltip, which now carries the two facts
  that page leaves out: `west sdk install -t arm-zephyr-eabi` has to run from
  the west workspace's top-level directory, and on native Windows a 7-Zip binary
  must already be on PATH before it — west hands `.7z` extraction to `patoolib`,
  which shells out to an external `7z` / `7za` / `7zr` / `7zz` / `7zzs` / `unar`
  and has no pure-Python fallback. Both sentences are the producer's own
  (alp-sdk `metadata/bootstrap.json` `manualInstallHints.windows.note`), which
  until now only `tan bootstrap`'s text output rendered — a customer driving the
  IDE never saw either. No Zephyr SDK version is printed: this repo pins tan's
  version, not sdk-ng's, and a number with no gate behind it goes stale in
  silence. Routing `zephyrSdk` through `push_tool` so tan can offer a real
  install command remains tan-cli's half; this side makes the row actionable and
  honest in the meantime.

- **`west (workspace)` no longer offers a fix that cannot fix it.** That check
  asks whether west resolves inside the workspace venv, and the fallback above
  would have pointed it at the `west` fix — a global `python -m pip install
  --user west` on Windows, which installs west somewhere the check does not look
  and leaves the row exactly as it was. It now maps to a new `west-workspace`
  fix that runs `tan bootstrap` on every host, which is both what creates the
  venv and what tan's own hint for that check already says.

- **The extension can now see whether a `.7z` extractor is on PATH.** Nothing in
  this repo looked for one before, on any platform. The probe treats only
  `ENOENT` as absence: these binaries reject an unknown switch with a non-zero
  exit — a real `7z` answers a bogus flag with exit status 7 — so the ordinary
  "any spawn failure means not installed" rule reports a fully installed
  extractor as missing.

- **F5 now runs a build before it debugs.** The generated debug profile
  carried no `preLaunchTask` at all, so on a fresh clone Debug started
  cortex-debug against a `zephyr.elf` nothing had produced. The four `alp:`
  task labels have been contributed since the task provider landed, but
  `tan debug-config` emits the key only for a `--pre-launch-task` its caller
  passes, and the extension never passed one. It now does, per target class:
  `alp: build active target` for Zephyr, `alp: build baremetal target` for
  baremetal, and `alp: build native_sim target` for native_sim. All three run
  the same plain `tan build` — it has no per-target selector and builds every
  slice `board.yaml` declares — so on a project with no native_sim slice the
  native-host profile still gets a pre-launch step that exits 0 without
  producing the `zephyr.exe` it then launches. The remote Yocto profile is
  deliberately left without one — the only task registered for it is the
  "deploy and start gdbserver" placeholder, which exits 1 by design because
  the extension cannot deploy or start a remote gdbserver, and naming it would
  put a failed-pre-launch dialog in front of every F5 including a remote setup
  the customer already had working. That label stays in the Tasks picker,
  where it spells out the manual step. The argv is asserted element for
  element, including the label VALUE: a wrong flag makes `tan` exit 2 and say
  so, but a wrong label is a string VS Code resolves to a real registered
  task, so it builds, F5 starts, and nothing anywhere reports that the profile
  named the wrong one. A `tan` older than the one this extension requires now
  says so when it refuses this flag: the "run Alp: Update CLI" hint was armed
  only by `--core`, and `--core` is absent before the first build — precisely
  when the new flag is the only young one in the argv — so the very first F5
  against an old CLI reported tan's raw complaint about an unknown argument
  and nothing about the CLI needing an update.

- **The Build Plan panel now says so when `tan` returns a payload it cannot
  read, instead of failing without a word.** Three commands feed that panel —
  `build --plan`, `build --manifest` / `--manifest-from`, and `size` — and each
  reached the view through a TypeScript `as` cast, which is a compile-time claim
  about a value that came out of another process and therefore verifies nothing.
  Rename `slices` in `tan` and the cast still compiles here; the reader gets
  `undefined`, and what the customer is left with depends only on how that
  reader spells its access. The plan and manifest views crash mid-render on it
  — `Cannot read properties of undefined (reading 'filter')` — and the panel
  goes blank; `size` is the quiet one, where a `?? []` swallows the miss and the
  footprint column simply goes missing. None of the three names `tan`, names the
  field, or writes a log line. Each of the three payloads is now checked at
  runtime against the fields this panel actually READS, and a payload that fails
  puts a sentence in the panel naming the command and every field that is
  missing or of another type. The check requires nothing beyond what is read —
  `schemaVersion`, `generatedBy`, `buildRoot`, `hw_info`, `boot_order`,
  `storage`, `schema` and `summary` are declared in the models and touched by
  nothing this panel renders, so a `tan` release that drops or adds a field the
  panel never reads still draws. A `tan size` failure was also reaching the view
  and being discarded unrendered, which read as "this build has no sizes" rather
  than "the measurement failed"; it is now shown alongside the manifest note.

- **"Alp: Install tan CLI (global)" now works on Windows.** The bundled
  `install.ps1` did not parse at all under Windows PowerShell 5.1 — which is
  exactly what the command spawns (`powershell`, not `pwsh`) — so the terminal
  showed two parse errors and no `tan` was installed. The file carries no BOM,
  so 5.1 decodes it as the ANSI codepage; on cp1252 the em dash in a `Write-Host`
  string turned into `â€”`, whose third character is one PowerShell honours as a
  string terminator, and the script ended mid-string. Measured on 5.1.26100.8894:
  two parse errors, at lines 61 and 55. The two non-ASCII characters are now
  plain `...` and `--`. Only this global-install command was affected; the
  extension's own managed `tan` download never ran the script, so a user who had
  let the extension fetch `tan` for itself already had a working binary. Three
  new gates keep the class out: the vendored `.ps1` must be ASCII-only or carry
  a BOM (runs everywhere), it must parse under real Windows PowerShell 5.1 (runs
  on Windows, and reports loudly as NOT RUN elsewhere rather than as a pass), and
  both vendored installers are now pinned by sha256 to a named tan-cli ref with
  the upstream hashes recorded alongside — so a silent re-vendor, or an
  undeclared edit hiding behind the declared one, fails the suite instead of
  reaching the Marketplace.
- **The tan envelope-contract gate now fails when it cannot verify, instead of
  skipping.** `scripts/fetch-tan-contract.mjs` exited 0 on a 404, a rate-limit,
  an outage and a dead network alike, and `test/tanContract.test.js` then
  skipped — so a pin moved to a release without `envelope-contract.json` was
  green CI with zero contract verification, and every offline local run was too.
  Which releases publish the asset is now declared in tree, as
  `RELEASES_PREDATING_CONTRACT_ASSET` in `src/alpCli/service.ts`: the closed set
  of tan tags cut before the producer landed. A pin on that list still
  skips, loudly, and makes no request. Every other pin fails on any way of not
  getting the artefact — distinct messages per cause, one exit code, because the
  outcome is the same and it is not "pass". An offline developer sets
  `TAN_CONTRACT_OFFLINE=1`, which downgrades the failure to a skip and is
  ignored when `CI` is set. Both jobs of the release workflow now run the fetch
  before their tests, as CI already did — without it, failing closed would have
  reddened the next tagged release on a corpus that is gitignored and therefore
  never present in a release checkout.
- **Two issue codes the extension matches are now watched, and the scan that
  finds them is no longer family-blind.** `bootstrap.python-not-runnable` and
  `bootstrap.python-too-old` sat in a bucket about which nothing was asserted,
  while tan's own frozen-code gate iterates only the list they are absent from —
  so a rename was invisible to both repos at once. Every code the extension
  matches is now mapped to the status tan must declare for it, including "tan
  declares this nowhere", which fails the moment tan starts to. The source scan
  that keeps that map exhaustive read only `bootstrap.*` and `presets.*`
  literals; it now recognises the two idioms this extension actually matches
  with, in any family. That widening surfaced a latent bug: the issue-code shape
  rejected a hyphenated family, so tan's `debug-config.*` codes would have
  failed the frozen-list read as malformed on the first release to publish them.
- **The envelope's seventh key, `sdk`, is readable and asserted.** tan-cli#129
  added `{root, sourceTier}` and it has been on the wire since tan v0.4.0, but
  `AlpEnvelope` had no member for it and the contract test asserted nothing
  about it. It is typed optional and `isEnvelope` does not require it — tan
  omits the key entirely from any envelope whose command resolved no SDK — most
  of the published goldens — so requiring it would turn valid envelopes into
  "no envelope at all" and silently fall back. The contract test asserts the
  shape wherever the key appears, and fails if it appears nowhere. Nothing
  surfaces it in the UI yet.

- **A SOCKS proxy is now named as unsupported instead of reported as
  unreachable, and an IPv6 host in `NO_PROXY` is honoured.** VS Code's
  `http.proxy` accepts `socks5://host:1080`, and all five SOCKS spellings
  (`socks:`, `socks4:`, `socks4a:`, `socks5:`, `socks5h:`) parse as URLs — so
  the managed `tan` download spoke an HTTP `CONNECT` at a SOCKS listener and
  reported "Couldn't reach the proxy — the connection to it failed". Right
  category, wrong sub-diagnosis, which sent the customer to fix a proxy that was
  working. `proxyForUrl` now refuses on an ALLOW-list — only `http` and `https`
  tunnel — so `ftp` and every future scheme get the same honest sentence rather
  than being rediscovered one at a time. Credentials still never reach either
  string: the customer sentence names only the scheme, and the channel detail
  carries `redactProxy`'s `host:port` — the same redaction the 407 and
  unreachable paths already use. The scheme is named without its `://`, because
  `planFailure`'s absolute-path guard reads the `s:/` of `socks://` as a drive
  letter and would demote the whole message into the output channel. Separately,
  `bypassesProxy` never matched a BARE IPv6 entry — the spelling customers
  actually write: `lastIndexOf(":")` read the trailing `1` of `::1` as a port
  number, and `URL.hostname` yields `[::1]` while a `NO_PROXY` entry is written
  `::1`. The bracketed form did match, by accident of both sides carrying the
  brackets and `]` not being a digit. Both spellings now match, bracketed
  or bare, with or without an explicit port; a bare address holding two or more
  colons is taken whole, since `::1:443` is itself a valid address and splitting
  a port out of it would be a guess — the same reason curl requires the
  brackets. That reason is now in the unparseable-proxy sentence too, which
  names `[::1]:8080` rather than leaving the customer to find which part of the
  value was wrong. This became urgent with tan-cli#176: the managed download now
  makes TWO proxied fetches — `checksums.txt` from the resolved tag FIRST, then
  the binary — and REFUSES the install if the checksum fetch fails, so a proxy
  defect that used to slow one fetch now blocks the install before a byte of the
  binary moves.
  The `host:` the tunnel hands `tls.connect`, load-bearing only for IP-literal
  targets (where the `net.isIP` guard withholds `servername`) and until now
  covered by nothing, has a test that fails when it is dropped; so does the
  claim that the checksums fetch shares the binary's proxy. The tunnel authority
  that #380 also reported as unbracketed was NOT changed: `URL.hostname` returns
  `[::1]`, so `[::1]:8443` was already what it built, and a test now pins that
  so it is not "fixed" into a real defect. (#380)

- **A `launch.json` that can launch is no longer reported as unlaunchable.**
  `tan debug-config` resolves the probe and tool values from the build's own
  `runners.yaml` — driven against tan 0.4.0 with an E1M-AEN801 build, all three
  Zephyr backends come out with nothing left to fill in: J-Link with
  `"device": "Cortex-M55"`, OpenOCD with a real `configFiles`/`serverpath`/
  `searchDir`, pyOCD with `"targetId": "cortex_m55"`. The extension then graded
  a SECOND, in-process draft instead of that file. The draft's `device` was the
  hardcoded literal `"<resolved-device>"`, so the verdict was `canLaunch: false`
  naming `device` — for every project, built or not. On the first-blink path tan
  wrote a configuration that runs as-is and the extension put a "Start Anyway /
  Show Details" gate in front of it. The placeholders had left the file and
  stayed in the verdict. The draft is now gone rather than patched: the ten
  configuration fields `createDebugProfile` used to invent — `device`,
  `interface`, `svdFile`, `openOcdConfigFiles`, `targetId`, `miMode`,
  `miDebuggerPath`, `miDebuggerServerAddress`, `setupCommands` and the dead
  `cwd` — are deleted from `DebugProfile`, along with the equally dead `name`
  and `os`. `name` was `Alp: Zephyr Debug (J-Link)` and its siblings: a
  `launch.json` key, a constant of `(targetKind, server)` like the nine above
  (`serverLabel(server)` spelled the suffix), unread anywhere in `src/`,
  `packages/` or `test/`, and already DRIFTED from the `ALP: …` merge key tan
  0.4.0 writes — the drift the orphan rescue exists to repair, which learns the
  spelling from the customer's file and from `tan debug-config --preview`
  rather than from a profile. `os` was a second name for `targetKind` —
  `"zephyr" | "baremetal" | "yocto" | "host"`, one value per target class and
  derived from nothing else.
  `executablePath` stays because the extension STATS it, which is the rule for
  what may live on a `DebugProfile` at all: a field belongs there only when the
  extension itself must READ it to grade a fact about this machine. The
  preflight report now grades host readiness only: which debugger
  extension is installed, whether the server tool is on PATH, the host platform,
  whether the build artefact exists. The configuration's own values are graded
  once, against the `launch.json` entry tan merged into (#339).

- **That verdict is taken against the `launch.json` on disk, not against tan's
  draft.** `tan debug-config` reports the configuration it composed in
  `data.configuration` and MERGES that draft into the customer's file; the two
  are not the same object. The merge preserves a value the customer hand-filled
  while the draft still carries the placeholder tan could not resolve, so
  grading the draft fails a file that launches — the bullet above, pointed the
  other way. Driven on tan 0.4.0, `--server pyocd` against a board registering
  only `jlink`/`openocd`, with `"targetId": "cortex_m55"` already in
  `.vscode/launch.json`: exit 0, `replaced: true`, envelope
  `"targetId": "<resolved-target-id>"`, file `"targetId": "cortex_m55"` — one
  placeholder from the draft, none from the file. The same holds inside an
  array, where tan's merge keeps an all-placeholder incoming `configFiles` from
  overwriting the customer's list. `gradeWrittenLaunchConfig`
  (`src/debug/service.ts`) reads the file back and finds the entry by the `name`
  tan itself reports — never by an `ALP:`/`Alp:` prefix guess, which is the
  defect the orphan rescue in that same file exists to repair.
  `packages/alp-core` stays pure: it gains no `fs`, and the fold still takes
  placeholders as data. A failed read does NOT invent a green verdict — a
  missing, unparseable or entry-less file falls back to the envelope, which is
  the previous behaviour, and `configurationGraded` carries three values to say
  which was graded (`"launchJson"` / `"cliEnvelope"` / `"none"`) rather than
  passing silently. Covered by `test/debug.gradedConfig.test.js` (#339).

  One consequence worth knowing before you meet it: what gets graded is the
  whole merged entry, not only the keys tan wrote. A key you added by hand that
  still holds a `<…>` token — say `"gdbTarget": "<host>:3333"` — now fails the
  preflight and is named. That is deliberate: the merged entry is what F5
  launches, and the adapter reads that token as a literal. The `fix` offered
  for such a key still says "Build the project first, or set …"; the build half
  cannot resolve a key of your own, but the hand-edit half names the right key.

- **The next step offered for an unresolved field now fits the target.** Where
  a placeholder survives, the fold turns it into a failing check whose `fix`
  reaches both the "not launchable yet" toast's channel and the report's
  `nextSteps`. That string was "Build the project first, or set `<key>` in
  launch.json by hand." on every target, and on two of them building is a loop
  that cannot terminate: `baremetal-mcu` has no Zephyr build, so no
  `runners.yaml` is ever written for tan to read `device` from, and
  `yocto-userspace`'s `<host>:<port>` and cross-gdb path describe a remote
  target — driven against tan 0.4.0, that target's configuration keeps both
  placeholders against a fully populated `runners.yaml`, which makes no
  difference to it. #339 is about being handed something that reads like a value and is
  not; a next step that cannot work is the same defect. The fold now branches
  on the report's `targetKind` and names what the customer must supply, keeping
  "build first" only for `zephyr-mcu`, where a build CAN resolve it — and there
  it still offers the hand-edit alongside, because that half is right often
  rather than always. A SUCCESSFUL Zephyr build whose board registers no runner
  for the chosen server leaves the placeholder standing too, and tan says so:
  driven on tan 0.4.0 against a `runners.yaml` listing only `jlink` and
  `openocd`, `--server pyocd` exits 0 with `"targetId": "<resolved-target-id>"`
  and the note "This build registers no 'pyocd' runner (runners.yaml: `["jlink",
  "openocd"]`), so its fields could not be resolved.", which
  `logUnlaunchableDetail` logs verbatim. The
  wording is therefore split, not tan's alone: tan owns the general
  placeholders-remain note, which the extension still logs verbatim; the
  extension owns the per-key next step, being the half that knows the key and
  the target class (#339).

- **The three diagnostic surfaces say which verdict they are giving.** `Alp:
  Debug preflight`, the troubleshooting panel and `Alp: Export support bundle`
  build that host-readiness report and never read the written `launch.json`, so
  their `canLaunch` answers "is this machine ready", not "does this file
  launch". It is now labelled as such: the report carries
  `configurationGraded`, `"none"` until the fold sets it, the panel prints it
  beside `canLaunch`, and the support bundle — the artefact a customer sends
  once a session has ALREADY failed — records `hostReady=` rather than
  `canLaunch=`. That bundle note is the whole reason the marker exists and it is
  a hand-built string in `src/debug.ts`, so it gets its own test
  (`test/debug.supportBundle.test.js`): it drives the real registered
  `alp.exportSupportBundle` handler and asserts on the notes the bundle carries,
  including that none of them may call a configuration-blind verdict
  `canLaunch=`. Grading the configuration on those paths would mean spawning tan
  from a diagnostic command; the marker is the honest cheap half (#339).

  On `dev` this was not, as first written, invisible behind a constant `false`.
  `native-host` drew no configuration check at all — `requiredPlaceholderFields`
  filtered on `value !== undefined` and its profile set none of them, it carried
  no `openOcdConfigFiles`, and the `svdFile` check was gated on
  `adapter === "cortex-debug"` while native-host is `lldb`. dev's own
  "buildDebugPreflightReport can pass for resolved native-host profile" asserts
  `canLaunch === true`. So a dev support bundle could already print an unlabelled
  `canLaunch=true`, for the target class that is most often a customer's first
  debug session. Harmless in practice, because tan's `native-host` configuration
  carries no `<…>` token to be blind to — but the marker is a fix, not only a
  guard against a future one.

- **An unresolved value in the written `launch.json` still blocks the launch,
  and now names the field.** The fold produces one check
  per unresolved `launch.json` key rather than a single one called `launchConfig`
  — so a build whose `runners.yaml` records no `--device` reports `canLaunch:
  false` and tells the customer to "resolve: device", a field in their own file,
  instead of "resolve: launchConfig", the name of a check that is in nothing they
  own. The placeholder itself stays in the check detail and in the log. Where a
  value genuinely cannot be filled — `baremetal-mcu` has no Zephyr build and so
  no `runners.yaml`, `yocto-userspace` needs a remote `<host>:<port>` nothing can
  derive — tan emits both the placeholder and a general note saying so, and the
  extension logs that note verbatim rather than writing a second version of it.
  The per-key next step is the extension's own, and fits the target: see the
  bullet above (#339).

- **The argv the extension hands `tan debug-config` is now pinned by a test**
  (`test/debug.configArgs.test.js`). Since #387 the extension does not write
  `launch.json` — it builds an argv, spawns tan, and reads `data.configuration`
  back. tan's merge is covered in tan; the argv was ours and nothing checked it.
  The asymmetry is what makes it worth a test: a wrong FLAG fails loudly, since
  tan exits 2 on an unknown argument and that already surfaces as the
  version-skew message, but a wrong VALUE is silent — `--core m55_hp` against
  `--core m55_he` is a valid invocation that debugs the wrong core and reports
  nothing. Construction moved into a pure `debugConfigArgs` — both invocations
  in `writeLaunchProfile` and the one in the orphan-rescue's name probe, so no
  call site spells the argv itself any more — and the assertions are on the
  array element for element rather than on the fact that a spawn happened,
  which would survive exactly the mutation this guards (#397).

- **The end-to-end suite now runs in CI** (`.github/workflows/e2e.yml`), on
  every push to `dev`/`main`, nightly, and on demand. It was not merely an
  unrequired check before — `ci.yml` never invoked it at all, which is how the
  two debug checks in #392 called a deleted function for the whole of #387's
  lifetime unnoticed. It is deliberately NOT a required pull-request check: the
  suite downloads a full VS Code build, installs two Marketplace extensions and
  needs a display server, and a required check with that surface is a flaky one
  that gets re-run or bypassed rather than fixed — leaving the repo believing in
  a gate it does not have. The rot that actually happened is already caught on
  every PR by #395's symbol guard; this covers the behavioural half, where a
  reliable daily signal beats a blocking one (#394).

- **When the extension runs the `tan` on your PATH because nothing else
  resolved, it now says so — once.** That binary is whichever one your shell
  resolves, and nothing here verified it: the `tan --version` check the
  extension makes is a format probe on the output of a binary it is about to
  run, not an integrity check. Two of the six ways a `tan` is resolved are
  verified (a fresh download, checked against the `checksums.txt` Alp Lab
  publishes, and the copy cached from one, re-checked on every resolution); the
  other four run what your machine offers, which is the same trust boundary as
  your terminal.

  What it does and does not do:

  - It **changes nothing about which binary runs**. Nothing is downloaded,
    nothing is refused, and an offline machine whose only `tan` is the global
    one keeps working exactly as before. The notice is informational, not an
    error — the setup is fine.
  - It offers **"Use the managed copy"**, which downloads the pinned `tan` into
    the extension's own storage; that copy is checksum-verified and outranks the
    PATH fallback from then on. Nothing happens unless you click it.
  - It appears **once per install**, not once per window — the state it reports
    is permanent, so repeating it would be a nag.
  - **`alpSdk.preferGlobalCli` is left completely alone.** With that setting on,
    a `tan` on PATH is your explicit instruction, so there is no notice, no log
    line and no download.
  - It does **not** offer `alpSdk.cliPath`: pointing at a hand-placed binary is
    also unverified, so it is no answer to "this one was not verified".
  - Known, and filed upstream as `alplabai/tan-cli#176`: the extension's own
    "Install tan CLI (global)" button downloads a release asset with no checksum
    check, so it creates exactly the state this notice reports.

- **A hand-filled value stranded on a duplicate `Alp:` / `ALP:` debug
  configuration is now offered a repair, instead of being lost or left
  broken.** The configuration `name` is the merge key `tan debug-config` uses.
  tan `v0.4.0` — the release `SUPPORTED_CLI_VERSION` pins — writes `ALP: …`,
  while the extension-side writer #387 removed wrote `Alp: …`. So on a
  `launch.json` that predates #387 the merge matches nothing and APPENDS, and
  the customer is left with two entries: their own `"device":
  "AE822F4M55_HP"` on one nothing maintains, and `"device":
  "<resolved-device>"` on the one F5 actually launches. Deleting the stale
  entry by hand loses the value; keeping it leaves a permanent duplicate. The
  repair runs in BOTH directions, because tan's rename back to `Alp:` strands
  the mirror image on every machine now on `v0.4.0`.

  What it does and does not do:

  - It **offers**, and applies nothing until the customer accepts. It is their
    file.
  - It **composes no configuration** — it moves values between two entries that
    already exist and deletes one. Which spelling is maintained cannot be known
    statically and is not guessed: it is read from a real
    `tan debug-config --preview` run, which by design does not touch the file,
    and only after the offer is accepted.
  - It follows tan's own `merge_value` rule, all three branches of it. A
    placeholder on the stale entry never overwrites a resolved value, and never
    travels onto a key the maintained entry does not have (re-inserting a
    removed `<resolved-svd>` makes cortex-debug fail on start). Lists merge per
    element, so a `configFiles` you added an `interface/stlink-v2-1.cfg` to
    keeps it. Keys tan never writes — a customer's own `myOwnKey` — come across
    untouched.
  - Where BOTH entries hold a value for the same key and the two differ, the
    maintained entry's value stands — it is the one F5 already used — and the
    stale entry's is discarded rather than moved. The repair **names every
    value it discards**, in the toast that follows and in the Alp output
    channel, because the file is rewritten in place with no backup.
  - It refuses a `launch.json` it cannot parse as strict JSON rather than strip
    the customer's comments to rewrite it.
  - Offered on activation (the symptom is "F5 fails", so nobody would think to
    run a command for it) and from **Alp: Configure Debug Profile**. Dismissing
    the offer does NOT silence it — only **Don't show again** does, per
    workspace — so an accidental dismissal cannot strand the value for good. A
    `launch.json` holding three entries with the same name needs a second pass,
    and gets one for the same reason; each pass merges before it deletes, so a
    partial repair loses nothing.

  `alplabai/tan-cli#169` asks tan to own this inside its own writer, which
  would also cover running `tan debug-config` from a terminal with no extension
  installed. This is the bridge until that ships.

- **`launchConfigPlaceholders` now treats ANY `<…>` token as unresolved, not
  just a `<resolved-` prefix.** The prefix test did not see `<host>:<port>`,
  which every `yocto-userspace` profile carries, so a Yocto configuration was
  reported launchable with a gdbserver address no adapter can dial. tan closed
  the same hole on its side in `v0.4.0`. This stays the repo's ONE
  unresolved-value predicate — the new repair calls it rather than re-typing
  the rule.

- **The checkable slices of doc-comment drift are now a gate
  (`test/comment-claims.guard.test.js`).** Across #389 and #386, eight doc
  comments asserted a guarantee, a caller or a label the code did not match.
  Every one was caught by a human review round and NONE by a check — a stale
  sentence is invisible to `tsc`, to Prettier and to `node --test`. Two were
  worse than inert: they were the stated justification for not writing the test
  that would have caught the real defect.

  Three slices are converted, and only those. Comments now carry a
  machine-readable annotation beside the prose, so no English is parsed and a
  sentence that merely narrates a past count (`runAlpInTerminal`'s "Two call
  sites shipped that way") carries none and is left alone:

  - `@callers <n> <symbol>` — asserted against the real call sites under
    `src/`. Five claims annotated (`resolveAlpBinary`, `checkCliVersion`,
    `requestEffectiveConfigPreview`, `writeAlpSetting`,
    `resolveOrchestratorTarget`).
  - `@quotes <path> "<text>"` — a comment quoting a string that lives in
    another file, with the PATH pinning which surface it belongs to. Three
    claims annotated.
  - `test/fixtures/comment-claims.ts` — every "the compiler refuses X /
    `TSnnnn`" claim about `downloadFile`'s `verify` argument, compiled on
    demand with the repo's own compilerOptions. The documented HOLES (`null`
    opt-out, arity-tolerant provider) are pinned as compiling too: a hole that
    quietly closes is drift as much as a guarantee that quietly opens.

  What stays UNGUARDED is stated in that file's header, at length. "Is this
  comment true?" is not gateable; a test that tried would be flaky enough that
  everyone learns to ignore it, which is worse than no gate.

- **Three comment claims corrected, two of them false.** Both
  `src/alpCli/download.ts` and `src/alpCli/vscodeAdapter.ts` said that sliding
  an `AbortSignal` into `downloadFile`'s `verify` position is a `TS2345`.
  Measured under the pinned compiler it is a **`TS2739`** — "Type
  'AbortSignal' is missing the following properties from type 'ChecksumSpec':
  assetName, checksumsUrl". `src/alpCli/adapterCore.ts` said "no other file in
  `src/` names `cachedBinaryPath`"; `vscodeAdapter.ts` names it in code six
  times (it builds the path and logs it, and never spawns from it). And
  `src/sdk/settingsWrite.ts`'s "the three callers" counted calling functions,
  not call sites, of which there are six — the unit is now explicit.
- **A migrating machine no longer falls through onto an unverified PATH `tan`
  (#396).** Treating a cached binary with no recorded digest as unverifiable
  made the `cached` arm safe, but only half-fixed the machine: the ladder
  CONTINUES past a skipped cache, and for anyone who also has a global `tan` the
  next rung is `path`. So the exact population that fix was written for — people
  who used the extension before downloads were checked — moved silently from
  `cached` onto a binary nothing verified. No prompt, no notice. A refusal must
  never offer a one-click route onto an unverified binary; a silent fall-through
  is the zero-click version of the same thing.

  Fixed where the broken state lives, in the extension's own storage, not by
  reordering the ladder. `shouldFetchManagedCli` now takes the whole
  `BinaryResolutionInput` rather than a `BinarySource`, and re-acquires an
  un-digested cache when the ladder would otherwise step over it — i.e. when the
  resolved source is the UNCHOSEN `path` fallback, or `download`. Keying that
  trigger on `source === "cached"` is precisely why it could never fire here:
  `decideBinarySource` skips such a copy, so the source is never `cached` on the
  affected machines and activation returned early every time. Replacing the
  extension's own cache overrides nobody, and precedence does the rest — once the
  digest is recorded, `cached` outranks the `path` fallback again and the
  effective source snaps back with no ordering change ever made.

  **A user running their own binary is left alone.** `cliPath`, `localBuild`, a
  platform-VSIX `bundled` install and the `alpSdk.preferGlobalCli` opt-in are
  silent and fetch nothing, because a heal there buys nothing: the hole is the
  cache being silently stepped over, and those machines are not stepping over
  it. `preferGlobalCli` belongs in that list for its own reason too — healing
  under it cannot change what runs, since resolution still answers `path`
  afterwards, so online it is a ~3 MB fetch of dead weight and offline it is an
  error toast per activation about a copy that user opted out of running. Clear
  the flag (or the setting, or the local build) and the ladder reaches the
  fallback, where the heal fires on the next activation.

  **The residual offline window is named rather than papered over.** A migrating
  machine with no network genuinely does run the PATH binary, so the failed heal
  now says which binary that is instead of only "it will not be run", and offers
  the same Retry — which keeps that same wording if it is pressed while still
  offline, rather than reverting one click later to "downloading it once more
  settles this for good".

  **A host with no published prebuilt gets its own sentence, and never a Retry
  it cannot act on.** `releaseAssetForTarget` is null there, so the heal cannot
  start and the silent return it used to take was the same zero-click
  fall-through — but the migration sentences all end in "reconnect and retry",
  which on that host is not merely unhelpful, it is false: nothing will ever be
  published to fetch. It now says so and names `alpSdk.cliPath`, in the sentence
  and as the one button. That setting is withheld from every other verification
  refusal (#389) because it is an escape onto an unverified binary while a
  verified one is a download away; here no verified binary is obtainable at all,
  so it is not an escape from verification, it is the only way to have a `tan` —
  and it is already what the download names when it throws for this same missing
  asset.

  That Retry now goes somewhere. `alp.updateCli` refused whenever
  `alpSdk.cliPath` was NON-EMPTY, rather than when it points at a file that
  exists — so on a machine whose `cliPath` no longer resolves (a moved checkout,
  synced settings) the notice's only button answered "alpSdk.cliPath is set …"
  and offered `Open Settings → alpSdk.cliPath`: two clicks from a verification
  refusal to the one arm that is never verified, which is the button #389
  removed. The guard now asks the same question `decideBinarySource` does.

  **This heal deliberately does not take the stale-version give-up latch.** That
  latch bounds a futile re-download for a mis-tagged pin; adopting it here would
  let one offline activation permanently disable the heal and strand the machine
  on the unverified binary. Offline is transient and retries on the next
  activation, which is driven end to end in the tests rather than reasoned about.

  **Two routes to a silent PATH `tan` are pre-existing and stay open** — the
  docs say so rather than implying the fall-through is closed in general. A
  fresh install on a machine with a global `tan` never fetched a managed copy,
  so there is no cache to heal; and a cache deleted or quarantined with the
  digest record left behind (antivirus, a cleaner, a partial profile restore)
  silently downgrades a machine that WAS running a verified managed binary to
  the PATH one, permanently. Both resolve `path` with an EMPTY cache — neither is
  the migration population, and closing them needs a different trigger.

  Also documented, because the four unverified arms are not equivalent and were
  being described as if they were: verification covers the MANAGED ACQUISITION
  CHANNEL (download and cache); `cliPath`/`localBuild` are binaries the user
  pointed at or built, where checking is theatre; `bundled` is covered by the
  VSIX signature; and both `path` rungs execute whatever the environment offers
  — `isNativeTanVersionOutput` is a FORMAT probe on attacker-controllable stdout,
  never an integrity check, so no wording may claim INTEGRITY for a PATH binary.
  The house compound `verified-native` is the explicit carve-out: it names that
  format probe's verdict ("the native clap CLI, not the retired `alp`"), which is
  all `commandOnPath` ever decides.

- **VS Code's `http.proxy` now reaches every child process the extension
  spawns (#379).** A corporate user who set `http.proxy` got a `tan` that
  ignored it: `spawnAlpAsync` passed no `env` at all, so the child inherited
  `process.env` verbatim and `tan sdk list` failed with a raw transport error
  pointing at nothing. `tan` takes no `--proxy` flag — it reads the environment
  (tan-cli `crates/tan-cli/src/http.rs`) — so handing the setting to the child
  is the entire mechanism, and no protocol change was needed.

  Covered: `spawnAlpAsync` (the envelope path), both `--version` probes,
  `execFileAsyncCli`, and BOTH terminal seams (`runAlpInTerminal` and the
  bundled `Install tan` script). A `ProcessExecution` task is not a login shell
  — it inherits the extension host's environment, not the user's profile — so
  `tan bootstrap`, which downloads Zephyr and pip packages, was as blind to the
  setting as the in-process seams were. The two network-bound children that are
  not `tan` are fixed with it, because they failed for the identical reason:
  `west update` (`executeWestPlan`) and the SDK-install `git clone`.

  **Precedence: an already-exported environment variable WINS over the IDE
  setting.** The setting only fills a gap; a variable the user exported in the
  shell VS Code was launched from is left exactly as it is. Beyond "do not
  silently override a deliberate machine-wide configuration", the other order is
  not implementable: the child picks its own proxy and `ALL_PROXY` outranks
  `HTTPS_PROXY` in tan's order, so "the setting always wins" would require
  overwriting the user's `ALL_PROXY` too. This is the opposite order from the
  in-process download path, deliberately — that one picks the proxy itself, so
  it can. The rule is stated on `proxyEnvOverrides`, which is pure and tested.

  Both `HTTPS_PROXY` and `HTTP_PROXY` are set, and each gap is judged against
  ALL the names its consumer reads (`ALL_PROXY`/`all_proxy` plus the upper- and
  lowercase spelling) — checking only `HTTPS_PROXY` would let ours outrank a
  user's lowercase `https_proxy` inside tan, re-introducing the override through
  the back door. An empty exported value counts as set: `export HTTPS_PROXY=` is
  how a user disables an inherited proxy. `NO_PROXY` is never written — VS Code
  has no setting for a bypass list, so the environment is its only source and it
  passes through untouched.

  `http.proxyStrictSSL: false` is **not forwardable and is not silently
  dropped**: `tan` has no environment knob or flag that relaxes certificate
  verification, and it should not need one — its rustls config already trusts
  the bundled roots MERGED WITH THE OS TRUST STORE, so a TLS-intercepting
  middlebox's CA installed in system trust is already accepted. Setting it to
  `false` now logs that once, with the remedy (install the CA in the OS trust
  store), instead of leaving the user believing a switch they flipped is in
  effect. The message promises that for **tan only**, and says so: tan's own
  module doc is explicit that the subprocesses it spawns — `git clone`, `pip`,
  `west update` — "do their own networking with their own trust stores"
  (tan-cli `crates/tan-cli/src/http.rs`). pip verifies against `certifi`'s
  bundled CA and never consults the Windows/macOS store; Git for Windows built
  against OpenSSL uses its own `ca-bundle.crt`. Promising those too is how a
  user installs the CA as instructed, watches tan start working, then hits
  `CERTIFICATE_VERIFY_FAILED` on the pip step and concludes the extension lied,
  so the message now names `PIP_CERT` / `REQUESTS_CA_BUNDLE` and
  `http.sslCAInfo` instead.

  All five child-launch seams are covered by tests that fail when `env` is
  dropped from any one of them — including both TERMINAL seams, which the
  original `alpCli.spawnProxyEnv` suite could not see at all (it stubbed
  `runInTerminal` as a no-op), and the two non-`tan` children, which no test
  loaded. That gap was not evenly distributed: `runAlpInTerminal` is the seam
  `tan bootstrap` runs on — the command that downloads Zephyr and the pip
  packages, i.e. the one that needs the proxy most.

- **The cached `tan` binary is now verified on EVERY resolution, not only when
  it was downloaded (#386).** #389 checked the bytes as they arrived and then
  never looked again. The download happens once; the cache is read on every
  activation forever, so anything that rewrote the file afterwards — corruption,
  a partial write, a half-restored backup, or anything with write access to the
  extension's global storage — was spawned unchallenged. The `cached` arm now
  hashes the file and compares it against the digest recorded when it was
  installed, and REFUSES the spawn on a mismatch. Not a warning: the next thing
  that happens to that path is an exec.

  **Two of the six resolution arms are verified, and the other four are not.**
  Do not read this as "the tan the extension runs is verified". `download` is
  checked at write time (#389) and `cached` against that record on every
  resolution; `cliPath`, `path` and `localBuild` are a binary the user pointed
  at, put on their PATH or built themselves, with no reference digest anywhere
  to check against, and `bundled` is staged into the VSIX by
  `vsce package --target`, so it rides on the extension package's own signature.
  The scope is written onto `resolveAlpBinary` itself so it cannot be misread as
  broader than it is.

  **What the record does and does not buy**, stated plainly because the tempting
  word is "tamper-proof" and that would be false: it lives in `globalState`, not
  in a sidecar beside the binary, so merely dropping a file into the cache
  directory does not also control the record it is checked against — but an
  attacker who already has write access to this user account can rewrite both,
  and nothing here stops them. What it detects is corruption, a partial or
  interrupted write, a half-restored backup, and replacement by anything that
  does not know to update the record.

  A copy cached BEFORE the digest was recorded — i.e. every existing install —
  cannot be checked against anything, so it is never accepted and recorded,
  which would launder an unverified binary into a "verified" one. It is skipped,
  and resolution continues down the ladder: normally that means re-acquiring it
  through the verified download path, but on a machine that already has a global
  `tan`, the (unverified) `path` arm is reached first and takes over instead.
  That machine's resolved source really does change, cached to path; what is
  unchanged is the path-over-download precedence itself, which predates this
  work. The re-acquiring customer gets a sentence about the one-time migration
  instead of a generic outage; the precise transport cause stays on the output
  channel.

  A stalled link no longer turns that migration into a **one-click bypass**. The
  120 s wall clock (`AbortSignal.timeout`) throws a bare `TimeoutError`, which is
  abort-shaped but is a failure, not a cancel — it used to escape the migration
  re-framing on its name alone. Nothing downstream branched on it
  (`isCancellation` requires `name === message === "Canceled"`), so on the
  per-command download route it surfaced as `spawnFailed` and the toast offered
  an "Install tan CLI" button — which puts a `tan` on PATH, one of the four
  unverified arms above. A cancel is now decided by the CALLER's own
  `AbortSignal` having fired rather than by an error name, so a timeout is
  re-framed like any other unreachable-network case and neither refusal offers
  `installTanCli` or `alpSdk.cliPath`.

  A refusal is classified by the error's TYPE, not by matching the word
  "checksum" in its sentence — otherwise editing a customer-facing string would
  silently reclassify a refusal and hand it a "Run doctor" button. The hash is
  memoized on path + size + mtime because `probeTanVersion` re-resolves on every
  state refresh (window focus, board.yaml save, bootstrap task start, terminal
  finish, an `alpSdk` settings edit), and a synchronous 2.6 ms
  hash of the 3282944-byte binary per focus event is not free; the memo's ceiling
  is stated where it lives, and it sits inside the limit the record already has.

- **The downloaded `tan` binary is now verified against the release's
  `checksums.txt` before it is ever executed (#378).** The extension fetched a
  binary from a GitHub release, renamed it into the managed cache, marked it
  executable and ran it, having verified nothing about the bytes beyond "the
  transfer finished" — a byte count and a `content-length`, both of which a
  substituted binary satisfies exactly.

  `releaseAssetForTarget` now resolves `checksumsUrl` from the SAME release tag
  as the asset (so a digest can never be looked up against a different release
  than the bytes came from), `downloadFile` fetches it through the SAME proxy
  settings as the binary (a machine that needs a proxy needs it for both, or the
  proxy support and the verification would cancel each other out), and the
  transferred bytes are hashed with `crypto.createHash("sha256")` off the same
  chunks the byte counter already sees — no new dependency, no second pass over
  the file.

  The check runs while the download is still a temp file, BEFORE the `chmod +x`
  and the rename. A rejected binary therefore never appears at
  `cachedBinaryPath` even briefly, which matters because the `cached` resolution
  source spawns whatever is sitting there without asking again; and an
  already-installed good binary is never moved aside for bytes that turn out to
  be wrong.

  Three outcomes, three distinct sentences, and all three REFUSE: a digest
  MISMATCH, a `checksums.txt` that COULD NOT BE FETCHED, and a `checksums.txt`
  with NO LINE for this asset. The last two are deliberately not softened into
  warnings — every tagged tan release publishes the file and the binary itself
  just arrived over the same connection, so failing to obtain the digest means
  the release is malformed or something is intercepting. Neither is a reason to
  execute an unverified binary, and the reasoning is written into
  `ChecksumError` so it is not quietly relaxed later.

  A refusal is also no longer reported as an outage. `ChecksumError` gets its
  own notification plan alongside `CliInUseError` and `ProxyError`; previously a
  refused binary would have surfaced as "Couldn't download the tan CLI — retry
  when you're back online", sending the customer to check their Wi-Fi for bytes
  that arrived perfectly intact and simply were not the published ones. The
  digests stay on the output channel, the sentence reaches the toast, and
  `alpSdk.cliPath` is not offered as the remedy — hand-placing a binary is the
  workaround this check exists to prevent.

  That holds on **both** surfaces, not just the provisioning one. Activation
  fires `ensureTanCliProvisioned` un-awaited and `resolveAlpBinary` has a live
  `case "download"`, so a command issued before or instead of provisioning
  downloads inline and the refusal arrives as a resolution failure instead.
  `CliUnavailableReason` gains a dedicated `checksumRefused` for it, matched
  ahead of `corrupt`: the three refusals stay three sentences there too, the
  toast no longer claims "the installed copy looks broken" (nothing was
  installed, and a good installed copy is deliberately left untouched), and it
  no longer offers **`alpSdk.cliPath`** — the one resolution source with no
  checksum path at all, i.e. a one-click route, mid-tamper, to permanently
  executing exactly the binary that had just been refused.

  `downloadFile` takes `verify` as a REQUIRED 3rd parameter, ahead of an
  optional `{ signal, proxy }` options bag, so no caller reaches the transfer
  without STATING what it wants, in one of two greppable forms. Requiring
  `verify` on the `ResolveDeps.download` seam guards only the CALLER (dropping
  it in `downloadCli` is a `TS2554`); it does not guard the provider, because
  TypeScript's function assignability accepts a 3-parameter implementation for
  a 4-parameter type, so an inline arrow in `vscodeAdapter.ts` could leave
  `verify` off its own parameter list and keep the board fully green while the
  extension executed unchecked bytes. The arrow's body,
  `downloadFile(url, dest, signal, proxySettings())`, now puts an `AbortSignal`
  where a `ChecksumSpec | null` is required: a `TS2345`, whatever the arrow's
  arity.

  The compiler cannot go further than that — an arrow may still say `null` out
  loud, and `downloadFile(url, dest, null, { signal, proxy })` compiles. So the
  wiring is pinned behaviourally as well:
  `test/alpCli.downloadSeamWiring.test.js` captures the `ResolveDeps` the
  adapter actually builds and drives its `download` against a release server
  serving a tampered body under a correct manifest. It passes today and reds on
  the `null` arrow, which typechecks clean. `null` is the explicit, greppable
  opt-out used by the
  transfer-mechanics tests, which serve bodies no release published a digest
  for; no production caller passes it. The seam itself stays a named
  `downloadSeam` in `download.ts` so a test can drive the exact function the
  adapter injects against a local release server serving a tampered body.

  The `checksums.txt` read is capped at 64 KiB. It is buffered in memory (849
  bytes for tan v0.4.0) and was bounded only by the 120 s wall clock, which a
  hostile origin — precisely this change's threat model — could spend growing
  the extension host's heap. Overrunning the cap refuses rather than truncates:
  a truncated manifest could be missing the digest line and would then read as
  "the release does not list this asset".

  GitHub build-provenance attestation (`gh attestation verify`) stays OUT of the
  runtime path: it requires the `gh` CLI installed and authenticated, which no
  customer machine can be assumed to have. It remains a maintainer/CI check.

- **Switching the active SDK now reconciles the west workspace, instead of
  reporting success beside a stale one (#364, closing the half #350 left).**
  Activation wrote `alpSdk.path` and mirrored `.alp/sdk-path`, but neither
  touches `<topdir>/.west/config` -- the pointer `west` reads directly. If it
  named an SDK that was gone, the toast said "active SDK set" while every later
  build and flash resolved a different workspace (#349). `setActiveSdk` now
  shells `tan sdk switch`, which repairs exactly that.

  This could not ship before: the reconcile is tan-cli#74, and #364 required the
  pin bump and the wiring in one change because split, the extension shells a
  binary that silently never reconciles. The pin reached `0.4.0` in #385, so
  this is the other half. v0.4.0 also carries tan-cli#88, which closed #74's
  gaps -- including the one that mattered here: the bare-version form resolved
  only against `~/.alp/sdk-cache` while this extension installs to `~/.alp/sdk`,
  so the repair could not reach the layout that reported the bug.

  Best-effort by design, like the pointer mirror: the setting write stays
  authoritative, and a tan that is absent, older or failing must not break
  activation. It must not fail SILENTLY though, so both outcomes log, and the
  failure line says what is still wrong rather than just that a command exited
  non-zero.

  The outcome is read as STATE, not as a string. tan emits
  `sdk.west-config-reconciled` / `sdk.west-config-not-reconciled`, and neither
  is in tan's frozen `contract/issue-codes.json` -- so matching them by exact
  string here would have been a new fail-open surface of exactly the kind
  tan-cli#106 froze codes to prevent: rename one upstream and this reads as
  success forever. `warnIfWestManifestDangling` re-probes the workspace
  afterwards instead, and a state probe cannot be renamed out from under us.
  Reaching that warning now means the repair ran and did not fix it, which is a
  different fact from "nobody tried".

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

- Build, Image, Flash, Clean and Renode now stream their output into the
  persistent "Alp SDK" channel instead of a terminal that dies with the
  process. Flash motivated it: its per-slice failure reasons (e.g. "backend
  zephyr_west_flash needs west on PATH") scrolled away with the terminal,
  leaving a bare "failed to launch". On POSIX the child runs under the user's
  login shell, so a venv `west` activated by `tan bootstrap` is still found.
- A second click on a command already running is refused, in both directions
  and across both run modes: the terminal path and the channel path now share
  one reservation registry, every `tan build` dispatch shares one run name, and
  every flash dispatch — whole-project, per-core, `tan` or legacy `west` —
  shares another. Previously a streamed run was terminated to start the new
  one; on Flash that meant a SIGTERM mid-write, which can leave a board
  unbootable (#146).
- Fixed the POSIX shell quoting for streamed runs. Any apostrophe in a binary,
  project or SDK path (`/Users/o'connor/proj`) broke every Build/Flash/Image/
  Clean/Renode run with `sh: -c: line 1: unexpected EOF while looking for
  matching \`''`.
- **CI now gates `SUPPORTED_CLI_VERSION` against the published tan-cli release
  assets** (`scripts/check-cli-pin.mjs`). Pinned at a version that is not
  published, the download-on-demand asset URL 404s — and because a `cached`
  binary behind the pin also re-fetches, every activation retried a download
  that could not succeed. That shipped twice from a rule which lived only in a
  comment, so it is a gate now: every per-target asset for `v<pin>` is HEADed,
  a 404 fails the build, and a network error skips rather than reddening the
  PR on someone else's outage.

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
