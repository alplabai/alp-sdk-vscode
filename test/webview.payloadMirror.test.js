// SPDX-License-Identifier: Apache-2.0
//
// The webview's mirrored PAYLOAD MODELS, gated (#497).
//
// `test/webview.protocolMirror.test.js` (#495) gates the message half of
// `packages/alp-webview/src/types.ts`: both unions, every discriminant, every
// message interface's field names. Its header says, in as many words, that it
// deliberately leaves the payload models out — `SystemManifest`, `BoardConfig`,
// `Ota`, the size report, the dependency rows, the Hardware Explorer models —
// because those mirror `@alp-sdk/core` rather than the host protocol and the
// relationship is looser by design: the mirror carries only what the webview
// renders. This file is that deferred half.
//
// WHY IT MATTERS — the same quiet failure as the message half, one layer down.
// A payload field the view starts rendering after it has silently gone missing
// from the mirror reads as `undefined`, and depending only on how the access is
// spelled that is either a throw that blanks the panel or a confident wrong
// answer. `packages/alp-core/src/tanPayloadShape.ts` exists because exactly
// that class of skew already cost us across the tan boundary.
//
// ---------------------------------------------------------------------------
// THE SHAPE OF THE GATE, AND WHY
// ---------------------------------------------------------------------------
//
// #497 weighed three options. The two that survived are used TOGETHER, because
// the two directions of drift are not equally dangerous and do not deserve the
// same rule:
//
//   * CORE-ONLY field (core has it, the mirror does not) — an omission. Usually
//     deliberate. Allowed only when `KNOWN_UNMIRRORED` names it WITH A REASON,
//     which is what turns "nobody noticed" into "somebody decided". 19 such
//     omissions existed when this file landed; every one is in the table.
//
//   * MIRROR-ONLY field (the mirror has it, core does not) — a stale mirror,
//     and the direction that actually blanks a panel. There is NO allowlist for
//     it. A survey of all 52 model pairs found zero, so the rule starts strict;
//     a gate is only ever strict on the day it lands.
//
// A third rule keeps the table from rotting: every `KNOWN_UNMIRRORED` entry
// must still describe a live omission. Mirror the field, or delete it from
// core, and the stale entry reds. An allowlist nothing re-checks empties the
// gate one merge at a time.
//
// A fourth closes the escape hatch: every `export interface` in the mirror must
// be EITHER a message-union member (gated by #495) OR listed in `MODELS` here.
// Otherwise a new hand-mirrored model is simply born ungated.
//
// STRICT vs LOOSE. `strict: true` marks the pairs whose source is
// `src/ideHub/messages.ts` — those are not loose core models at all, they are
// the wire format's own nested payload types, unreachable from #495's
// union-member walk only because nothing names them in a union. They are held
// to the message-half standard: field-for-field, and no omission may be
// allowlisted. That is asserted, not merely intended.
//
// NOT COMPARED — field TYPE text, for the reason #495 gives: the two sides
// legitimately spell the same contract differently, and a gate that cries wolf
// gets deleted. String-literal union ALIASES are the exception: there the
// members ARE the contract, so they are compared by member set (one documented
// divergence, `SdkReadinessState`, is allowlisted below). A FIELD typed as a
// bare string literal (or a union of them) is the same exception one level
// down (#603, round 4, nit 7): `DependencyCommandAction.kind` and
// `DependencyFixAction.kind` are the discriminant these two interfaces were
// extracted from one `DependencyAction` union to let a walk over named
// interfaces reach — a field-name check alone cannot tell them apart if the
// mirror's literal drifts (or collides with its sibling's), so those
// literals are compared by member set too.
//
// Read as TEXT, again for #495's reason: `types.ts` is never compiled into
// `out/`, so a structural check would only ever see the host half.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const MIRROR_REL = "packages/alp-webview/src/types.ts";
const CONFIGURATOR_REL =
  "packages/alp-webview/src/features/configurator/ConfiguratorView.tsx";

