// SPDX-License-Identifier: Apache-2.0
//
// Giving every core the user chose its own app (#534).
//
// `tan init --cores` splices companions in APP-LESS. From `tan init --help` at
// the pinned 0.6.0: a companion "can only be spliced in app-less, as
// `:off` or (on a Cortex-A id) `:yocto`". So no `--template` + `--cores`
// combination can produce a second Zephyr core with its own `app:`, and a
// dual-M55 SoM — the Alif Ensemble line's defining topology — came out as a
// single-core project with the other M55 missing from the file entirely.
//
// THIS IS THE SECOND PASS, and the split is deliberate. tan writes what it
// knows: the SoM's topology, `preset:`, `supported_boards:`, the app core's
// `app: ./src` with the template's real source in it, any `ipc:`. Only then is
// the part tan CANNOT express added on top.
//
// The first design composed the whole document instead and handed it to
// `tan init --board-yaml <file>`, which does render a file verbatim (measured,
// exit 0, the topology came back unchanged). It was dropped for a reason worth
// keeping written down: composing means re-deriving `preset:` and
// `supported_boards:` in this extension, and those are the SDK's knowledge.
// Reading tan's own output and adding to it needs no such re-derivation.
//
// INTERIM — DELETE `companionCmakeLists` / `companionMainC` / `companionPrjConf`
// WHEN `alplabai/tan-cli#864` LANDS (tracked here as #536). Generating another
// program's build files in TypeScript is re-deriving knowledge tan owns: the
// `CMakeLists.txt` below was copied from tan's own scaffold output, and tan
// already writes the app core's with the core baked in, while the SDK ships
// `multicore/mproc-mailbox` with the same file parametrised for a second core.
//
// Read the risk before touching this file: NO GATE IN THIS REPO CAN CATCH IT
// DRIFTING. Nothing here builds a generated project — that needs a toolchain,
// and past native_sim, silicon. If `alp_project.py`'s invocation, the
// `EXTRA_CONF_FILE` mechanism or a move to sysbuild changes upstream, this
// keeps emitting projects that no longer build and every test stays green.
//
// `applyCoreAssignments` is NOT interim: writing `cores.<id>.app` into
// board.yaml is the same edit the Configurator already makes, and stays here.
//
// A NOTE ON `ipc:`: nothing here emits one. IPC is genuinely opt-in — the SDK's
// own board.yaml template ships the `ipc:` stanza commented out, and
// `resolve_carve_outs()` returns `[]` for an empty list — and an always-on
// default is blocked or half-proven on every current SKU family (all AEN
// entries resolve `status: blocked` by design, `E1M-NX9101` has
// `mailbox.controller: TBD`, V2N/V2M's mailbox is `driver_status: partial`).
// The carve-out size the SDK itself would suggest is disputed in its own tree
// (alp-sdk#1613: the template says 512, the catalog says 256, and 512 is
// exactly the whole of `ocram_low` on V2N/V2M).

import type { BoardConfig, CoreEntry, CoreOs } from "../board/models";

/** One core as the wizard's Cores step decided it. */
export interface CoreAssignment {
  id: string;
  /** The runtime chosen for this core (`osChoices` from `tan presets`, or `off`). */
  os: string;
  /** Where this core's application lives, relative to the project root. */
  app?: string;
  /**
   * The bitbake recipe packaging `app:`, for an app-only `os: yocto` slice
   * (#624). Only ever meaningful alongside `app` on a yocto core.
   *
   * The pair is INDIVISIBLE. `board.schema.json:606` requires it, and the SDK
   * enforces it by refusing to build: `_slice_command`'s yocto branch returns
   * `None` for an `app:` with no `recipe:`, which carries the slice as
   * `skipped` / `no-command` — silently unbuildable, exactly the shape #623
   * found for bare-metal. `takesApp` is what keeps them together here.
   */
  recipe?: string;
}

