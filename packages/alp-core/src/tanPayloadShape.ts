// SPDX-License-Identifier: Apache-2.0
//
// Runtime shape check for the `data` payload of a tan envelope, for the
// commands whose payload this repo reads through a TypeScript `as` cast.
//
// A cast is a compile-time claim about a runtime value that crossed a process
// boundary, so it verifies nothing. Rename a field in tan and the cast still
// compiles here; the reader gets `undefined`, and what the customer is left
// with depends only on how that reader spells its access. `plan.slices.filter`
// and `manifest.ipc.length` throw mid-render and blank the panel — measured in
// test/webview/run.mjs as "Cannot read properties of undefined (reading
// 'filter')". `size` is the quiet one: `sizes?.slices ?? []` swallows it and
// the footprint column simply goes missing. None of the three names tan, names
// a field, or writes a log line. That is the failure this module exists to
// convert into a message.
//
// WHAT IS CHECKED: only the fields a consumer in this repo actually READS, and
// only that each is present and of the right broad kind (`TanFieldKind` — an
// array or a string; `data` itself must be an object that is neither null nor
// an array). Requiring more would be worse than requiring nothing — tan's
// payloads are additive, so a check that demanded every declared field would
// red a working panel the next time tan adds one. Element shapes are
// deliberately NOT checked: a per-element check would have to encode tan's
// whole model, which is the re-implementation this repo exists not to do.
//
// Pure — no `vscode`, no `fs`, no `child_process`.

/** The broad runtime kind a read field must have. */
export type TanFieldKind = "string" | "array";

/** Field name -> the kind a reader in this repo depends on. */
export type TanPayloadShape = Readonly<Record<string, TanFieldKind>>;

/**
 * `tan build --plan` -> `BuildPlanData` (src/ideHub/messages.ts), rendered by
 * the webview's BuildPlanView.
 *
 * Read: `sku` and `boardYaml` as text, `slices` / `sharedArtefacts` /
 * `warnings` as lists. NOT read on this path, so not required: `schemaVersion`,
 * `generatedBy`, `buildRoot`.
 */
export const BUILD_PLAN_SHAPE: TanPayloadShape = {
  sku: "string",
  boardYaml: "string",
  slices: "array",
  sharedArtefacts: "array",
  warnings: "array",
};

/**
 * `tan build --manifest` / `--manifest-from` -> `SystemManifest`
 * (packages/alp-core/src/systemManifest/models.ts).
 *
 * The view iterates all three lists. NOT read on this path, so not required:
 * `schema_version`, `generated_by`, `hw_info`, `boot_order`, `storage`.
 */
export const SYSTEM_MANIFEST_SHAPE: TanPayloadShape = {
  slices: "array",
  ipc: "array",
  helper_mcus: "array",
};

/**
 * `tan size` -> `SizeReport` (packages/alp-core/src/systemManifest/models.ts).
 *
 * Only `slices` is read — the view keys it by `core_id` to annotate each
 * manifest slice. NOT read on this path, so not required: `schema`, and
 * `summary` with its `over_budget` / `unknown_budget` lists.
 */
export const SIZE_REPORT_SHAPE: TanPayloadShape = {
  slices: "array",
};

/**
 * `tan build --materialise` -> `{ schemaVersion, baseDir, written }`, read by
 * `handleMaterialiseBuildPlan` (src/ideHub/buildPlanPanel.ts).
 *
 * Only `written` is read — the list of files the run put on disk. NOT read on
 * this path, so not required: `schemaVersion`, `baseDir`.
 *
 * This one earns the check more than the others, because its reader spells the
 * access `written ?? []`. A renamed or dropped field does not throw and does not
 * blank a panel: it reports "Materialised 0 file(s)" as a SUCCESS, which is the
 * one outcome indistinguishable from a run that legitimately wrote nothing.
 * tan-cli#505 item 3 measured the matching hazard on tan's side — a demoted
 * slice's `configArtefacts` drop out of `written` with `issues: []`, exit 0 and
 * `ok: true`, so "a CI step that materialises then runs `west build` for that
 * core gets default Kconfig instead of the project's, i.e. wrong firmware, with
 * no signal on either side". This check cannot detect that (tan emits no
 * demotion signal on this path), but it does stop the extension from adding a
 * second silent path of its own.
 */
export const MATERIALISE_SHAPE: TanPayloadShape = {
  written: "array",
};

function hasKind(value: unknown, kind: TanFieldKind): boolean {
  return kind === "array" ? Array.isArray(value) : typeof value === "string";
}

/**
 * Check one envelope `data` payload against the fields a reader depends on.
 *
 * Returns `null` when the payload is usable, or a customer-facing sentence
 * naming the command and every field that is missing or the wrong kind.
 *
 * The message stops at "the two disagree" on purpose. A shape mismatch looks
 * identical whichever side moved, and this function is handed a payload and
 * never a version, so it names the remedy that covers both rather than guessing
 * a cause. (The extension does compare the resolved binary against
 * `SUPPORTED_CLI_VERSION` — in `src/alpCli`, with its own notice.)
 *
 * @param data the envelope's `data`, straight off `parseEnvelope`
 * @param shape the fields the caller reads, and the kind each must have
 * @param command the tan command that produced it, e.g. `build --plan`
 */
export function checkTanPayload(
  data: unknown,
  shape: TanPayloadShape,
  command: string,
): string | null {
  const lead = `\`tan ${command}\` returned data this extension cannot read`;
  const tail =
    `The extension and the \`tan\` binary it ran disagree about this ` +
    `command's output — update both to matching versions.`;

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return `${lead}: the envelope carried no \`data\` object. ${tail}`;
  }

  const record = data as Record<string, unknown>;
  const bad = Object.entries(shape)
    .filter(([field, kind]) => !hasKind(record[field], kind))
    .map(([field, kind]) => `\`${field}\` (expected ${anArticle(kind)})`);
  if (bad.length === 0) return null;

  return `${lead}: ${bad.join(", ")} missing or of another type. ${tail}`;
}

function anArticle(kind: TanFieldKind): string {
  return kind === "array" ? "an array" : "a string";
}
