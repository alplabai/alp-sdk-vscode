// SPDX-License-Identifier: Apache-2.0
//
// The Cores step's answers, and what happens to them when the catalog moves
// underneath (#534, #582).
//
// Kept out of `NewProjectFlowView.tsx` so it can be tested as data rather than
// through a render: the whole point of `reconcileCoreChoices` is a case that is
// awkward to stage in a DOM and trivial to state as a function.

/** One core's assignment, as the Cores step holds it. */
export interface CoreChoice {
  id: string;
  os: string;
  app: string;
}

/**
 * The default layout for a SoM's declared topology.
 *
 * The FIRST core that declares `zephyr` gets `./src`; every other core that
 * takes an app gets `./<core-id>`, a name that cannot collide and says what it
 * is. A `yocto` core keeps `yocto` and gets no app: its image is built from a
 * Yocto recipe, not from a directory in this project.
 *
 * `./src` IS A SUGGESTION, NOT A PREDICTION, and this comment used to claim
 * otherwise — that `./src` is "the directory `tan init` puts the template's
 * real source in". Measured on the pinned tan 0.6.0-rc1, `minimal-app`
 * scaffolds `app: .` (the project root) and its source into `./src`
 * underneath. So tan's directory and this default do NOT agree, tan's wins
 * (`applyCoreAssignments`), and the customer is told through
 * `appDirOverrides`. Nothing on screen may promise this value will survive.
 */
export function defaultCoreChoices(
  cores: { id: string; os: string }[],
): CoreChoice[] {
  let appCoreTaken = false;
  return cores.map((core) => {
    // ZEPHYR ONLY. A yocto core builds from a recipe, and a bare-metal core's
    // shape is `cmake-args`, not a Zephyr application — scaffolding one for it
    // produces a project that cannot configure (#538).
    if (core.os !== "zephyr") {
      return { id: core.id, os: core.os, app: "" };
    }
    const app = appCoreTaken ? `./${core.id}` : "./src";
    appCoreTaken = true;
    return { id: core.id, os: core.os, app };
  });
}

/**
 * The choices to hold after the module or the catalog changed.
 *
 * THE ANSWERS ARE THE CUSTOMER'S, AND ONLY A DIFFERENT SET OF CORES MAY REPLACE
 * THEM. The Cores step used to be reset from `defaultCoreChoices` on every run
 * of an effect that depended on the catalog ARRAY, and the SDK step — which
 * comes after Cores — reloads that catalog: picking any SDK posts
 * `reloadProjectTemplates`, the host answers with a fresh list, the array
 * identity changes, and every answer the customer had just given was silently
 * replaced by the defaults. The same class of defect as #582 itself, one
 * surface earlier: the customer answers, the answer is quietly overwritten, and
 * nobody says so.
 *
 * Compared by the CORE IDS, in order. Comparing the os values instead would
 * defeat the purpose — after the first edit the held os is the customer's
 * answer, not the topology's, so every reconcile would look like a change. The
 * ids are what makes a layout belong to this SoM or another one, and that is
 * exactly the reason the reset existed.
 *
 * RETURNS `previous` BY REFERENCE when nothing changed. That identity is what
 * lets React bail out of the state update; returning a fresh copy of the same
 * data would re-render on every catalog message.
 */
export function reconcileCoreChoices(
  previous: CoreChoice[],
  cores: { id: string; os: string }[],
): CoreChoice[] {
  const next = defaultCoreChoices(cores);
  const sameCores =
    previous.length === next.length &&
    previous.every((choice, index) => choice.id === next[index].id);
  return sameCores ? previous : next;
}