const BOARD_REL = "packages/alp-core/src/board/models.ts";
const MANIFEST_REL = "packages/alp-core/src/systemManifest/models.ts";
const STALENESS_REL = "packages/alp-core/src/systemManifest/staleness.ts";
const PLANNER_REL = "packages/alp-core/src/deps/planner.ts";
const STATE_REL = "packages/alp-core/src/deps/state.ts";
const CATALOGUE_REL = "packages/alp-core/src/sdkCatalogue/models.ts";
const SDK_REL = "packages/alp-core/src/sdk/models.ts";
const VIEWMODEL_REL = "packages/alp-core/src/configurator/viewModel.ts";
const VALIDATE_REL = "packages/alp-core/src/board/validate.ts";
const BOOTSTRAP_REL = "packages/alp-core/src/toolchain/bootstrapPlan.ts";
const HOST_REL = "src/ideHub/messages.ts";

/**
 * Every interface the mirror hand-copies, and where the original lives.
 *
 * `source` differs from `mirror` only where the webview renamed the type; the
 * Hardware Explorer prefixes its copies `Explorer*` so they do not collide with
 * the configurator's view-model types in the same flat file.
 */
const MODELS = [
  // ── system manifest + `alp-size/1` ──
  { mirror: "ManifestHwInfo", file: MANIFEST_REL },
  { mirror: "ManifestSlice", file: MANIFEST_REL },
  { mirror: "ManifestIpcLink", file: MANIFEST_REL },
  { mirror: "ManifestHelperMcu", file: MANIFEST_REL },
  { mirror: "SystemManifest", file: MANIFEST_REL },
  { mirror: "SizeRegion", file: MANIFEST_REL },
  { mirror: "SliceSize", file: MANIFEST_REL },
  { mirror: "SizeReport", file: MANIFEST_REL },
  { mirror: "ManifestProvenance", file: STALENESS_REL },

  // ── board.yaml ──
  { mirror: "BoardConfig", file: BOARD_REL },
  { mirror: "CoreEntry", file: BOARD_REL },
  { mirror: "CoreInference", file: BOARD_REL },
  { mirror: "CoreIot", file: BOARD_REL },
  { mirror: "Diagnostics", file: BOARD_REL },
  { mirror: "StoragePartition", file: BOARD_REL },
  { mirror: "SecurityPsa", file: BOARD_REL },
  { mirror: "Security", file: BOARD_REL },
  { mirror: "BootSigning", file: BOARD_REL },
  { mirror: "Boot", file: BOARD_REL },
  { mirror: "OtaServer", file: BOARD_REL },
  { mirror: "Ota", file: BOARD_REL },
  { mirror: "IpcEntry", file: BOARD_REL },
  { mirror: "ModelEntry", file: BOARD_REL },

  // ── dependency panel ──
  { mirror: "DependencyLatest", file: PLANNER_REL },
  { mirror: "DependencyCommandStep", file: PLANNER_REL },
  // The two `DependencyAction` union members (#603, third review, major 4):
  // named interfaces specifically so this walk reaches them — the union type
  // itself is invisible to it, which is how `omittedTools` grew on both
  // sides with nothing ever comparing them.
  { mirror: "DependencyCommandAction", file: PLANNER_REL },
  { mirror: "DependencyFixAction", file: PLANNER_REL },
  { mirror: "DependencyRow", file: PLANNER_REL },
  { mirror: "DependencyReport", file: PLANNER_REL },

  // ── SDK catalogue: the Hardware Explorer's `Explorer*` renames ──
  { mirror: "ExplorerPadRoute", source: "PadRoute", file: CATALOGUE_REL },
  { mirror: "ExplorerI2cDevice", source: "I2cDevice", file: CATALOGUE_REL },
  {
    mirror: "ExplorerTopologyCore",
    source: "TopologyCore",
    file: CATALOGUE_REL,
  },
  { mirror: "ExplorerCore", source: "SocCore", file: CATALOGUE_REL },
  { mirror: "HardwareExplorerSom", source: "SomPreset", file: CATALOGUE_REL },
  { mirror: "BoardPreset", file: CATALOGUE_REL },
  { mirror: "AcceleratorAvail", file: CATALOGUE_REL },

  // ── SDK manager ──
  { mirror: "LocalSdkEntry", file: SDK_REL },
  { mirror: "SdkRelease", file: SDK_REL },

  // ── configurator view-model (host-computed, read-only on the webview) ──
  { mirror: "SomOptionGroup", file: VIEWMODEL_REL },
  { mirror: "HardwareCard", file: VIEWMODEL_REL },
  { mirror: "CorePanel", file: VIEWMODEL_REL },
  { mirror: "ChipChoice", file: VIEWMODEL_REL },
  { mirror: "ConfiguratorViewModel", file: VIEWMODEL_REL },
  // Two DIFFERENT `ValidationResult`s exist in core. This one is
  // board/validate's `{errors, warnings}` — the one `ConfiguratorViewModel`
  // imports. `validation/models.ts` exports an unrelated `{outcome, issues}`
  // under the same name; wiring that one here would compare against a shape
  // the webview never receives.
  { mirror: "ValidationResult", file: VALIDATE_REL },

  // ── wire-format payload types: strict, see the header ──
  { mirror: "SdkStatus", file: HOST_REL, strict: true },
  { mirror: "ToolVersions", file: HOST_REL, strict: true },
  { mirror: "SetupStatus", file: HOST_REL, strict: true },
  { mirror: "WorkspaceStatus", file: HOST_REL, strict: true },
  { mirror: "AlpIdeState", file: HOST_REL, strict: true },
  { mirror: "ProjectTemplate", file: HOST_REL, strict: true },
  // #530's step-jump message. Registered because the webview reads `stepId`
  // and silently ignores an id it does not know, so a rename that drifted only
  // on one side would degrade to "the button does nothing" with no red gate.
  { mirror: "NewProjectFlowGoToStepMessage", file: HOST_REL, strict: true },
  { mirror: "E1mModule", file: HOST_REL, strict: true },
  { mirror: "BuildPlanToolStep", file: HOST_REL, strict: true },
  { mirror: "BuildPlanGeneratedFile", file: HOST_REL, strict: true },
  { mirror: "BuildPlanSlice", file: HOST_REL, strict: true },
  { mirror: "BuildPlanWarning", file: HOST_REL, strict: true },
  { mirror: "BuildPlanData", file: HOST_REL, strict: true },

  // ── models panel: `tan model ab|run|zoo` nested payloads ──
  // Both are declared in HOST_REL, so they are strict by the rule above: they
  // are wire-format payload types, unreachable from #495's union walk only
  // because no union names them directly (they are nested inside one).
  { mirror: "ModelEnergyMeasurement", file: HOST_REL, strict: true },
  { mirror: "ZooEntry", file: HOST_REL, strict: true },

  // ── New Project preview (#616): `tan init --preview`'s file list ──
  { mirror: "NewProjectFileChange", file: HOST_REL, strict: true },
];

