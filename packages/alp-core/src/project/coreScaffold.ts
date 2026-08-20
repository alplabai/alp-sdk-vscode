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

/** Runtimes that take an application directory. Anything else — `off` today —
 *  gets no `app:`, because a slice that claims an app it will never build is
 *  worse than an honest empty one. */
function takesApp(os: string): boolean {
  return os !== "off";
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
    const existing = cores[assignment.id] ?? {};
    const next: CoreEntry = { ...existing, os: assignment.os as CoreOs };
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
