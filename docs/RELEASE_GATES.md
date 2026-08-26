# Release Gates and Checklist

Last revised: 2026-07-20

This document defines mandatory release gates for core, LSP, UI, CLI, and docs.

## 1. Mandatory Gates

A release candidate is valid only when all gates pass:

1. Build gate
   - npm ci
   - npm run compile
2. Test gate
   - npm test
3. Packaging gate
   - vsce package succeeds
4. Documentation gate
   - README documentation map is updated for new public docs
   - CLI/public behavior changes are reflected in docs
5. Compatibility gate
   - Compatibility Rules reviewed for breaking changes

> **CLI envelope contract.** The extension consumes the standalone `tan` CLI's
> JSON envelope (see [CLI.md](CLI.md)). `tan` and its envelope/exit-code contract
> are gated **in the `alplabai/tan-cli` repo**, not here — the former in-repo
> `rust_cli_contract` job (which ran `bash cli-rs/contract/run.sh` against the
> TypeScript CLI) is retired along with the `cli-rs/` tree and the TypeScript CLI.

## 2. Surface Coverage Checklist

- Core/service logic affected: corresponding service tests updated
- LSP behavior affected: lsp.service tests updated
- UI/webview behavior affected: webview smoke tests updated
- CLI-seam behavior affected: alpCli.service and alpCli.adapterCore tests updated
- Generation contracts affected: loader golden tests updated

## 3. Pre-Release Manual Checks

- Validate command palette paths still discoverable in VS Code
- Validate CLI JSON output for at least validate/generate/doctor/completion
- Verify CI artifacts contain expected outputs

## 4. Sign-Off

Release should be approved only after all checklist items pass in CI and local verification.

## 5. Semver and Release Channels

Version format: `MAJOR.MINOR.PATCH` following semantic versioning.

Extension releases are tagged and published to the VS Code Marketplace from this
repo. The build CLI is released **separately** from
[`alplabai/tan-cli`](https://github.com/alplabai/tan-cli): a `v<version>` tag
push there triggers its `release` workflow, which builds and publishes each
target as a GitHub release asset — named `tan-<triple>[.exe]` through
v0.5.0-rc4, holding a **raw** binary, no archive; named `tan-<triple>.zip`
(win32) / `tan-<triple>.tar.gz` (elsewhere) from a release built with the
archive freeze (tan-cli#349, to fix a 13-19s macOS startup regression from
re-extracting the freeze on every invocation) on, holding a onedir tree
instead — a DIFFERENT name, not the same name with different contents.
Through v0.4.x (the Rust CLI, always the raw name) there are **eight** of
them (Windows x64/arm64, macOS x64/arm64, Linux x64/arm64 gnu, Linux x64/arm64
musl). From v0.5.0 (the Python CLI, a PyInstaller freeze that cannot
cross-compile) it is **four**: Windows x64, macOS x64/arm64, and Linux x64 as
`-gnu` only — no Linux `-musl` (a PyInstaller musl freeze is musl-*dynamic*
and would not start on Ubuntu/Debian/Fedora) and no arm64 Linux or Windows
asset at all.
The extension resolves which of the two names a given release actually
published from that release's own `checksums.txt` — never from the version,
and never from the downloaded bytes, which do not exist yet at that point;
the bytes' own magic number is a separate, later decision (which extractor,
if any, unpacks them once downloaded) — and declares
the two hosts a Python release does not cover in `HOSTS_WITHOUT_RELEASE_ASSET`
(`src/alpCli/service.ts`); the tag scheme and asset names are a stable
contract (see the `tan-cli` release-asset contract).