/**
 * Fields core declares that the mirror deliberately does not carry, keyed
 * `MirrorType.field` with the `?` the source spells. Each value says WHY, so
 * the next reader inherits a decision instead of an absence.
 *
 * Adding an entry is the cost of the allowlist approach and the point of it: an
 * omission becomes a line someone had to write and a reviewer had to read.
 */
const KNOWN_UNMIRRORED = {
  // ── dependency panel ──
  "DependencyReport.orphanedPrerequisites":
    "A diagnostic for the NEXT tan rename of the hostPrerequisites rollup " +
    "(#603) — logged to the 'Alp SDK' output channel by " +
    "src/deps/vscodeAdapter.ts, not rendered by any panel. There is nothing " +
    "for the view to do with a prerequisite that bound to no row; the fix is " +
    "upstream in tan-cli, the same rule DependencyReport's own header states " +
    "for a prerequisite naming a tool with no check at all.",

  // ── system manifest ──
  "ManifestHwInfo.eeprom?":
    "The resolved EEPROM location (bus, bus_id, addr_7bit, offset). No surface " +
    "renders it — the Hardware Explorer lists i2cDevices from the SDK catalogue " +
    "instead, which is a different resolution from a different source.",
  "ManifestSlice.recipe?":
    "The bitbake recipe packaging an app-only Yocto slice. The manifest table " +
    "renders app/image; the recipe is a build-internal name with no column.",

  // ── board.yaml ──
  // The five below are safe for a reason the CoreEntry ones do not share: the
  // mirror's `BoardConfig` carries `[key: string]: unknown`, and the
  // configurator MUTATES the parsed document rather than rebuilding it, so an
  // unmodelled top-level key survives the webview→host round-trip untouched.
  // Delete that index signature and every one of these becomes a data-loss bug.
  "BoardConfig.schemaVersion?":
    "board.yaml's schema version, written only by a scripts/alp_migrate step. " +
    "The configurator never edits it and must never drop it (the C1 " +
    "BOARD_KEY_ORDER data-loss gate); the index signature preserves it.",
  "BoardConfig.e1m_routes?":
    "Carrier pad routing. No configurator surface edits it yet — that is the " +
    "unstarted PinmuxConfigurator work, which will need a real mirrored model.",
  "BoardConfig.pins?":
    "Pin references, same story as e1m_routes: preserved, never rendered.",
  "BoardConfig.features?":
    "An opaque feature bag (Record<string, unknown>) the SDK resolves. Nothing " +
    "in the webview can meaningfully render an untyped map.",
  "BoardConfig.supported_boards?":
    "Board-support metadata consumed by the SDK, not by any panel.",
  // CoreEntry has NO index signature. These three survive only because
  // `CoreCard`'s `ensure()` returns `d.cores[core.id]` and mutates it in place
  // (ConfiguratorView.tsx) — it never reconstructs the entry from a literal.
  // Any future code that rebuilds a CoreEntry object WILL silently drop them.
  "CoreEntry.extra_libraries?":
    "Per-core extra libraries. The configurator edits the top-level libraries[] " +
    "array only (ADR 0018), so there is no per-core surface to render them in.",
  "CoreEntry.memory?":
    "stack_kib / heap_kib / isr_stack_kib budgets. No configurator surface yet; " +
    "the Memory-region view (#484) is where these would land.",
  "CoreEntry.power?":
    "sleep_mode / wakeup_sources. No configurator surface yet, same as memory.",
  "Ota.rollback?":
    "Rollback policy (enabled, retries, min_version). The OTA panel edits " +
    "provider, artifact_name, signing_key, server and poll_interval_s only.",
  "Ota.storage?":
    "A/B storage layout (device, boot_part_mb, rootfs_ab, total_size_mb). Same " +
    "panel, same reason as rollback.",

  // ── SDK catalogue → Hardware Explorer ──
  // `capabilities`, `topologyCoreIds` and `preliminary` are REQUIRED on
  // SomPreset: the host always sends them, and the mirror still chooses not to
  // type them. That is a stronger claim than skipping an optional field, so
  // each says what renders the same information instead.
  "HardwareExplorerSom.siliconVariant?":
    "A sub-variant string; the Explorer's Silicon column prints `silicon`.",
  "HardwareExplorerSom.preferredBackend?":
    "Drives scaffolding defaults host-side; the Explorer shows the per-core " +
    "`toolchain` from the topology instead.",
  "HardwareExplorerSom.capabilities":
    "Required upstream. Consumed host-side to compute AcceleratorAvail[], which " +
    "IS mirrored — the Explorer renders that derived list, never the raw map.",
  "HardwareExplorerSom.defaultBoard?":
    "A scaffolding default; the Explorer shows the per-core `board` from the " +
    "topology instead.",
  "HardwareExplorerSom.topologyCoreIds":
    "Required upstream, and redundant here: it is the id list of `topology`, " +
    "which is mirrored in full.",
  "HardwareExplorerSom.memory?":
    "dramMbit / flashMbit. Budgets are rendered by the size report, not the " +
    "Hardware Explorer.",
  "HardwareExplorerSom.preliminary":
    "Required upstream. The preliminary badge is rendered from the " +
    "configurator's HardwareCard.preliminary, which is mirrored.",
};