/**
 * The os vocabulary `board.schema.json` knows, and the only values this module
 * will write.
 *
 * NARROWED, NEVER CAST. The wizard's os string comes from a picker fed by
 * `tan presets`, and `assignment.os as CoreOs` used to write it verbatim — so a
 * value the schema does not know landed in `board.yaml` and died much later at
 * `validate.py`'s enum check, with nothing naming the wizard as its source.
 * That is the cast #517 removed from the models panel, in a new place.
 *
 * Pinned as a literal on purpose: a value added upstream fails this module's
 * tests rather than silently dropping a core in front of a customer.
 */
const CORE_OS_VALUES = ["zephyr", "yocto", "baremetal", "off"] as const;

function narrowCoreOs(os: string): CoreOs | null {
  return (CORE_OS_VALUES as readonly string[]).includes(os)
    ? (os as CoreOs)
    : null;
}

/**
 * The assignments whose os this module refuses to write.
 *
 * Dropping a core with no word is how a project quietly comes out missing the
 * core the customer configured, so the caller gets the list and says so.
 */
export function unknownCoreOs(
  assignments: readonly CoreAssignment[],
): { id: string; os: string }[] {
  return assignments
    .filter((assignment) => narrowCoreOs(assignment.os) === null)
    .map((assignment) => ({ id: assignment.id, os: assignment.os }));
}

/**
 * Runtimes this wizard scaffolds an application directory for. ZEPHYR ONLY, and
 * the two exclusions are for different reasons.
 *
 * `yocto` builds its image from a recipe, not from a directory in this project.
 *
 * `baremetal` is the one that used to be wrong. The runtime picker offers
 * Bare-metal for every Cortex-M core, and writing `app:` for it produced a
 * ZEPHYR application in that directory — which cannot configure:
 * `alp_project.py`'s `_EMIT_OS_CLASSES` maps `"zephyr-conf": ("zephyr",)`, and
 * an explicit `--core` whose os is not in that tuple prints to stderr and
 * returns 1, which the generated `CMakeLists.txt` turns into a `FATAL_ERROR`.
 * The SDK's baremetal shape is `cmake-args`, a different thing entirely. So
 * this wizard does not claim to scaffold a bare-metal core rather than claiming
 * it badly; the core is still declared, just without an app.
 */
function takesApp(assignment: CoreAssignment): boolean {
  if (assignment.os === "zephyr") return true;
  // The APP-ONLY yocto slice (#624): a project-relative source directory plus
  // the bitbake recipe that packages it. BOTH or neither — see
  // `CoreAssignment.recipe`. A half-filled answer is not a weaker version of
  // this mode, it is the unbuildable one, so it falls through to the stock
  // image rather than being written.
  return (
    assignment.os === "yocto" &&
    Boolean(assignment.app?.trim()) &&
    Boolean(assignment.recipe?.trim())
  );
}

/**
 * A yocto core the customer half-answered: a source directory with no recipe,
 * or a recipe with no directory (#624).
 *
 * Neither half is written — `takesApp` refuses the pair — so the core falls
 * back to the SoM's stock image, which is a working project and not what they
 * asked for. Reported rather than silently corrected: the customer typed
 * something, and a wizard that drops it without a word is how the #623 class
 * happens.
 */
export function incompleteYoctoAppSlices(
  assignments: readonly CoreAssignment[],
): string[] {
  return assignments
    .filter((assignment) => {
      if (assignment.os !== "yocto") return false;
      const hasApp = Boolean(assignment.app?.trim());
      const hasRecipe = Boolean(assignment.recipe?.trim());
      return hasApp !== hasRecipe;
    })
    .map((assignment) => assignment.id);
}

/** What the customer is told when they half-answered one. */
export function incompleteYoctoAppNotice(coreIds: readonly string[]): string {
  const plural = coreIds.length > 1;
  return (
    `${coreIds.join(", ")} ${plural ? "need" : "needs"} BOTH an application ` +
    `directory and the bitbake recipe that packages it — one without the ` +
    `other cannot be built, so ${plural ? "they were" : "it was"} left on the ` +
    `SoM's stock image.`
  );
}

