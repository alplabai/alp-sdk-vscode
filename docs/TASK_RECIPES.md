# Task Recipes (GUI and CLI)

Last revised: 2026-05-14

This guide maps common tasks to both VS Code and CLI workflows.

## 1. Validate Configuration

VS Code:

- Alp: Validate board.yaml

CLI:

tan validate --project . --sdk-root ../alp-sdk

## 2. Generate All Derived Outputs

VS Code:

- Alp: Generate all

CLI:

tan generate --project . --sdk-root ../alp-sdk --all

## 3. Preview Effective Config

VS Code:

- Alp: Preview effective config (LSP)

CLI alternative:

- Use validate + explain + diff for non-interactive analysis

## 4. Initialize a New Starter Project

VS Code:

- Alp: New project wizard

CLI:

tan init --template minimal-app --name demo-app --destination . --preview

## 5. Scaffold a Module in Existing Project

VS Code:

- Alp: Scaffold module

CLI:

tan scaffold --template sensor-driver --name sensor_mod --destination . --preview

## 6. Run Debug/Environment Checks

VS Code:

- Alp: Debug doctor

CLI:

tan doctor --project . --sdk-root ../alp-sdk --target-kind native-host --server none --format json

## 7. Setup Shell Completion

CLI:

tan completion --shell bash
tan completion --shell zsh
tan completion --shell fish

## 8. CI Integration

See CI_EXAMPLES.md for full GitHub Actions and GitLab recipes.