/**
 * String-literal union aliases the mirror copies. Members ARE the contract
 * here, so they are compared as a set rather than skipped like type text.
 */
const ALIASES = [
  { mirror: "CoreOs", file: BOARD_REL },
  { mirror: "LogLevel", file: BOARD_REL },
  { mirror: "LogLevelOrOff", file: BOARD_REL },
  { mirror: "LibraryEntry", file: BOARD_REL },
  { mirror: "SliceSizeStatus", file: MANIFEST_REL },
  { mirror: "ManifestFreshness", file: STALENESS_REL },
  { mirror: "DependencyStatus", file: PLANNER_REL },
  { mirror: "DependencyActionEffect", file: PLANNER_REL },
  { mirror: "DependencyState", file: STATE_REL },
  { mirror: "ToolchainFixId", file: BOOTSTRAP_REL },
  {
    mirror: "SdkReadinessState",
    file: SDK_REL,
    // The one deliberate divergence, already documented in #495's header: the
    // host widens the field to `SdkReadinessState | "unknown"` at the use site,
    // and the mirror folds that member into the alias instead.
    extraMirrorMembers: ['"unknown"'],
  },
];

/** Functions the webview re-implements verbatim rather than importing. */
const MIRRORED_FUNCTIONS = [
  { name: "librariesForCore", file: BOARD_REL },
  { name: "applyCoreLibrarySelection", file: BOARD_REL },
];

