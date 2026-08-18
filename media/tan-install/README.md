# Vendored tan-cli install scripts

`install.sh` and `install.ps1` in this directory are vendored copies of
[alplabai/tan-cli](https://github.com/alplabai/tan-cli)'s own `install.sh` /
`install.ps1`, pinned to tan-cli **`v0.4.1`**. The `alp.installTanCli` command
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

`installTanCliGlobally` short-circuits before ever invoking either script when
`releaseAssetForTarget(process.platform, process.arch)` for the pinned version
is `null` (a declared gap in `HOSTS_WITHOUT_RELEASE_ASSET`) — the same
`noPrebuiltMessage` the managed download shows, instead of letting the script
run and 404 on a URL it built itself.

## Drift is gated, not trusted

These are plain copies, not a build-time fetch, but they can no longer drift
silently: `test/alpCli.installTanCli.test.js` pins both files by sha256, and
separately records the sha256 of each file **as published upstream at the ref
above**. Any local edit, or a re-vendor that forgets to move the pin, fails that
test. The check needs no network — the upstream hashes are recorded constants,
never fetched.

To re-vendor: copy the new upstream files in, then bump `TAN_INSTALLER_REF` and
both hashes in that test. Its header comment carries the one-liner that
recomputes them.

## Declared deviations from upstream `v0.4.1`

Both files are **deliberately not byte-identical** to upstream `v0.4.1`. The
test declares each deviation and enforces it rather than merely noting it: it
reverse-applies the recorded substitution and requires the result to hash to
the recorded upstream value, so an undeclared third edit cannot hide behind a
declared one.

**The two non-ASCII `install.ps1` substitutions a prior revision of this file
described are gone** — upstream `v0.4.1` already carries them (`...` and `--`,
no `…`/`—` anywhere in the file), so the vendored copy now matches upstream on
that point and there is nothing left to declare for it.

### `install.sh`: `-gnu`, not upstream `v0.4.1`'s `-musl`, plus a musl-host guard

Upstream `v0.4.1` still maps Linux to `unknown-linux-musl`, correct for the
Rust releases it ships against — the Python cutover (#444/#446/#447) has not
reached a tan-cli **tag** yet, only its unreleased
`release/python-tan-pipeline` branch. Both substitutions below are ported from
that branch's real fix verbatim, not invented here:

1. **The Linux case.** `-gnu`, not `-musl`: a PyInstaller Linux freeze is
   musl-*dynamic* (its bootloader needs `/lib/ld-musl-x86_64.so.1` present at
   run time), not the static artefact the Rust `-musl` build was, so it does
   not start on Ubuntu/Debian/Fedora at all. `-gnu` is the only usable Linux
   asset a Python `tan` release publishes.
2. **A pre-download musl-*host*** guard, in the same substitution. Swapping
   only the asset name (1) without this is a **regression**: on an actual musl
   host (Alpine and similar), the script would download the `-gnu` asset,
   verify its sha256 correctly (verification proves the bytes match what was
   published, not that they can execute on this libc), `chmod +x` it, `mv` it
   into place, print `install.sh: installed tan -> ...`, and exit 0 — the
   final `"$dest" --version 2>/dev/null || echo ...` line swallows the exec
   failure. `ldd --version | grep -qi musl` names musl on the first line where
   glibc's `ldd` names itself; `ls /lib/ld-musl-*.so.1` catches a minimal
   image with no `ldd` at all. Refuses **before** any download and points at
   `pip install ./tan-cli/python` from a checkout instead.
3. **The download-failure note**, swapping the now-irrelevant "musl assets
   predate v0.3.0" case for a "no Linux arm64 asset from v0.5.0 on" one that
   matches `HOSTS_WITHOUT_RELEASE_ASSET`.

### `install.ps1`: the Windows-arm64 mirror of the download-failure note

A bare `Invoke-WebRequest` 404 under `$ErrorActionPreference = "Stop"` says
nothing about why. Wraps it in `try`/`catch` and names the one cause this
script can actually know (no Windows arm64 asset published from `v0.5.0` on —
PyInstaller cannot cross-compile) instead of a raw PowerShell exception,
mirroring `install.sh`'s Linux-arm64 case above. Also ported verbatim from
`release/python-tan-pipeline`.

When tan-cli ships these fixes in a tagged release, re-vendor and delete
whichever of the three substitutions upstream now carries rather than
carrying them forward.
