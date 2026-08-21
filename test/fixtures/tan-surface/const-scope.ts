// SPDX-License-Identifier: Apache-2.0
//
// Fixture for the extractor's SPREAD SCOPE rule. Never compiled by
// `pnpm run compile` — see `tsconfig.json` next to it — and never shipped.
//
// Each exported function below is one binding shape the old, scope-blind
// inliner got wrong. It collected every `const <name> = [ … ]` anywhere in a
// file into one flat name→array table and inlined it into ANY `...<name>`
// spread in that file, so a spread that syntactically binds to a PARAMETER,
// a `let`, a catch binding, a destructured binding or an import was reported
// as `resolution: "full"` with the unrelated array's flags in it. A confident
// wrong answer is worse than the `"none"` it should have produced: `"none"`
// puts the site on the gate's pinned unresolvable list, where a human reads
// it; a fabricated `"full"` record is checked against the CLI and passes.
//
// `runAlpCommand` is DECLARED here rather than imported so the fixture stays
// self-contained. Its argv parameter sits at index 1, exactly where the real
// `src/alpCli/vscodeAdapter.ts:2340` declaration puts it — the extractor
// derives that index from the declarations it can see and refuses to run when
// two of them disagree, so a fixture that moved the slot would fail loudly
// rather than mis-read the whole tree.
declare function runAlpCommand(context: unknown, args: string[]): void;

/** Module scope, one binding, an array literal: legitimately inlinable. */
const PLAN_FLAGS = ["--plan"];

/** The control. This spread really does resolve to `PLAN_FLAGS` above, so the
 *  record must be `resolution: "full"` with `flags: ["--plan"]`. Without it a
 *  fix that simply refused every spread would pass every other case here. */
export function inlinesTheModuleConst(context: unknown): void {
  runAlpCommand(context, ["build", ...PLAN_FLAGS]);
}

/** THE DEMONSTRATED DEFECT. `PLAN_FLAGS` here is the PARAMETER; its contents
 *  are a runtime value. The old inliner emitted `flags: ["--plan"]`,
 *  `resolution: "full"` — a record describing argv this call may never send. */
export function shadowedByParameter(
  context: unknown,
  PLAN_FLAGS: string[],
): void {
  runAlpCommand(context, ["build", ...PLAN_FLAGS]);
}

/** A `let` in an inner block. `const`-only was the old guard, but it was
 *  applied to the DECLARATION it happened to find by name, not to the binding
 *  the spread actually reaches. */
export function shadowedByLet(context: unknown, live: boolean): void {
  {
    let PLAN_FLAGS: string[] = [];
    if (live) PLAN_FLAGS = ["--execute"];
    runAlpCommand(context, ["build", ...PLAN_FLAGS]);
  }
}

/** A catch binding — a scope with exactly one name in it and no declaration
 *  LIST at all. The binding is a `VariableDeclaration` whose parent is the
 *  `CatchClause` itself, so a resolver that reached straight for
 *  `declaration.parent.flags` would be reading the flags of the wrong node.
 *
 *  Annotated `any` (the only annotation a catch clause accepts besides
 *  `unknown`) purely so the spread below stays a BARE identifier: written
 *  `...(PLAN_FLAGS as string[])` it would be refused for being a parenthesized
 *  expression rather than for its binding, and the case would prove nothing. */
export function shadowedByCatchBinding(context: unknown): void {
  try {
    runAlpCommand(context, ["doctor"]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (PLAN_FLAGS: any) {
    runAlpCommand(context, ["build", ...PLAN_FLAGS]);
  }
}

/** A destructured `const`. Still a `const`, still one binding, still NOT an
 *  array literal — the initializer belongs to the pattern, not to the name. */
export function shadowedByDestructuring(
  context: unknown,
  opts: {
    PLAN_FLAGS: string[];
  },
): void {
  const { PLAN_FLAGS } = opts;
  runAlpCommand(context, ["build", ...PLAN_FLAGS]);
}

/** A `const` array declared in ANOTHER function's body. Nothing in this
 *  function's scope chain binds the name at all, so the spread is unresolvable
 *  — but a whole-file name table happily supplies the other function's array. */
export function sealedInAnotherFunction(context: unknown): void {
  const SIBLING_FLAGS = ["--native"];
  runAlpCommand(context, ["build", ...SIBLING_FLAGS]);
}

export function reachesForTheSiblingsArray(
  context: unknown,
  SIBLING_FLAGS: string[],
): void {
  runAlpCommand(context, ["build", ...SIBLING_FLAGS]);
}

/** A LEADING spread, which is the position where the fabrication was actually
 *  demonstrated: the command itself comes out of the spread. `WHOLE_ARGV` here
 *  is the parameter, so the gap sits in slot 0, no literal can be read as the
 *  command, and the record must be `resolution: "none"` with `command: null`.
 *  This is the one degradation the gate's pinned unresolvable list catches. */
const WHOLE_ARGV = ["build", "--plan"];

export function shadowedLeadingSpread(
  context: unknown,
  WHOLE_ARGV: string[],
): void {
  runAlpCommand(context, [...WHOLE_ARGV]);
}

/** The leading-spread control: same shape, real binding, so the command and
 *  its flags ARE readable. Without it, a fix that refused every leading spread
 *  would look identical to a fix that resolved the binding correctly. */
export function inlinesTheLeadingSpread(context: unknown): void {
  runAlpCommand(context, [...WHOLE_ARGV]);
}