The extension pins the `tan` version it targets (`SUPPORTED_CLI_VERSION` in
`src/alpCli/service.ts`) — bump it in lockstep when adopting a new `tan` release,
and **never ahead of a published tag**. The pin is a download target, not an
aspiration: `shouldFetchManagedCli` re-fetches for a `download` source and for a
`cached` binary behind the pin, so an unreleased pin makes every activation retry
a 404 that nothing self-corrects. A feature needing an unreleased `tan` gets its
own gate against the probed version instead (e.g. `RENESAS_BUILD_CLI_VERSION`
in `src/alpCli/somCliFloor.ts`, which warns instead of failing the configure
step). The example here used to be `RENODE_CORE_CLI_VERSION`; tan v0.6.0
removed the `renode` verb and that constant went with it (#584). CI enforces
this:
`scripts/check-cli-pin.mjs` HEADs every per-target asset for `v<pin>` and fails
on a 404 (a network error is skipped, not failed).

Before bumping `MAJOR`:
- all breaking CLI flag or JSON envelope changes must be documented in `COMPATIBILITY_RULES.md`.
- a migration note must be added to the GitHub release.

## 6. Rollback Playbook

If a published extension release is defective, publish a corrected VSIX
(bump `PATCH`, re-tag) and update the Marketplace/GitHub release notes with a
pointer to the good version.

If a published **`tan` CLI** release is defective, the rollback lives in the
[`alplabai/tan-cli`](https://github.com/alplabai/tan-cli) repo (re-release a
corrected `v<version>` and update its release notes). Because the extension pins
`SUPPORTED_CLI_VERSION`, hold or advance that pin to keep the extension on a
known-good `tan` binary, and add an incident note to `COMPATIBILITY_RULES.md`.
**Floor:** while the pin targets a Python `tan` (from `v0.5.0-rc1` on), it
cannot go below that tag — `win32/arm64` and `linux/arm64` have no asset at
any Python release and must stay declared in `HOSTS_WITHOUT_RELEASE_ASSET`
for whichever Python tag is pinned. Rolling back past `v0.5.0-rc1` to a Rust
tag does NOT 404 the Linux download either way: Rust tags publish both `-gnu`
and `-musl`, so `TARGETS`' `linux/x64` entry resolves regardless of which one
it names. The real consequence of leaving it at `-gnu` against a Rust tag is
the glibc floor `-musl` existed to avoid (see `src/alpCli/service.ts`), not a
missing asset — revert it to `-musl` in lockstep to get that back, not to
avoid a 404 that was never going to happen.

**Second floor — hardware coverage (#502):** the pin also cannot go below
`RENESAS_BUILD_CLI_VERSION` (`src/alpCli/somCliFloor.ts`, `0.6.0-rc1`). Below
it, tan's vendored planner emits `CONFIG_ALP_SDK_CHIP_NONE=y` and every Renesas
SKU New Project offers — `E1M-V2N101`, `E1M-V2N102`, `E1M-V2M101`,
`E1M-V2M102` — dies in Zephyr's configure step, so a rollback for an unrelated
defect would silently take four of nine supported modules with it.
`test/alpCli.somCliFloor.test.js` fails if the pin drops below the floor; if a
rollback genuinely requires it, drop the Renesas SKUs from `E1M_MODULES` in the
same change rather than lowering the floor to silence the gate.

This is also why the pin may legitimately name a PRE-RELEASE. "Never ahead of a
published tag" above means published, not stable: a prerelease is a published
tag with real assets, and `v0.6.0-rc1` is pinned precisely because no stable tan
can build a Renesas SoM. `install.sh`/`install.ps1` resolve their own `latest`
to the newest NON-prerelease and will not upgrade onto such a pin, which is why
every managed invocation passes `--version`/`-Version` explicitly.

**What this repo cannot gate.** No workflow here runs a real `tan build`, so
nothing local proves the pinned tan can actually build each supported SoM
family — the floor above is a version assertion, not a build. The real per-SoM
build gate needs alp-sdk + Zephyr + a toolchain and lives in tan-cli's
`release-combination.yml`.

That workflow's SCHEDULED run installs tan via `install.sh`'s own default,
which resolves the newest NON-prerelease — so it exercises whatever `latest`
means, not the version this extension pins. The two agree most of the time and
the gate then covers us by coincidence; when they diverge, as they must
whenever the pin is a prerelease, the pinned pair is tested by nothing. That is
how #502 reached a release. The capability to test a specific version is
already there (`release-combination.yml` takes a `tan_version`
`workflow_dispatch` input, and `install.sh` honours an explicit prerelease —
its `latest` redirect block runs only when no `--version` is passed); what is
missing is anything driving it at our pin on a schedule. Filed as
alplabai/tan-cli#767.

Until that lands, treat a prerelease pin as UNVERIFIED against real hardware
builds and dispatch `release-combination.yml` by hand with
`tan_version: v<pin>` when moving the pin.
