# Environment and Toolchain Troubleshooting

Last revised: 2026-05-14

This guide covers runtime and toolchain problems across CLI and VS Code workflows.

## 1. Core Dependencies

- Node.js 20+
- Python interpreter reachable by CLI/extension
- ALP SDK root containing scripts/alp_project.py
- workspace access to board.yaml

## 2. Quick Triage Checklist

1. Confirm Python path resolution.
2. Confirm sdk-root resolution.
3. Confirm board.yaml resolution.
4. Confirm west working directory when using west commands.

## 3. Doctor Workflow

Run doctor in JSON mode:

node ./out/cli/main.js doctor --project . --sdk-root ../alp-sdk --target-kind native-host --server none --format json > doctor-report.json

Use report output to verify:

- runtime command availability
- debug backend compatibility
- project context integrity

## 4. Frequent Fixes

- set explicit --sdk-root in CI and local scripts
- configure alpSdk.pythonPath if default python3/python is not correct
- configure alpSdk.boardYamlPath when board.yaml is not at workspace root
- configure alpSdk.westCwd for non-root build layouts

## 5. Escalation Path

If problems persist:

1. export doctor/support details
2. capture CLI JSON envelopes
3. include SDK revision and exact command lines in issue reports
