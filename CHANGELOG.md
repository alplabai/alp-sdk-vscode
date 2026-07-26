# Changelog

## Unreleased

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
