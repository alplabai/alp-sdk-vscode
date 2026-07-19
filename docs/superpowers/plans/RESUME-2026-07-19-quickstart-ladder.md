# RESUME — Alp Hub Quickstart Ladder (subagent-driven execution)

State captured 2026-07-19, **mid-Task-2, before a machine restart**. The restart kills the
running Task-2 implementer and this session; Task-2's edits are uncommitted and get orphaned.

## Where things are
- Repo: `alplabai/alp-sdk-vscode` (PUBLIC). Branch `feat/hub-visual-two-modes` off `origin/dev`,
  **pushed to origin through Task 1**.
- Local worktree (this machine): `C:/Users/caner/Documents/GitHub/alp-hub-visual` (git worktree of
  `C:/Users/caner/Documents/GitHub/alp-sdk-vscode`).
- Spec: `docs/superpowers/specs/2026-07-19-alp-hub-quickstart-ladder-design.md`
- Plan (6 tasks, full code/tests): `docs/superpowers/plans/2026-07-19-alp-hub-quickstart-ladder.md`
  — both committed & pushed.

## Progress
- Pre-plan, committed & pushed: (a) two color modes — VS Code theme default,
  `body[data-alp-theme="brand"]` = Alp brand palette + `alp.webview.toggleTheme` + Roboto Mono;
  (b) Projects-tree tidy (native `viewsWelcome` empty states + inline actions); (c) `Alp Lab` aria-label.
- **Task 1 DONE + reviewed clean — commit `1a10625`**: `src/ideHub/phase.ts`
  (`derivePhase(AlpIdeState): "no-env"|"no-project"|"invalid-board"|"ready"` + `LADDER_STEPS`),
  `test/phase.test.js` (5/5), and `WorkspaceStatus.boardYamlValid:boolean` + `boardIssueCount:number`
  added to BOTH `src/ideHub/messages.ts` and `packages/alp-webview/src/types.ts` (hand-mirrored) +
  safe defaults in `src/ideHub/vscodeAdapter.ts`.
- **Task 2 was IN FLIGHT, uncommitted → DISCARD and redo fresh.**
- Tasks 3–6: PENDING.

## First move after restart (recover clean)
```bash
cd C:/Users/caner/Documents/GitHub/alp-hub-visual   # or reclone the repo + checkout the branch
git fetch origin
git reset --hard origin/feat/hub-visual-two-modes    # clean at Task 1 (1a10625); discards dirty Task 2
git status                                            # must be clean
pnpm install                                          # if a fresh checkout
```
Rebuild the ledger `.superpowers/sdd/progress.md` (git-ignored, gone after restart) from `git log`.

## Remaining tasks (FULL detail in the plan doc — this is the index)
2. **boardYamlValid computation** — in the StateManager / `vscodeAdapter` refresh, when
   `boardYamlExists`, reuse the EXISTING board.yaml validator (the logic behind `alp.validateBoardYaml`
   / the LSP E1M diagnostics — do NOT reimplement; thin-extension rule) → `boardYamlValid =
   issues.length === 0`, `boardIssueCount = issues.length`. Fields already exist (Task 1).
3. **Quickstart WebviewViewProvider** `alp-ide.quickstart` at the TOP of the `alp-ide` container;
   fold today's SETUP + WORKSPACES trees into the ladder; keep PROJECTS / SDK / BUILD native.
4. **Ladder React UI** (`packages/alp-webview/src/features/quickstart`) — 4 steps, phase-driven, no gray-out.
5. **Full-width New Project wizard** — dev's `newProjectFlowPanel` / `NewProjectFlowView` as the
   step-② CTA target, NOT the QuickPick.
6. **Enablement + gating + retire Overview entry** — `"enablement": "alp-ide.projectsState == ready"`
   on project-scoped commands; Build tree empty until phase `ready`; remove the `alp.openOverview`
   entry point but KEEP `overviewPanel.ts` / `OverviewView.tsx` code.

## Method
`superpowers:subagent-driven-development`: fresh implementer per task (cheap model when the plan
carries full code; standard model for integration/multi-file), spec+quality review after each,
**push after each clean task**. Continuous — no check-ins between tasks.

## Locked design decisions (do NOT relitigate)
- Sidebar **A / NXP-hybrid**: Quickstart ladder webview on top + native operational trees below.
  The hub GUI is Hakan's (on dev/main) — **tweak it, never rebuild**.
- **No gray-out**: done steps collapse to ✓, current step = one CTA that demotes when satisfied,
  upcoming steps are dim labels (not disabled buttons). Rich wizards open **full-width**; the ladder
  only launches them.
- One `phase` selector = single source of truth → drives ladder + native trees + command enablement.
- Overview retired as primary surface; its code stays for later re-enable.

## Hygiene (hard rules)
- Brand "Alp", never all-caps "ALP", in UI strings (the SVG logo wordmark graphic is exempt).
  Never touch `ALP-B*` diagnostic codes or `ALP_` Kconfig symbols.
- NO Claude/AI attribution or Co-Authored-By trailers in commits/PRs.
- Thin extension: reuse `@alp-sdk/core` / existing commands; no build/plan/validation logic in `src/`.
- Gates every change: `pnpm run compile` + `pnpm test`. A green tsc/test is NOT proof it renders —
  verify the ladder in a real Extension Development Host (F5, or
  `code --extensionDevelopmentPath=<repo> <folder>`) before calling the feature done.

## Self-continue prompt (paste to resume)
> Resume the Alp Hub Quickstart ladder build on branch `feat/hub-visual-two-modes`
> (worktree `C:/Users/caner/Documents/GitHub/alp-hub-visual`, or reclone `alplabai/alp-sdk-vscode`
> and checkout the branch). FIRST: `git fetch && git reset --hard origin/feat/hub-visual-two-modes`
> to get clean at Task 1 (`1a10625`), discarding any dirty Task-2 edits; rebuild the
> `.superpowers/sdd/progress.md` ledger from `git log`. Read
> `docs/superpowers/plans/RESUME-2026-07-19-quickstart-ladder.md` (this file), then the full plan
> `docs/superpowers/plans/2026-07-19-alp-hub-quickstart-ladder.md` and the spec. Continue
> `superpowers:subagent-driven-development` from **Task 2** through Task 6 — fresh implementer +
> spec/quality review per task, push after each clean task. Task 1 is done & reviewed. Honor the
> locked design decisions and hygiene above. Verify the ladder in a real Extension Development Host
> before declaring the feature done.
