// SPDX-License-Identifier: Apache-2.0
//
// Giving every core the user chose its own app (#534).
//
// `tan init --cores` splices companions in APP-LESS. From `tan init --help` at
// the pinned 0.6.0-rc1: a companion "can only be spliced in app-less, as
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
function takesApp(os: string): boolean {
  return os === "zephyr";
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
    if (!existing || !assignment.app || !takesApp(assignment.os)) continue;
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
  for (const assignment of assignments) {
    const os = narrowCoreOs(assignment.os);
    // Dropped rather than coerced — see `CORE_OS_VALUES`. `unknownCoreOs` is
    // what the caller reports it with.
    if (os === null) continue;
    const existing = cores[assignment.id] ?? {};
    const next: CoreEntry = { ...existing, os };
    if (!takesApp(assignment.os)) {
      delete next.app;
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
    cores[assignment.id] = next;
  }
  return { ...board, cores };
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
