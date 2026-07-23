# Generation Outputs

Last revised: 2026-05-14

This guide explains what the generator produces, where files are written, and how to troubleshoot output mismatches.

## 1. Output Targets

The ALP generator supports these targets:

- zephyr-conf
- dts-overlay
- cmake-args
- yocto-conf

## 2. Default Output Paths

Generated files are written under build/generated:

- build/generated/alp.conf
- build/generated/alp.overlay
- build/generated/alp-cmake-args.txt
- build/generated/alp-yocto.conf

## 3. VS Code Flow

Use:

- Alp: Generate alp.conf (zephyr-conf)
- Alp: Generate alp.overlay (dts-overlay)
- Alp: Generate alp-cmake-args.txt (cmake-args)
- Alp: Generate alp-yocto.conf (yocto-conf)
- Alp: Generate all

## 4. CLI Flow

Generate one target:

tan generate --project . --sdk-root ../alp-sdk --target zephyr-conf

Generate all targets:

tan generate --project . --sdk-root ../alp-sdk --all

CI-friendly JSON envelope:

tan generate --project . --sdk-root ../alp-sdk --all --format json > generate-report.json

## 5. Determinism Expectations

- Same board.yaml + same SDK revision should produce stable output content.
- Exit code is 0 when all requested targets succeed.
- Exit code is 3 when at least one requested target fails to generate.

## 6. Quick Checks

1. Validate first: run validate before generate.
2. Confirm sdk-root points to a folder containing scripts/alp_project.py.
3. Confirm board.yaml path resolves correctly.
4. Regenerate after changing som, carrier, os, or feature flags.
