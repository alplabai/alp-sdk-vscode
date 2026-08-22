// SPDX-License-Identifier: Apache-2.0
//
// The whole `tan init` argv the New Project wizard sends, as one pure function.
//
// WHY IT LEFT THE PANEL. It used to be assembled inline in a private method of
// `NewProjectFlowPanel` — a ternary base plus four conditional `.push()` calls
// — and that shape put it beyond the reach of every gate in this repo:
//
//   `scripts/tan-surface/extract.mjs` reads the argv ARGUMENT at the call
//   site. An identifier is not an `ArrayLiteralExpression`, so the record came
//   back `resolution: "none"`, and `test/tan.surfaceContract.test.js` skips
//   those in all five assertions. The wizard's argv was checked against the
//   pinned CLI by nothing at all.
//
//   `test/project.initCoresArgv.test.js` compensated with regexes over the
//   panel's SOURCE TEXT (`initArgs\.push\("--cores", coresPlan\.arg\)`),
//   because the panel's constructor builds a live webview and cannot be
//   instantiated in a unit test. A regex gate checks the spelling of one
//   branch; it cannot check what the other branches produce.
//
// Both failures shipped: `init.invalid-cores` refused six of eleven SoMs
// (#528/#529) and 12 of 44 template x SoM pairs are refused under two codes
// (#530). Neither was caught by a gate — both were found by hand.
//
// A pure function with a declared input is testable against the CLI's own
// recorded surface, for EVERY branch, which is what
// `test/wizard.initArgv.test.js` now does. Nothing here spawns, reads the
// filesystem, or touches `vscode`: keep it that way, or the gate that
// enumerates it stops being cheap enough to enumerate.
//
// WHAT THIS FUNCTION IS NOT. It is not a place to decide anything tan owns.
// `preset:`, `supported_boards:` and the SoM's topology are tan's; this only
// says which flags carry the user's choices. The one judgement it makes is
// delegated in turn — `planInitCores` decides what may go in `--cores`.

import { planInitCores, type PresetCore } from "./initCores";

/** Everything the wizard knows when the user presses Create. */
export interface InitArgvInput {
  /** The chosen template's id (`tan explain`'s `projectTemplates[]`). */
  templateId: string;
  /**
   * The example's source directory when the chosen template is an EXAMPLE, and
   * `undefined` for a starter template. This single field is what switches the
   * argv between `--from-example` and `--template`, so it is named for what it
   * is rather than carried as a boolean.
   */
  sourceDir?: string;
  /** The project name, which is also its directory name under `parentDir`. */
  projectName: string;
  /** The parent directory the project is created in (`--destination`). */
  parentDir: string;
  /** The chosen SoM SKU, e.g. `E1M-AEN801`. */
  moduleId: string;
  /** The SoM's declared cores, verbatim from `tan presets`. */
  cores?: readonly PresetCore[];
  /**
   * The SDK chosen in the wizard. Omitted ⇒ no `--sdk-root`, and
   * `runAlpCommand`'s `withSdkRoot` injects the window's active SDK instead.
   */
  sdkPath?: string;
}

export interface InitArgvPlan {
  /** The complete argv, command first. `--format json` is the runner's. */
  argv: string[];
  /**
   * Every core the SoM declares as `os: zephyr`. ONE of them is the app core
   * and receives the scaffolded app; any others are absent from the generated
   * `board.yaml` entirely. Returned so the caller can SAY so — a dual-M55
   * customer handed a single-core project with no notice is the failure this
   * field exists to prevent. Empty for an example, which brings its own
   * `board.yaml` and takes no `--cores`.
   */
  zephyrCores: string[];
}

/**
 * Build the `tan init` argv for one wizard submission.
 *
 * An EXAMPLE (`sourceDir` set) is copied verbatim via `--from-example`; it
 * ships its own `board.yaml`, so `--cores` does not apply. `--som` is still
 * appended when the user picked one, which retargets the copied `board.yaml`
 * onto that SoM instead of the example's default (verified for E1M-NX9101 on
 * the pinned tan).
 *
 * A STARTER template is expanded via `--template` + `--som`, and heterogeneous
 * SoMs additionally get `--cores` — FILTERED through `planInitCores`, never
 * the SoM's declared topology verbatim (#528).
 */
export function planInitArgv(input: InitArgvInput): InitArgvPlan {
  const { templateId, sourceDir, projectName, parentDir, moduleId, sdkPath } =
    input;

  const argv = sourceDir
    ? [
        "init",
        "--from-example",
        sourceDir,
        "--name",
        projectName,
        "--destination",
        parentDir,
        "--non-interactive",
      ]
    : [
        "init",
        "--template",
        templateId,
        "--name",
        projectName,
        "--destination",
        parentDir,
        "--som",
        moduleId,
        "--non-interactive",
      ];

  let zephyrCores: string[] = [];
  if (!sourceDir) {
    const coresPlan = planInitCores(input.cores ?? []);
    // Omitted entirely when the filter produced nothing: an empty `--cores` is
    // a different refusal, not a smaller one.
    if (coresPlan.arg) {
      argv.push("--cores", coresPlan.arg);
    }
    zephyrCores = coresPlan.zephyrCores;
  }

  // Examples copy their own board.yaml verbatim; when the user picks a SoM,
  // retarget the copied board.yaml to it.
  if (sourceDir && moduleId) {
    argv.push("--som", moduleId);
  }

  // Source the scaffold from the SDK the user picked in the wizard, overriding
  // `runAlpCommand`'s active-SDK injection — so an example is copied from, and
  // validated against, the selected SDK rather than whatever SDK happens to be
  // globally active. `withSdkRoot` tests `args.includes("--sdk-root")`, which
  // is position-independent, so this tail placement still suppresses it.
  if (sdkPath) {
    argv.push("--sdk-root", sdkPath);
  }

  return { argv, zephyrCores };
}