// ---------------------------------------------------------------------------
// Source reading — text-level on purpose (see header)
// ---------------------------------------------------------------------------

/** Drop comments so prose cannot be read as source. Same rule as #495's gate:
 *  a `//` preceded by an odd number of quotes is inside a string literal. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => {
      const at = line.indexOf("//");
      if (at < 0) return line;
      const quotes = (line.slice(0, at).match(/"/g) ?? []).length;
      return quotes % 2 === 0 ? line.slice(0, at) : line;
    })
    .join("\n");
}

/** The brace-balanced text following `opener`, or null. Balanced rather than a
 *  lazy match because every one of these bodies nests. */
function balanced(source, opener) {
  const header = opener.exec(source);
  if (!header) return null;

  let depth = 1;
  const start = header.index + header[0].length;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i);
    }
  }
  return null;
}

const interfaceBody = (source, name) =>
  balanced(source, new RegExp(`export interface ${name}\\b[^{]*\\{`, "m"));

/** A whole function declaration, signature included, normalized to one space. */
function functionText(source, name) {
  const opener = new RegExp(
    `(?:export )?function ${name}\\s*\\([\\s\\S]*?\\)[^{]*\\{`,
    "m",
  );
  const match = opener.exec(source);
  const body = balanced(source, opener);
  if (!match || body === null) return null;
  const signature = match[0].replace(/^export /, "");
  return `${signature}${body}}`.replace(/\s+/g, " ").trim();
}

/**
 * Top-level field names of an interface body, each keeping its `?`, so a field
 * going from required to optional is drift too. Nested brace groups are blanked
 * first so a `;` inside an inline object type cannot split a field in two.
 */
function fieldNames(body) {
  let flat = "";
  let depth = 0;
  for (const ch of body) {
    if (ch === "{") {
      depth += 1;
      flat += " ";
    } else if (ch === "}") {
      depth -= 1;
      flat += " ";
    } else {
      flat += depth > 0 ? " " : ch;
    }
  }
  return new Set(
    flat
      .split(";")
      .map((entry) => /^\s*(\w+)(\?)?\s*:/.exec(entry))
      .filter(Boolean)
      .map((m) => `${m[1]}${m[2] ?? ""}`),
  );
}

/**
 * Top-level field name -> raw type text (nested brace groups blanked the same
 * way `fieldNames` blanks them, so a `;` inside an inline object type cannot
 * split a field in two). Unlike `fieldNames`, the type text survives — needed
 * to compare a DISCRIMINANT literal (`kind: "command"`) the way `ALIASES`
 * compares a union's members, rather than only its field NAME (#603, round 4,
 * nit 7).
 */
function fieldTypes(body) {
  let flat = "";
  let depth = 0;
  for (const ch of body) {
    if (ch === "{") {
      depth += 1;
      flat += " ";
    } else if (ch === "}") {
      depth -= 1;
      flat += " ";
    } else {
      flat += depth > 0 ? " " : ch;
    }
  }
  const types = new Map();
  for (const entry of flat.split(";")) {
    const match = /^\s*(\w+)\??\s*:\s*(.+?)\s*$/.exec(entry);
    if (match) types.set(match[1], match[2].trim());
  }
  return types;
}

/**
 * The member set of a field's type text, when that type is ONLY a string
 * literal or a union of them (`"command"`, `"a" | "b"`) — `null` for anything
 * else (an object shape, an array, a named type), which this gate leaves
 * alone for the reason the header gives: type text otherwise legitimately
 * differs between the two sides.
 */
function literalUnionMembers(typeText) {
  const trimmed = typeText.trim();
  if (!/^"[^"]*"(\s*\|\s*"[^"]*")*$/.test(trimmed)) return null;
  return new Set(trimmed.split("|").map((part) => part.trim()));
}

