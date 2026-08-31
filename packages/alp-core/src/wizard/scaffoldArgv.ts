// SPDX-License-Identifier: Apache-2.0
//
// The whole `tan scaffold` argv the module wizard sends, as one pure function.
//
// WHY THIS FILE EXISTS AT ALL. Until #601 there was no argv: `tan scaffold` was
// re-implemented in TypeScript (`wizard/service.ts`), and the port had drifted
// from the command it copied. tan emits a `## Wiring` section in the module
// README naming the two `CMakeLists.txt` edits without which the module is
// never compiled; the port emitted `## Notes` and stopped. Everything around
// that section was byte-identical, which is what identified it as a port that
// never picked up an upstream addition rather than a deliberate divergence.
//
// So the fix is not to add the missing text. It is to stop having a second
// generator: the extension collects intent, tan generates. This file is the
// intent, spelled as flags.
//
// WHY A PURE FUNCTION AND NOT A LITERAL AT THE CALL SITE. The argv is genuinely
// conditional — `--preview` on the plan pass and not on the write pass,
// `--force` only after the customer confirmed an overwrite — so no call-site
// shape makes it an `ArrayLiteralExpression`, and `scripts/tan-surface/extract.mjs`
// reads the argv ARGUMENT at the call site. An identifier reduces to
// `resolution: "none"`, which `test/tan.surfaceContract.test.js` skips in all
// five assertions. `packages/alp-core/src/project/initArgv.ts` hit the same wall
// and took the same way out: enumerate every branch against the pinned CLI's own
// recorded surface, in `test/wizard.scaffoldArgv.test.js`.
//
// Nothing here spawns, reads the filesystem, or touches `vscode`. Keep it that
// way, or the gate that enumerates it stops being cheap enough to enumerate.

/** Everything the module wizard knows when it calls `tan scaffold`. */
export interface ScaffoldArgvInput {
  /**
   * The project root the module is written into (`--project`).
   *
   * ALWAYS passed, never left to tan's default. Measured on the pinned tan
   * 0.6.0: with no `--project` the envelope answers `project.root: "."` and
   * `destination: "."` — the spawn's cwd. An extension-host spawn that inherits
   * whatever directory VS Code was launched from would then scaffold a module
   * into that directory (#605 is the same class, for three other spawns). The
   * flag and the spawn's cwd are both set at the call site; this is the half a
   * test can see.
   */
  projectRoot: string;
  /** The chosen module template id, from `tan explain`'s `moduleTemplates[]`. */
  templateId: string;
  /**
   * The customer's module name, VERBATIM — not normalized here.
   *
   * tan normalizes it itself (measured: `My Sensor!! 2` -> `my_sensor_2`) and
   * reports both spellings back as `moduleName` and `normalizedModuleName`.
   * Normalizing on this side would be a second copy of the rule that the port's
   * README section already proved cannot be kept in step.
   */
  moduleName: string;
  /** `--preview`: report the planned files, write nothing. */
  preview: boolean;
  /**
   * `--force`: allow tan to overwrite a file whose current contents differ from
   * what it would generate.
   *
   * Measured on the pinned tan 0.6.0, and the reason this is a separate field
   * rather than always-on: `--force` REPLACES the file. An edit a customer made
   * inside a previously scaffolded `.c` is gone with no diff and no backup. So
   * it is passed only for a write the customer confirmed against the list of
   * files that would be replaced — never on the preview pass, where it would do
   * nothing but make the flag meaningless.
   */
  force: boolean;
}

/**
 * Build the `tan scaffold` argv. Command first, `--format json` is the runner's.
 *
 * The flag ORDER is fixed rather than incidental: `test/wizard.scaffoldArgv.test.js`
 * reduces this through the extractor's own `reduceLiteralArgv` against
 * `test/golden/tan-surface/surface.json`, so every token has to be a flag the
 * pinned tan declares, carrying the arity it declares.
 */
export function planScaffoldArgv(input: ScaffoldArgvInput): string[] {
  const argv = [
    "scaffold",
    "--project",
    input.projectRoot,
    "--template",
    input.templateId,
    "--name",
    input.moduleName,
  ];
  if (input.preview) argv.push("--preview");
  if (input.force) argv.push("--force");
  // Never prompt. This runs behind a QuickPick and a modal that already asked
  // everything tan could ask for; a CLI prompt on a stdin nothing is attached
  // to hangs the spawn instead of failing it.
  argv.push("--non-interactive");
  return argv;
}