/**
 * Bare-metal cores the wizard is about to write with no `app:` — the shape the
 * SDK cannot build (#623).
 *
 * MEASURED, against the pinned tan 0.6.0 / SDK v0.16.0-rc1, because the issue
 * that opened this asked for a measurement before any fix:
 *
 *   `tan validate` passes the shape silently: ok true, exit 0, zero issues.
 *
 *   The SDK's own planner does NOT. `scripts/alp_orchestrate/orchestrator.py`
 *   `_slice_command` reads, verbatim:
 *
 *       if slice_.os == "baremetal":
 *           if not slice_.app:
 *               return None
 *
 *   and its docstring says what that means: "Returns None when there is no
 *   buildable command yet -- the caller carries the slice as `skipped` /
 *   `no-command`, never dropped." `buildplan.py` handles that case explicitly
 *   too, suppressing the slice's config artefact when the command is None.
 *
 *   There is NO baremetal stock default. `heterogeneous-builds.md` names two —
 *   `alp-stock-shim` on a Zephyr core, `alp-image-edge` on a Linux core — and
 *   neither is baremetal; the code has no third.
 *
 * So a Bare-metal answer produces a core the build silently skips, and the one
 * gate a customer hits first says nothing. This is NOT scaffolded away here on
 * purpose: this file is INTERIM (see its header) precisely because generating
 * another program's build files in TypeScript is knowledge tan owns and no gate
 * in this repo can catch drifting. Adding a third generated file set would
 * deepen exactly the debt the header says to remove.
 *
 * What is fixable here is the silence. The caller names these cores to the
 * customer at the moment the project is created.
 */
export function baremetalCoresWithoutApp(
  assignments: readonly CoreAssignment[],
): string[] {
  return assignments
    .filter(
      (assignment) => assignment.os === "baremetal" && !assignment.app?.trim(),
    )
    .map((assignment) => assignment.id);
}

/**
 * What the customer is told. Names the cores and the ONE thing that makes them
 * buildable — a directory with a `CMakeLists.txt`, which is what
 * `board.schema.json` requires for `os: baremetal` and what the planner looks
 * for. Does not promise a stock default, because there is none.
 */
export function baremetalNoAppNotice(coreIds: readonly string[]): string {
  const plural = coreIds.length > 1;
  return (
    `${coreIds.join(", ")} ${plural ? "are" : "is"} declared bare-metal with ` +
    `no application directory, so the build skips ${plural ? "them" : "it"}. ` +
    `Add a directory containing a CMakeLists.txt and point ` +
    `cores.${coreIds[0]}.app at it.`
  );
}

/**
 * Where a core's application may live: inside the project, and nowhere else.
 *
 * The wizard's field is free text and the host resolves it against the project
 * directory, so `../../..` walks out and an absolute path ignores the project
 * entirely — and three files get written wherever it lands. Checked here, in
 * the pure layer, so both the webview's own validation and the host's final
 * guard ask the same question.
 *
 * A Windows absolute path is rejected explicitly: on a POSIX host
 * `path.isAbsolute("C:\\x")` is false and the string would sail through as a
 * relative directory with backslashes in its name.
 */
export function isSafeAppDir(app: string): boolean {
  const trimmed = app.trim();
  if (trimmed === "") return false;
  if (trimmed.startsWith("/") || trimmed.startsWith("\\")) return false;
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return false;
  const normalised = normaliseAppDir(trimmed);
  return normalised !== ".." && !normalised.startsWith("../");
}

/**
 * One spelling per directory, so two cores cannot claim the same tree under
 * different names — `./src`, `src` and `./a/../src` are one place, and `tan
 * build` would build that source twice under two slice configs.
 *
 * Deliberately string arithmetic rather than `path.posix.normalize`: this
 * module is pure and must not import node's `path` (the webview mirrors this
 * logic and has no node).
 */
