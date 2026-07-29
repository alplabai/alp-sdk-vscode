# Vendored tan-cli install scripts

`install.sh` and `install.ps1` in this directory are vendored copies of
[alplabai/tan-cli](https://github.com/alplabai/tan-cli)'s own `install.sh` /
`install.ps1`, pinned to tan-cli **`v0.4.0`**. The `alp.installTanCli` command
(`src/alpCli/vscodeAdapter.ts`) runs the bundled copy matching the user's OS in
an integrated terminal so `tan` lands on the user's PATH globally — distinct
from this extension's private, managed download (see `resolveAlpBinaryForContext`
in the same file), which stays local to the extension's global storage and is
never put on PATH.

The command invokes the script with `--version`/`-Version` pinned to
`SUPPORTED_CLI_VERSION` (`src/alpCli/service.ts`) — **not** the script's own
`latest` default. Both scripts resolve an unversioned run to GitHub's `latest`
RELEASE, which can lag the tag this extension targets (#408); passing the pin
keeps this command honest about which `tan` it installs.

## Drift is gated, not trusted

These are plain copies, not a build-time fetch, but they can no longer drift
silently: `test/alpCli.installTanCli.test.js` pins both files by sha256, and
separately records the sha256 of each file **as published upstream at the ref
above**. Any local edit, or a re-vendor that forgets to move the pin, fails that
test. The check needs no network — the upstream hashes are recorded constants,
never fetched.

To re-vendor (e.g. when tan-cli `v0.4.1` ships): copy the new upstream files in,
then bump `TAN_INSTALLER_REF` and both hashes in that test. Its header comment
carries the one-liner that recomputes them.

## Declared deviation from upstream

`install.ps1` is **deliberately not byte-identical** to upstream `v0.4.0`. The
test declares that deviation and enforces it rather than merely noting it: it
reverse-applies the declared substitutions and requires the result to hash to
the recorded upstream value, so an undeclared third edit cannot hide behind a
declared one.

Upstream `v0.4.0`'s `install.ps1` has no BOM and contains two non-ASCII
characters in `Write-Host` strings — U+2026 (`…`) and U+2014 (`—`). The command
above spawns `powershell`, which is Windows PowerShell 5.1, and 5.1 decodes a
BOM-less script as the ANSI codepage. On cp1252 the em dash's `E2 80 94` becomes
`â€”`, whose third character is U+201D — which PowerShell honours as a string
terminator. Measured on 5.1.26100.8894, the upstream file yields two parse
errors and does not run at all. The vendored copy replaces those two characters
with `...` and `--`.

ASCII rather than a BOM on purpose: ASCII decodes identically under every
codepage and under the documented `irm ... | iex` path, whereas a BOM only helps
the `-File` path — and either way, a wholesale re-vendor overwrites whatever we
did here, so the fix worth making is the one upstream is also likely to hold.
(As of 2026-07-29, tan-cli's unreleased installer rework had independently made
these same two substitutions; if the next release ships it, delete this
deviation rather than carrying it forward.)

`install.sh` has no deviations; it is byte-identical to upstream `v0.4.0`.

> An earlier revision of this file claimed a "known, intentional divergence" in
> `install.sh` — an `unknown-linux-musl` Linux asset against an upstream
> `unknown-linux-gnu`. That is no longer true: upstream adopted `musl`, and the
> two files now agree byte for byte. The claim outlived its subject because
> nothing tied it to a check, which is what the sha256 pin above is for.
