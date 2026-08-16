# Changelog

## Unreleased

- Models panel: migrate to the ADR-0028 NPU-coverage vocabulary. `tan model
  check` no longer emits the `fits | cpu-fallback | no-fit` verdict the panel
  hard-coded; it reports `npuCoverage` (`full-eligible` / `partial` /
  `cpu-only` / `undetermined`) together with `basis`
  (`static-screen` / `compiled` / `bench`), `confidence`,
  `computeOnNpuPctMax` (a MAC-weighted upper bound), `npuPlacementPctReal`
  (a real op-count placement from a compile), `uncostedCpuOpCount`, per-op
  verdicts and `notes`. The panel's "Fit" column becomes "NPU coverage", and a
  new "NPU coverage detail" section renders the basis, the correctly-united
  percentage, the certain-CPU operators, and tan's own caveats verbatim.
- The panel now states, in words, that a `basis: static-screen` result is
  eligibility rather than a guarantee — the model runs either way, an operator
  the NPU cannot take falls back to the CPU silently rather than failing — and
  that `undetermined` means absent data, not "will not run". `undetermined`
  gets its own neutral badge instead of borrowing a negative one: DEEPX DX-M1
  ships no operator table by decision and is the headline NPU of E1M-V2M101 /
  E1M-V2M102, so a red badge there would be a false negative on the flagship
  part. Only `basis: compiled` or `basis: bench` is labelled "proven".
- Requires a `tan` release that ships `tan model check`'s ADR-0028 payload. No
  tagged tan-cli release carries it yet, so `SUPPORTED_CLI_VERSION` is
  unchanged at `0.3.0` and must be bumped in the same change that first ships
  this panel to users.

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
