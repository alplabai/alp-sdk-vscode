// SPDX-License-Identifier: Apache-2.0
//
// Whether starting a debug session programs the attached target, and the words
// the dialog shows for it (#586). Pure, and separate from the `vscode` seam for
// the same reason `flash/describe.ts` is: a consent screen whose wording is
// only reachable through a modal is a screen no test can read.
//
// WHY A DEBUG SESSION WRITES AT ALL. Nothing in a generated configuration says
// "program the board" — the write is a DEFAULT, and this is the adapter's own
// schema saying so (`marus25.cortex-debug` 1.12.1,
// contributes.debuggers[0].configurationAttributes.launch.properties.loadFiles):
//
//   "List of files (hex/bin/elf files) to load/program instead of the
//    executable file. Symbols are not loaded (see `symbolFiles`). Can be an
//    empty list to specify none. If this property does not exist, then the
//    executable is used to program the device"
//
// Three states, and they are not symmetric: key absent => the executable is
// programmed; key present and EMPTY => nothing is; key present and non-empty
// => those files are programmed INSTEAD of the executable. Only the middle one
// is consent to write nothing, and only a real empty array counts as it —
// `null`, `""` and `{}` are malformed input, never permission.
//
// This module deliberately does NOT decide whether the write lands in flash or
// in RAM. That depends on the image's load addresses (an Alif Ensemble M55
// image linked to ITCM is a RAM write; an LMA in a flash region routes through
// the probe's flash loader), and no bench run has narrowed it. Either way it is
// an unconsented write to attached silicon, which is all this gate needs.

/** Why a session was let through without a dialog. Named, not boolean, so a
 *  caller (and a test) can tell "not our business" from "writes nothing". */
export type DebugAllowReason =
  | "not-cortex-debug"
  | "not-a-launch"
  | "not-an-alp-workspace"
  | "loads-nothing";

/** Where the programmed artefacts were named — the two schema states that
 *  actually write. Kept on the decision because the dialog must name the file
 *  the adapter will really load, not the one the reader expects. */
export type DebugProgramsSource = "executable" | "loadFiles" | "gdbCommands";

export interface DebugWriteAllow {
  kind: "allow";
  reason: DebugAllowReason;
}

export interface DebugWriteAsk {
  kind: "ask";
  /** The configuration's `name`, so the dialog names the entry being started. */
  configName: string;
  /** `servertype` verbatim — jlink / openocd / pyocd. Empty when unstated. */
  servertype: string;
  /** `device` verbatim (e.g. AE722F80F55D5LS), or null when unstated. */
  device: string | null;
  /** The artefacts that will be written, verbatim and unexpanded. Empty when
   *  the configuration names none — which is a reason to ask, never a reason
   *  to assume nothing is written. */
  programs: readonly string[];
  programsSource: DebugProgramsSource;
  /** The `*Commands` keys that made the artefact unknowable, sorted. Empty
   *  unless `programsSource` is "gdbCommands". */
  commandKeys: readonly string[];
}

export type DebugWriteDecision = DebugWriteAllow | DebugWriteAsk;

/** What the caller must already know about the workspace. Passed in rather
 *  than probed here so this stays pure. */
export interface DebugConsentContext {
  /** True when the workspace holds a `board.yaml` — i.e. it is an Alp project.
   *  The scope line for this gate: this extension can activate in a window that
   *  has nothing to do with Alp (`onLanguage:yaml`), and a stranger's
   *  cortex-debug session must not sprout an Alp dialog. */
  boardYamlExists: boolean;
}

/** Where the session will run, for the lines the configuration cannot supply. */
export interface DebugConsentDetailContext {
  workspaceRoot: string | null;
}

/** Printed where the configuration states nothing, so a short line is never
 *  mistaken for a complete one. Same token `flash/describe.ts` uses. */
const NOT_STATED = "(not stated)";

/** LAST in every detail, immediately above the buttons, so a long artefact
 *  list cannot scroll the risk away from the button that accepts it. */
const RISK_SENTENCE =
  "A cortex-debug `launch` session loads the image onto the attached " +
  "target before it runs. Depending on the image's load addresses that " +
  "can OVERWRITE non-volatile memory, and programming the wrong image or " +
  "the wrong board can leave the device unbootable. Nothing is written " +
  "unless you continue.";

const readString = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** The artefacts this launch will program, and which schema state named them.
 *  A non-empty `loadFiles` REPLACES the executable — printing the executable
 *  next to it would name a file the adapter is not going to write. */
function readPrograms(config: Record<string, unknown>): {
  programs: readonly string[];
  programsSource: DebugProgramsSource;
} {
  const loadFiles = config.loadFiles;
  if (Array.isArray(loadFiles) && loadFiles.length > 0) {
    return {
      programs: loadFiles.map((entry) => String(entry)),
      programsSource: "loadFiles",
    };
  }
  const executable = readString(config.executable);
  return {
    programs: executable.length > 0 ? [executable] : [],
    programsSource: "executable",
  };
}