/** The member list of `export type <name> = A | B | C;`, or null. */
function aliasMembers(source, name) {
  const match = new RegExp(`export type ${name}\\s*=([\\s\\S]*?);`, "m").exec(
    source,
  );
  if (!match) return null;
  return match[1]
    .split("|")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const cache = new Map();
function load(relative) {
  if (!cache.has(relative)) {
    cache.set(
      relative,
      stripComments(fs.readFileSync(path.join(ROOT, relative), "utf8")),
    );
  }
  return cache.get(relative);
}

const mirror = load(MIRROR_REL);
const sourceNameOf = (model) => model.source ?? model.mirror;

// ---------------------------------------------------------------------------
// The pairs resolve at all
// ---------------------------------------------------------------------------

test("every declared model pair exists on both sides", () => {
  for (const model of MODELS) {
    const source = sourceNameOf(model);
    assert.ok(
      interfaceBody(mirror, model.mirror),
      `${MIRROR_REL}: no \`export interface ${model.mirror}\`. Either the ` +
        `mirror dropped it and the MODELS row is stale, or it was renamed and ` +
        `this gate silently stopped comparing anything.`,
    );
    assert.ok(
      interfaceBody(load(model.file), source),
      `${model.file}: no \`export interface ${source}\`, which ` +
        `\`${model.mirror}\` claims to mirror. A renamed or moved source type ` +
        `leaves the mirror gated against nothing.`,
    );
  }
});

// ---------------------------------------------------------------------------
// Field drift, in both directions, with a different rule per direction
// ---------------------------------------------------------------------------

test("no field the mirror declares has left the source (a stale mirror)", () => {
  for (const model of MODELS) {
    const source = sourceNameOf(model);
    const mirrorBody = interfaceBody(mirror, model.mirror);
    const sourceBody = interfaceBody(load(model.file), source);
    if (!mirrorBody || !sourceBody) continue; // reported above

    const sourceFields = fieldNames(sourceBody);
    for (const field of fieldNames(mirrorBody)) {
      assert.ok(
        sourceFields.has(field),
        `\`${model.mirror}.${field}\` is declared in ${MIRROR_REL} but not in ` +
          `${model.file} (as \`${source}\`). The webview reads a field nothing ` +
          `sends: it renders \`undefined\`, which either throws mid-render and ` +
          `blanks the panel or prints a confident wrong answer. There is no ` +
          `allowlist for this direction — fix the mirror.`,
      );
    }
  }
});

test("every field the source adds is either mirrored or a recorded omission", () => {
  for (const model of MODELS) {
    const source = sourceNameOf(model);
    const mirrorBody = interfaceBody(mirror, model.mirror);
    const sourceBody = interfaceBody(load(model.file), source);
    if (!mirrorBody || !sourceBody) continue; // reported above

    const mirrorFields = fieldNames(mirrorBody);
    for (const field of fieldNames(sourceBody)) {
      if (mirrorFields.has(field)) continue;

      const key = `${model.mirror}.${field}`;
      assert.ok(
        Object.prototype.hasOwnProperty.call(KNOWN_UNMIRRORED, key),
        `\`${source}.${field}\` exists in ${model.file} but not as ` +
          `\`${model.mirror}.${field}\` in ${MIRROR_REL}.\n\n` +
          `If the webview should render it, mirror it. If it should not, add ` +
          `"${key}" to KNOWN_UNMIRRORED in this file with the reason — that is ` +
          `the whole point of the table: an intentional omission has to be a ` +
          `decision someone wrote down, not a field nobody noticed.`,
      );
    }
  }
});

test("a field typed as a bare string literal (or union of them) is the SAME literal on both sides (#603 round 4, nit 7)", () => {
  // `fieldNames` above (both directions) only ever compares field NAMES, by
  // design — see the header's "NOT COMPARED — field TYPE text". That is right
  // for an ordinary field, whose type text legitimately differs between a
  // host model and its webview copy. It is WRONG for a discriminant: these
  // interfaces exist in pairs (`DependencyCommandAction` / `DependencyFixAction`)
  // PRECISELY so a union member can be told apart from its sibling, and
  // `kind` is what does the telling. Measured: renaming the mirror's
  // `DependencyCommandAction.kind` from `"command"` to `"fix"` (colliding
  // with `DependencyFixAction`'s own literal) AND its `commands` field from
  // an array to `number` passes every existing check here, 20 tests to 0 —
  // `fieldNames` sees `kind` and `commands` present on both sides and stops
  // looking. This walks every field whose SOURCE type is a bare string
  // literal (or a union of them) and compares the member set the same way
  // `ALIASES` already compares a whole union alias's members.
  for (const model of MODELS) {
    const source = sourceNameOf(model);
    const mirrorBody = interfaceBody(mirror, model.mirror);
    const sourceBody = interfaceBody(load(model.file), source);
    if (!mirrorBody || !sourceBody) continue; // reported above

    const mirrorTypes = fieldTypes(mirrorBody);
    for (const [field, sourceType] of fieldTypes(sourceBody)) {
      const sourceLiterals = literalUnionMembers(sourceType);
      if (!sourceLiterals) continue; // not a literal field — type text is free to differ
      const mirrorType = mirrorTypes.get(field);
      if (mirrorType === undefined) continue; // a missing field is caught above

      const mirrorLiterals = literalUnionMembers(mirrorType);
      assert.deepEqual(
        mirrorLiterals ? [...mirrorLiterals].sort() : mirrorType,
        [...sourceLiterals].sort(),
        `\`${model.mirror}.${field}\` is typed \`${mirrorType}\` in ` +
          `${MIRROR_REL} but \`${source}.${field}\` is typed \`${sourceType}\` ` +
          `in ${model.file}. A discriminant is the contract two sibling ` +
          `interfaces exist to keep apart — a mismatch here lets a value ` +
          `neither side can route reach the other.`,
      );
    }
  }
});

test("a strict (wire-format) pair may not allowlist an omission", () => {
  // These mirror src/ideHub/messages.ts, not @alp-sdk/core. They are the wire
  // format's own nested payload types and are held to the message half's
  // standard; the looseness KNOWN_UNMIRRORED grants is for core models only.
  for (const model of MODELS.filter((m) => m.strict)) {
    const allowlisted = Object.keys(KNOWN_UNMIRRORED).filter((key) =>
      key.startsWith(`${model.mirror}.`),
    );
    assert.deepEqual(
      allowlisted,
      [],
      `\`${model.mirror}\` mirrors ${HOST_REL}, so it must match field-for-` +
        `field. Omitting ${allowlisted.join(", ")} means the host sends a ` +
        `field the webview cannot see. Mirror it, or drop it host-side and ` +
        `bump PROTOCOL_VERSION.`,
    );
  }
});

test("every recorded omission is still a live omission", () => {
  // An allowlist nothing re-checks empties the gate one merge at a time: the
  // field gets mirrored (or deleted from core), the entry stays, and the next
  // reader takes it as evidence of a decision that no longer exists.
  const byMirrorName = new Map(
    MODELS.map((model) => [
      model.mirror,
      { model, source: sourceNameOf(model) },
    ]),
  );

  for (const [key, reason] of Object.entries(KNOWN_UNMIRRORED)) {
    const dot = key.indexOf(".");
    const typeName = key.slice(0, dot);
    const field = key.slice(dot + 1);

    assert.ok(
      typeof reason === "string" && reason.trim().length >= 40,
      `KNOWN_UNMIRRORED["${key}"] has no real reason. An entry without one is ` +
        `an unexplained hole, which is the state this gate exists to end.`,
    );

    const entry = byMirrorName.get(typeName);
    assert.ok(entry, `KNOWN_UNMIRRORED["${key}"] names no type in MODELS`);

    const mirrorBody = interfaceBody(mirror, typeName);
    const sourceBody = interfaceBody(load(entry.model.file), entry.source);
    if (!mirrorBody || !sourceBody) continue; // reported above

    assert.ok(
      fieldNames(sourceBody).has(field),
      `KNOWN_UNMIRRORED["${key}"] is stale: \`${entry.source}.${field}\` no ` +
        `longer exists in ${entry.model.file}. Delete the entry.`,
    );
    assert.ok(
      !fieldNames(mirrorBody).has(field),
      `KNOWN_UNMIRRORED["${key}"] is stale: the mirror now DOES declare ` +
        `\`${typeName}.${field}\`. Delete the entry so the field is gated like ` +
        `every other mirrored one.`,
    );
  }
});

// ---------------------------------------------------------------------------
// Nothing escapes: every mirror interface is gated by one file or the other
// ---------------------------------------------------------------------------

test("every interface in the mirror is gated here or by the message half", () => {
  const declared = [...mirror.matchAll(/^export interface (\w+)/gm)].map(
    (m) => m[1],
  );
  const messageMembers = new Set(
    ["ExtToWebviewMessage", "WebviewToExtMessage"].flatMap((union) => {
      const match = new RegExp(`export type ${union}\\s*=([\\s\\S]*?);`).exec(
        mirror,
      );
      return match
        ? match[1]
            .split("|")
            .map((part) => part.trim())
            .filter(Boolean)
        : [];
    }),
  );
  const gatedHere = new Set(MODELS.map((model) => model.mirror));

  assert.ok(messageMembers.size >= 20, "the union parser read almost nothing");

  const ungated = declared.filter(
    (name) => !messageMembers.has(name) && !gatedHere.has(name),
  );
  assert.deepEqual(
    ungated,
    [],
    `${MIRROR_REL} declares ${ungated.join(", ")}, which no gate compares ` +
      `against anything. A message interface belongs to a union (and is gated ` +
      `by test/webview.protocolMirror.test.js); anything else is a mirrored ` +
      `model and belongs in MODELS here, with its source file.`,
  );
});

// ---------------------------------------------------------------------------
// Union aliases — here the members ARE the contract
// ---------------------------------------------------------------------------

for (const alias of ALIASES) {
  test(`the \`${alias.mirror}\` union has the same members on both sides`, () => {
    const mirrorMembers = aliasMembers(mirror, alias.mirror);
    const sourceMembers = aliasMembers(load(alias.file), alias.mirror);
    assert.ok(
      mirrorMembers,
      `${MIRROR_REL}: no \`export type ${alias.mirror}\``,
    );
    assert.ok(
      sourceMembers,
      `${alias.file}: no \`export type ${alias.mirror}\``,
    );

    const expected = [...sourceMembers, ...(alias.extraMirrorMembers ?? [])];
    assert.deepEqual(
      [...mirrorMembers].sort(),
      expected.sort(),
      `\`${alias.mirror}\` differs between ${MIRROR_REL} and ${alias.file}. ` +
        `Unlike a field's type text, a union's members are the contract: a ` +
        `member only one side knows is a value the other cannot handle.`,
    );
  });
}

// ---------------------------------------------------------------------------
// Mirrored LOGIC, not just mirrored types
// ---------------------------------------------------------------------------

for (const fn of MIRRORED_FUNCTIONS) {
  test(`\`${fn.name}\` still matches the core implementation it copies`, () => {
    // The webview cannot import core, so these are copy-pasted. Copies drift
    // silently, and this pair decides what board.yaml's libraries[] ends up
    // holding — a divergence here writes a different document than the host
    // would have written from the same clicks.
    const copy = functionText(load(CONFIGURATOR_REL), fn.name);
    const original = functionText(load(fn.file), fn.name);

    assert.ok(original, `${fn.file}: no \`function ${fn.name}\``);
    assert.ok(
      copy,
      `${CONFIGURATOR_REL}: no \`function ${fn.name}\`. If the copy was ` +
        `finally replaced by a shared import, delete this row from ` +
        `MIRRORED_FUNCTIONS — that is the outcome this gate wants.`,
    );
    assert.equal(
      copy,
      original,
      `\`${fn.name}\` has diverged between ${CONFIGURATOR_REL} and ${fn.file}. ` +
        `Whitespace is normalized before comparing, so this is a real ` +
        `behavioural difference, not formatting.`,
    );
  });
}

// ---------------------------------------------------------------------------
// The parsers themselves
// ---------------------------------------------------------------------------

// A gate that silently parses nothing passes forever. #495's file pins that for
// its own parsers; these pin the ones added here.
test("the parsers actually read something", () => {
  assert.ok(MODELS.length >= 40, "the model table lost most of its rows");
  assert.ok(
    Object.keys(KNOWN_UNMIRRORED).length >= 15,
    "the omission table lost most of its rows",
  );

  const nested = interfaceBody(
    "export interface Probe {\n  a?: { b: string; c: string }[];\n  d: number;\n}",
    "Probe",
  );
  assert.deepEqual(
    [...fieldNames(nested)].sort(),
    ["a?", "d"],
    "the field reader lost a field after an inline object type",
  );

  assert.deepEqual(aliasMembers('export type U = "a" | "b";', "U"), [
    '"a"',
    '"b"',
  ]);

  // The function reader must take the LAST brace of the body, not the first —
  // an inner block would otherwise truncate every function it reads.
  assert.equal(
    functionText(
      "export function f(x: number): number {\n  if (x) {\n    return 1;\n  }\n  return 0;\n}",
      "f",
    ),
    "function f(x: number): number { if (x) { return 1; } return 0; }",
  );
});
