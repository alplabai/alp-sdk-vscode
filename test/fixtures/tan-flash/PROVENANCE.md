# `tan flash` envelopes — provenance

Real `tan flash --format json` output from **tan 0.7.0** (tag `v0.7.0` of
`alplabai/tan-cli`, run as `python -m tan` from a 3.12 venv installed from that
tag's `python/` tree; `tan --version` printed `tan 0.7.0`). Nothing here is
hand-written: each file is the envelope tan printed, with the host paths below
rewritten and nothing else changed.

`tan flash` has no entry in the vendored envelope corpus and its issue codes
are `reserved` (consumer `none`) in `envelope-contract.json` at v0.7.0, so
these captures are the only evidence this repo has of the shape it reads.
Freezing the flash envelope is an upstream ask.

## What stood in for hardware

No silicon and no licence-gated tool was involved. Two stand-ins were on
`PATH`/`--setools-dir`, and tan ran them exactly as it would the real ones:

- **SETOOLS**: a directory holding a tiny `app-gen-toc` script that reads the
  JSON config tan hands it and writes `build/app-package-map.txt` (with
  `APP Package Start Address: 0x8057e030`) and `build/AppTocPackage.bin`, plus
  the stock `build/config/app-device-config.json`. This is the same stub shape
  tan's own `python/tests/commands/test_flash_combined_atoc.py` uses. The ATOC
  addresses and sizes in these envelopes therefore come from the stub, not from
  Alif's tool.
- **`JLinkExe`**: a shell script that lists one probe for `ShowEmuList`,
  prints `Found SW-DP with ID 0x4C013477` for the connect preflight, and for
  any script containing `loadbin` prints a download error and exits 1.

The `system-manifest.yaml` is `test/fixtures/system-manifest.aen801.yaml` with
every slice set to `status: ok`, an `output_artefact` and a 68-byte placeholder
image added per slice, the `ipc:` block removed, and the yocto `a32_cluster`
slice **removed** from every manifest except the `mixed` ones — so the
`flow-d`, `core-left-out`, `no-setools`, `manifest-only-setools`, `xspi` and
`confirm.*` captures hold only the two Zephyr slices (the real AEN801 manifest
also holds the yocto one). In `mixed` the yocto slice's `target` is set to
`/dev/sdz`. `non-aen` is a one-slice
`zephyr_west_flash` manifest with an empty `flash_args`; `xspi` is the m55_hp
slice with `flash_method: xspi_flashwriter` and `flash_partition: mtd1`.

## The commands

Each ran as `tan --sdk-root <empty sdk with scripts/alp_project.py> flash …
--format json [--setools-dir <stub>] .` from the project directory, with a
scrubbed environment (`env -i`, `PATH` = the stub directory + `/usr/bin:/bin`).

| File (`tan-flash.v0.7.0.<name>.json`) | Extra arguments | exit |
| --- | --- | --- |
| `dry-run.flow-d` | `--dry-run --setools-dir` | 0 |
| `dry-run.flow-d.core-left-out` | `--dry-run --core m55_hp --setools-dir` | 0 |
| `dry-run.flow-d.no-setools` | `--dry-run` | 1 |
| `dry-run.flow-d.manifest-only-setools` | `--dry-run` (manifest `flash_args.setools_dir` only) | 0 |
| `dry-run.mixed-yocto-flow-d` | `--dry-run --setools-dir` | 0 |
| `dry-run.zephyr-west-flash` | `--dry-run --setools-dir` | 0 |
| `dry-run.xspi-flashwriter` | `--dry-run --setools-dir` | 0 |
| `unconfirmed.flow-d` | `--setools-dir` (no `--dry-run`, no `--confirm`) | 1 |
| `unconfirmed.mixed-yocto-flow-d` | `--setools-dir` | 1 |
| `confirm.flow-d.atoc-unacknowledged` | `--confirm --setools-dir` | 1 |
| `confirm.flow-d.write-failed` | `--confirm --atoc-unqueryable --setools-dir` | 1 |
| `confirm.flow-d.setools-untrusted` | `--confirm --atoc-unqueryable` (manifest `setools_dir` only) | 1 |

A clean confirmed write cannot be captured without silicon; the tests that need
one build it from `dry-run.zephyr-west-flash` (whose `ok` entries have the
shape of a real one) and say so.

## What was rewritten

Only host-specific text, by exact substitution: the project directory became
`/home/dev/proj`, the SETOOLS stub `/home/dev/setools`, the empty SDK
`/home/dev/alp-sdk`, the stub `JLinkExe` directory `/usr/local/bin`, tan's
random `/tmp/tan-setools-<suffix>` scratch directory `/tmp/tan-setools-scratch`,
and the flash-log timestamp `20261013T000000Z`.
