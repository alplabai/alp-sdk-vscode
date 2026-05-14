# Performance Budgets and Regression Checks

Last revised: 2026-05-14

This document defines practical performance budgets and regression checks.

## 1. Budgets

Budgets are measured on a typical developer machine with warm node module cache.

- Completion suggestions: <= 100 ms for typical board.yaml context
- Validation command analysis path (excluding external process runtime): <= 100 ms
- Loader plan creation: <= 20 ms per target
- CLI command envelope serialization: <= 10 ms for normal payloads

## 2. Regression Check Strategy

- Keep service-level logic deterministic and benchmark-friendly.
- Track command path latency in test runs when adding expensive logic.
- Fail review when algorithmic complexity increases without justification.

## 3. Practical Guardrails

- Avoid repeated disk reads in hot paths when cached values are available.
- Avoid duplicate parsing of board.yaml in the same request flow.
- Keep LSP service helpers pure and side-effect free.

## 4. CI Usage

- CI enforces compile + test gates as baseline regression protection.
- Performance-sensitive changes should include focused timing notes in PR description.
