// SPDX-License-Identifier: Apache-2.0
//
// The whole `tan scaffold` argv the module wizard sends, as one pure function.
//
// WHY THIS FILE EXISTS AT ALL. Until #601 there was no argv: `tan scaffold` was
// re-implemented in TypeScript (`wizard/service.ts`), and the port had drifted
// from the command it copied. tan emits a `## Wiring` section in the module
// README naming the two `CMakeLists.txt` edits without which the module is
// never compiled; the port emitted `## Notes` and stopped.
//
// MEASURED, by compiling the deleted port out of git history and diffing its
// output against the pinned tan 0.6.0 for the same template and name: the
// header and the source are byte-identical (with no board.yaml resolved), and
// the README differs in exactly TWO places — that section, and `Template:`,
// which the port spelled with the template's LABEL (`Sensor driver module`)
// where tan spells its id (`sensor-driver`). #601's body says everything
// outside `## Wiring` was byte-identical and lists `Template:` among the
// identical lines; that part of it is wrong. The conclusion is not: a
// generator that agrees with its original everywhere except where the original
// moved is a port that stopped tracking it.
//
// So the fix is not to add the missing text. It is to stop having a second
// generator: the extension collects intent, tan generates. This file is the
// intent, spelled as flags.
//
// WHY A PURE FUNCTION AND NOT A LITERAL AT THE CALL SITE. Not because a literal
// is impossible — it is not. The three passes (`--preview`; write; write
// `--force`) each have a compile-time-constant flag set, so three duplicated
// array literals at three call sites WOULD work, and
// `scripts/tan-surface/extract.mjs` would reduce each to `resolution: "partial"`
// (command and literal flags checked, the identifier values opaque). This file
// exists because ONE enumerated function is strictly stronger than three partial
// records: `test/wizard.scaffoldArgv.test.js` reduces every branch to
// `resolution: "full"` and gets the arity, stray-positional and dangling-value
// assertions a `"partial"` record does not carry — with no duplication to drift.
//
// The cost is that the single call site passes an identifier, which reduces to
// `resolution: "none"` and is skipped by every membership assertion in
// `test/tan.surfaceContract.test.js`. That is why the site is pinned by name in
// its `EXPECTED_UNRESOLVABLE` list, with a note pointing here.
// `packages/alp-core/src/project/initArgv.ts` made the same trade, though for a
// stronger reason: ITS argv varies within one call site and genuinely cannot be
// a literal.
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
 * `test/wizard.scaffoldArgv.test.js` reduces this through the extractor's own
 * `reduceLiteralArgv` against `test/golden/tan-surface/surface.json`, so every
 * token has to be a flag the pinned tan declares, carrying the arity it
 * declares, with no stray positional and no value-flag left dangling. Note what
 * that does NOT check: nothing pins the flags' ORDER. click does not care, and
 * neither does the gate — do not read the sequence below as verified.
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
