# Test Matrix

Last revised: 2026-05-14

This matrix maps test classes to repository coverage.

## 1. Unit Tests (Shared Core)

Covered by service and adapter-core tests under test/:

- project.service.test.js
- validation.service.test.js
- loader.service.test.js
- wizard.service.test.js
- debug.service.test.js

## 2. Golden Tests (Generation Outputs)

Covered by:

- loader.golden.test.js
- test/golden/loader-target-support.json
- test/golden/loader-plan-zephyr-conf.json

## 3. Language Server Tests

Covered by:

- lsp.service.test.js

## 4. Webview Smoke Tests

Covered by:

- configurator.panelHtml.test.js

## 5. CLI Integration Tests

Covered by:

- cli.integration.test.js

## 6. CI Execution

All tests are run through:

- npm test