export function normaliseAppDir(app: string): string {
  const parts = app.trim().replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else out.push("..");
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

/**
 * The cores whose requested app directory was NOT used, because tan had already
 * chosen one.
 *
 * Keeping tan's directory is the safety rule (`applyCoreAssignments`), but
 * keeping it SILENTLY is how a customer renames a directory, is ignored, and
 * finds a scaffolded decoy at the name they picked. Whoever enforces the rule
 * owes them the sentence.
 */
export function appDirOverrides(
  board: BoardConfig,
  assignments: readonly CoreAssignment[],
): { id: string; requested: string; kept: string }[] {
  const overrides: { id: string; requested: string; kept: string }[] = [];
  for (const assignment of assignments) {
    const existing = board.cores?.[assignment.id]?.app;
    if (!existing || !assignment.app || !takesApp(assignment)) continue;
    if (normaliseAppDir(existing) === normaliseAppDir(assignment.app)) continue;
    overrides.push({
      id: assignment.id,
      requested: assignment.app,
      kept: existing,
    });
  }
  return overrides;
}

/**
 * The cores tan had already given an application directory, which the customer
 * then took the application away from.
 *
 * tan puts the template's REAL SOURCE in the app core's directory — `app: .`
 * for `minimal-app`, measured on the pinned 0.6.0. Answering that core
 * `off`, `yocto` or `baremetal` is a legitimate thing to want, and this pass
 * honours it: the core stops being a Zephyr application and `app:` is dropped.
 * What is left behind is a directory full of code that nothing builds.
 *
 * Reported rather than prevented, and rather than deleted. The customer may
 * well mean it — a second Zephyr core can be pointed at that same directory —
 * and deleting a freshly scaffolded source tree on their behalf is not a
 * repair. But finding it by accident, weeks later, is the silent-divergence
 * failure this whole area keeps producing.
 *
 * WHICH core tan gave the app to is read off tan's own board.yaml rather than
 * guessed: `tan presets` does not report the app core (`soms[].cores[]` is
 * `{id, os}`), so the generated file is the only place the answer exists.
 */
export function orphanedAppDirs(
  board: BoardConfig,
  assignments: readonly CoreAssignment[],
): { id: string; app: string; os: string }[] {
  const orphans: { id: string; app: string; os: string }[] = [];
  for (const assignment of assignments) {
    // An os `applyCoreAssignments` will not write cannot orphan anything: it
    // DROPS the assignment (`narrowCoreOs` is null, the loop continues) and
    // leaves tan's entry untouched, so the core is still running its
    // application. Asking `takesApp` alone answered false for any unknown
    // string and told the customer to delete a directory their core builds —
    // while `unknownCoreOs` reported the opposite for the same input.
    if (narrowCoreOs(assignment.os) === null) continue;
    const app = board.cores?.[assignment.id]?.app;
    if (!app || takesApp(assignment)) continue;
    orphans.push({ id: assignment.id, app, os: assignment.os });
  }
  return orphans;
}

/**
 * Add the chosen cores' runtime and app directory to the board tan generated.
 *
 * IMMUTABLE: returns a new document and never touches the input. That is not
 * only house style here — the caller keeps the ORIGINAL text to feed
 * `serializeBoardConfig(next, originalText)`, so a mutated input would be
 * serialised against a document that no longer matches it.
 *
 * Everything tan already wrote is carried through untouched: this pass adds, it
 * never re-derives.
 */
export function applyCoreAssignments(
  board: BoardConfig,
  assignments: readonly CoreAssignment[],
): BoardConfig {
  if (assignments.length === 0) return board;
  const cores: Record<string, CoreEntry> = { ...(board.cores ?? {}) };
  // The cores THIS call disables, so the `ipc:` prune below can be limited to
  // them. See the prune for why the final state is the wrong key.
  const switchedOff = new Set<string>();
  for (const assignment of assignments) {
    const os = narrowCoreOs(assignment.os);
    // Dropped rather than coerced — see `CORE_OS_VALUES`. `unknownCoreOs` is
    // what the caller reports it with.
    if (os === null) continue;
    const existing = cores[assignment.id] ?? {};
    const next: CoreEntry = { ...existing, os };
    if (!takesApp(assignment)) {
      delete next.app;
      // `recipe:` is meaningless without an `app:` and `image:` wins over both
      // (`board.schema.json:602`), so a leftover recipe on a stock-image core
      // is a key the SDK ignores and a reader misreads.
      delete next.recipe;
    } else if (existing.app) {
      // TAN'S APP DIRECTORY WINS, and this is a safety rule rather than a
      // preference. tan picks the plan's app core itself — the extension cannot
      // know which one it is, `tan presets` does not report it (#528/#529) — and
      // it puts the template's REAL SOURCE in whatever directory it names.
      // Overwriting that with the wizard's guess would point the core at a new
      // empty directory and orphan the code the customer just asked for.
      next.app = existing.app;
    } else if (assignment.app) {
      next.app = assignment.app;
    }
    // Written WITH the app, never after it: `takesApp` already refused the
    // half-filled pair, so reaching here on a yocto core means both are
    // present. `image:` is dropped in the same breath — it takes priority over
    // `app:`/`recipe:` (`board.schema.json:602`), so leaving one behind would
    // make the slice build the stock image while the board.yaml reads as
    // though it builds the customer's source.
    if (assignment.os === "yocto" && takesApp(assignment)) {
      next.recipe = assignment.recipe;
      delete next.image;
    }
    if (os === "off" && cores[assignment.id]?.os !== "off") {
      switchedOff.add(assignment.id);
    }
    cores[assignment.id] = next;
  }

  // An `ipc:` entry whose endpoint was just turned off is not stale, it is
  // FATAL. Measured on the pinned tan 0.6.0, on a project it had just
  // created and validated clean:
  //
  //   validate.schema-violation | consistency: ipc entry 'alp_default_rpmsg'
  //   references core 'm55_hp' which is os: off
  //
  // exit 2. tan writes that stanza itself whenever `--cores` names a Cortex-A
  // companion, and the reachable path is ordinary: keep the companion (`yocto`,
  // so the channel is written) and answer the app core `off`. Dropping the core
  // without dropping its channels turns a green project into one that cannot
  // build — a different failure, not a smaller one.
  //
  // KEYED ON WHAT THIS CALL DISABLED, never on the final state. A board that
  // ARRIVED with a disabled endpoint is broken by something this call did not
  // do, and quietly deleting the entry would remove the only record of it —
  // while the customer's way out may well be turning that core back ON.
  // `tan validate` names the entry; this function must not make it vanish
  // first. Today there is exactly one production caller (the New Project
  // wizard's second pass) and tan never hands it a board in that state, so the
  // two keyings agree in practice; the contract is written for the next caller.
  //
  // Only entries that REFERENCE a just-disabled core go. A channel between
  // cores that stay enabled is untouched, and a board with no `ipc:` key never
  // gains one.
  if (switchedOff.size === 0 || board.ipc === undefined) {
    return { ...board, cores };
  }
  return {
    ...board,
    cores,
    ipc: board.ipc.filter(
      (entry) => !(entry.endpoints ?? []).some((id) => switchedOff.has(id)),
    ),
  };
}

/** CMake project names are C identifiers; the wizard's project name is
 *  validated as `[a-zA-Z0-9][a-zA-Z0-9_-]*`, so hyphens reach us. */
function cmakeIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * The companion core's own CMake application.
 *
 * A Zephyr application is ONE CMAKE PROJECT PER CORE. The root `CMakeLists.txt`
 * tan generates is hardcoded to the app core — `--emit zephyr-conf --core
 * m55_hp`, `target_sources(app PRIVATE src/main.c)` — so a second core needs
 * its own, pointing UP at the single shared `board.yaml`. That is exactly the
 * shape the SDK's `multicore/mproc-mailbox` example uses for its `peer/`.
 *
 * ALP_SDK_ROOT is REQUIRED rather than guessed. The SDK example falls back to
 * `../../../..`, which resolves only because that example lives inside the SDK
 * tree; a generated project does not, so the same fallback would silently point
 * at an unrelated directory and fail later and less legibly. The root
 * CMakeLists tan writes uses the explicit form, and this matches it.
 */
export function companionCmakeLists(options: {
  coreId: string;
  projectName: string;
}): string {
  const { coreId, projectName } = options;
  const project = `${cmakeIdentifier(projectName)}_${cmakeIdentifier(coreId)}`;
  return `# SPDX-License-Identifier: Apache-2.0
#
# ${coreId} slice of this project. \`../board.yaml\` declares this directory as
# the \`${coreId}\` core's \`app:\`, so \`tan build\` builds it alongside the app
# core's own image rather than the topology-default shim.

cmake_minimum_required(VERSION 3.20)

# Resolve the alp-sdk root. This project lives OUTSIDE the SDK tree, so there is
# nothing to guess: ALP_SDK_ROOT must name your alp-sdk checkout, set in the
# environment or passed as \`-DALP_SDK_ROOT=/path/to/alp-sdk\`.
if(NOT DEFINED ALP_SDK_ROOT AND NOT DEFINED ENV{ALP_SDK_ROOT})
    message(FATAL_ERROR
        "ALP_SDK_ROOT is not set -- point it at your alp-sdk checkout, "
        "e.g. \`export ALP_SDK_ROOT=/path/to/alp-sdk\` or \`-DALP_SDK_ROOT=/path/to/alp-sdk\`.")
endif()
if(NOT DEFINED ALP_SDK_ROOT)
    set(ALP_SDK_ROOT $ENV{ALP_SDK_ROOT})
endif()

find_package(Python3 REQUIRED COMPONENTS Interpreter)

set(_alp_generated \${CMAKE_BINARY_DIR}/generated/alp.conf)
execute_process(
    COMMAND \${Python3_EXECUTABLE} \${ALP_SDK_ROOT}/scripts/alp_project.py
            --input \${CMAKE_CURRENT_SOURCE_DIR}/../board.yaml
            --emit zephyr-conf --core ${coreId}
            --output \${_alp_generated}
    RESULT_VARIABLE _alp_rv
    OUTPUT_VARIABLE _alp_stdout
    ERROR_VARIABLE  _alp_stderr
)
if(NOT _alp_rv EQUAL 0)
    message(FATAL_ERROR
        "alp_project.py failed (rv=\${_alp_rv}); "
        "check \${CMAKE_CURRENT_SOURCE_DIR}/../board.yaml.\\n"
        "stderr: \${_alp_stderr}")
endif()

# Layer generated CONFIG_* over prj.conf via EXTRA_CONF_FILE.
list(APPEND EXTRA_CONF_FILE \${_alp_generated})

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(${project} LANGUAGES C)

target_sources(app PRIVATE main.c)
`;
}

/**
 * The companion core's starting source.
 *
 * A compiling starting point, not a demo: whoever opens this project is going
 * to write embedded firmware in it. It boots, says which core it is so two
 * images can be told apart on one console, and stops.
 *
 * Deliberately includes NO IPC header. The wizard emits no active `ipc:` entry
 * (see this module's header), so `<alp/system_ipc.h>`'s macros would resolve to
 * safe-zero stubs — a skeleton that referenced them would teach the customer
 * that those zeroes are real addresses.
 */
export function companionMainC(options: { coreId: string }): string {
  const { coreId } = options;
  return `/*
 * SPDX-License-Identifier: Apache-2.0
 *
 * ${coreId} slice.
 *
 * A starting point, not an example: this core builds and boots, prints one
 * line naming itself so you can tell it apart from the other image on a shared
 * console, and then idles. Replace it.
 *
 * This core is declared in ../board.yaml as:
 *
 *     cores:
 *       ${coreId}:
 *         app: ./${coreId}
 *
 * To talk to another core, add an \`ipc:\` entry to ../board.yaml and include
 * <alp/system_ipc.h> here -- the wizard leaves that out on purpose, because a
 * channel's carve-out has to resolve against the real memory map for the
 * generated addresses to mean anything.
 */

#include <stdio.h>

#include <alp/peripheral.h>

int main(void)
{
	/* Bring up the SDK runtime before anything else. */
	(void)alp_init();

	printf("[${coreId}] slice up\\n");

	for (;;) {
		alp_delay_ms(1000u);
	}

	return 0;
}
`;
}

/** The companion's Kconfig fragment. Empty but present: Zephyr expects a
 *  `prj.conf` beside the application's `CMakeLists.txt`, and the generated
 *  `alp.conf` is layered over it. */
export function companionPrjConf(coreId: string): string {
  return `# SPDX-License-Identifier: Apache-2.0
#
# ${coreId} slice Kconfig. The generated alp.conf is layered OVER this file
# (see CMakeLists.txt's EXTRA_CONF_FILE), so anything set here is a project
# choice rather than something the board demands.
`;
}