/**
 * The `*Commands` keys carrying at least one gdb command.
 *
 * cortex-debug 1.12.1 honours thirteen of these on `launch` and thirteen on
 * `attach`, and any of them can carry a bare `load`, which programs the device
 * through the same probe. The schema says so of `overrideLaunchCommands`
 * verbatim: "You can use this to property to override the commands that are
 * normally executed as part of flashing and launching the target".
 *
 * Matched by SHAPE rather than against an enumerated list, so an attribute a
 * future adapter release adds is covered the day it ships instead of silently
 * escaping. An empty list is not a risk — it states that nothing extra runs.
 */
function gdbCommandKeys(config: Record<string, unknown>): readonly string[] {
  return Object.keys(config)
    .filter((key) => key.endsWith("Commands"))
    .filter((key) => {
      const value = config[key];
      return Array.isArray(value) && value.length > 0;
    })
    .sort();
}

/**
 * Decide whether starting this configuration owes the user a dialog.
 *
 * Order is load-bearing: the cheapest disqualifier first, and the "programs
 * nothing" escape hatch LAST, so a malformed `loadFiles` can never short-cut
 * the checks above it.
 */
export function planDebugDeviceWrite(
  config: Record<string, unknown>,
  context: DebugConsentContext,
): DebugWriteDecision {
  if (readString(config.type) !== "cortex-debug") {
    return { kind: "allow", reason: "not-cortex-debug" };
  }
  if (!context.boardYamlExists) {
    return { kind: "allow", reason: "not-an-alp-workspace" };
  }

  const device = readString(config.device);
  const base = {
    kind: "ask" as const,
    configName: readString(config.name),
    servertype: readString(config.servertype),
    device: device.length > 0 ? device : null,
  };

  // BEFORE the request check and before the loadFiles hatch, both of which
  // reason about the adapter's DEFAULT sequence. A command list REPLACES that
  // sequence, so neither "attach programs nothing" nor "loadFiles: [] programs
  // nothing" is true any more, and the artefact cannot be read off the file.
  const commandKeys = gdbCommandKeys(config);
  if (commandKeys.length > 0) {
    return {
      ...base,
      programs: [],
      programsSource: "gdbCommands",
      commandKeys,
    };
  }

  if (readString(config.request) !== "launch") {
    return { kind: "allow", reason: "not-a-launch" };
  }
  if (Array.isArray(config.loadFiles) && config.loadFiles.length === 0) {
    return { kind: "allow", reason: "loads-nothing" };
  }

  const { programs, programsSource } = readPrograms(config);
  return { ...base, programs, programsSource, commandKeys: [] };
}

/**
 * The dialog's one-line message. Deliberately the same sentence shape
 * `flashConsentMessage` uses — the customer is being asked the same question
 * about the same silicon, and two spellings of it would read as two products.
 */
export function debugConsentMessage(ask: DebugWriteAsk): string {
  const device = ask.device !== null ? ask.device : "this device";
  return `Alp: start a debug session on ${device}? This writes to the device.`;
}

/**
 * The dialog's detail — everything the reader needs to refuse.
 *
 * Ordered so the irreversible-write sentence is LAST, next to the buttons,
 * rather than scrolled off the top by a long artefact list.
 */
export function describeDebugConsent(
  ask: DebugWriteAsk,
  context: DebugConsentDetailContext,
): string {
  const sections: string[] = [
    [
      `Configuration: ${ask.configName.length > 0 ? ask.configName : NOT_STATED}`,
      `Workspace: ${context.workspaceRoot ?? NOT_STATED}`,
      `Debug server: ${ask.servertype.length > 0 ? ask.servertype : NOT_STATED}`,
      `Device: ${ask.device ?? NOT_STATED}`,
    ].join("\n"),
  ];

  if (ask.programsSource === "gdbCommands") {
    sections.push(
      [
        "Will be programmed: UNKNOWN.",
        "  This configuration replaces the adapter's own flash/launch sequence",
        `  with its own gdb commands, through: ${ask.commandKeys.join(", ")}`,
        "  A gdb command list can carry `load`, so what reaches the device",
        "  cannot be read off the configuration.",
      ].join("\n"),
    );
    sections.push(RISK_SENTENCE);
    return sections.join("\n\n");
  }

  sections.push(
    [
      `Will be programmed (${ask.programs.length}):`,
      ...(ask.programs.length > 0
        ? ask.programs.map((entry) => `  ${entry}`)
        : [
            `  ${NOT_STATED} — the configuration names no artefact, and the ` +
              "adapter will still try to program one.",
          ]),
    ].join("\n"),
  );

  // The reason the reader could not have known. This is the whole defect in
  // #586: the write is a schema default, invisible in the configuration.
  sections.push(
    ask.programsSource === "executable"
      ? "This configuration carries no `loadFiles` key. Per the cortex-debug " +
          "adapter's schema, \"If this property does not exist, then the " +
          'executable is used to program the device" — so starting this ' +
          "session programs the target, even though nothing in the " +
          "configuration says so."
      : "This configuration's `loadFiles` list replaces the executable: the " +
          "files above are what gets programmed, and the executable is used " +
          "for symbols only.",
  );

  sections.push(RISK_SENTENCE);

  return sections.join("\n\n");
}
