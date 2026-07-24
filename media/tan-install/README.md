# Vendored tan-cli install scripts

`install.sh` and `install.ps1` in this directory are vendored copies of
[alplabai/tan-cli](https://github.com/alplabai/tan-cli)'s own `install.sh` /
`install.ps1` (source of truth: tan-cli PR #10). The `alp.installTanCli`
command (`src/alpCli/vscodeAdapter.ts`) runs the bundled copy matching the
user's OS in an integrated terminal so `tan` lands on the user's PATH
globally — distinct from this extension's private, managed download (see
`src/alpCli/vscodeAdapter.ts`'s `resolveAlpBinaryForContext` resolver), which
stays local to the extension's global storage and is never put on PATH.

These are plain copies, not a build-time fetch, so they can drift from
upstream. A follow-up could vendor them at build time (e.g. a `pnpm run`
step that pulls the pinned tan-cli tag) to avoid that drift.

**Known, intentional divergence:** `install.sh`'s Linux asset is
`unknown-linux-musl` here, matching this extension's own `TARGETS` in
`src/alpCli/service.ts` (static, no glibc floor). Upstream tan-cli's
`install.sh` is still `unknown-linux-gnu` as of this writing. Do NOT
re-vendor `install.sh` wholesale from tan-cli without re-applying that
change, or the next sync silently reverts it.
