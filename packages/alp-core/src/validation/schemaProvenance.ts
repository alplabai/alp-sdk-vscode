// SPDX-License-Identifier: Apache-2.0

/**
 * Which schema the editor is actually validating `board.yaml` and
 * `system-manifest.yaml` against, and whether that matches the SDK the
 * customer resolved (#493).
 *
 * `package.json`'s `contributes.yamlValidation` points `redhat.vscode-yaml` at
 * `schemas/*.json` -- byte-pinned snapshots of ONE alp-sdk tag. The extension
 * pins no SDK version, so a customer on a different tag is validated against a
 * schema their own toolchain does not use, in EITHER direction: v0.15.0
 * removed `storage[].raw`, so a v0.14.0 customer now gets a red squiggle on a
 * field `tan` accepts, and before that re-vendor a v0.15.0 customer got the
 * mirror error.
 *
 * That is now FIXED: `schemaContribution.ts` serves the resolved SDK's own copy
 * through `redhat.vscode-yaml`'s `registerContributor`, and the bundled copies
 * are the no-SDK fallback. This module decides WHICH copy is in force -- a
 * comparison alone cannot, because an SDK schema can also be present and
 * unusable -- and renders that decision as text the customer can read.
 *
 * So a difference between the two copies is no longer a defect to warn about;
 * it is the normal state of a customer on another tag, and the editor follows
 * their SDK. What is worth saying out loud is the two cases where the editor
 * CANNOT follow the SDK (`unreadable`, `rejected`), plus the one place where
 * the bundled tag still leaks through even when validation is correct: the
 * visual configurator's own model, which drops top-level keys it does not know
 * (`BOARD_KEY_ORDER`, `../board/models.ts`).
 *
 * Pure by design -- callers read the files and pass the bytes in, so the
 * comparison is testable without a filesystem or a resolved SDK.
 */

import { createHash } from "crypto";

import { BOARD_KEY_ORDER } from "../board/models";
import { acceptSdkSchemaText } from "./schemaSafety";
import {
  SDK_SCHEMA_RELATIVE_PATHS,
  VENDORED_SCHEMA_LABEL,
  VENDORED_SCHEMA_SHA256,
  VENDORED_SDK_TAG,
  type VendoredSchemaId,
} from "./vendoredSchemas";

/** Every schema this module compares, in a stable order. */
export const COMPARED_SCHEMA_IDS: readonly VendoredSchemaId[] = [
  "board",
  "systemManifest",
];

/**
 * Overall verdict.
 *
 * - `no-sdk`      -- nothing resolved; the vendored snapshot is correct BY
 *                    DEFINITION, and this is the common first-run state.
 * - `match`       -- every compared schema is byte-identical to the SDK's, so
 *                    which one is served cannot be observed.
 * - `mismatch`    -- at least one differs, and the SDK's copy is what the
 *                    editor serves. Expected, not a fault: it is what a
 *                    customer on another tag looks like once #493 works.
 * - `unreadable`  -- an SDK is resolved but at least one schema could not be
 *                    read, so that one falls back to the bundled copy. The
 *                    SDK install is incomplete.
 * - `rejected`    -- an SDK schema was read and REFUSED (`schemaSafety.ts`),
 *                    so it falls back too. Separate from `unreadable` because
 *                    the file is there and the customer can look at it.
 *
 * The two fallback states outrank `mismatch`, which is the reverse of the
 * ordering this had while the editor always asserted the snapshot. Then, a
 * difference WAS the defect; now, a difference is the feature working and a
 * fallback is the only thing left to act on.
 */
export type SchemaProvenanceState =
  | "no-sdk"
  | "match"
  | "mismatch"
  | "unreadable"
  | "rejected";

/** Which copy of a schema the editor actually validates against. */
export type SchemaSource = "sdk" | "bundled";

/**
 * The result of trying to read one schema from the resolved SDK. A failure is
 * a normal outcome, not an exception: a customer can point `alpSdk.sdkPath` at
 * any directory.
 */
export type SchemaRead =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string };

/** One schema, both sides. */
export interface SchemaComparison {
  readonly id: VendoredSchemaId;
  /** What the customer calls the file, e.g. `board.yaml`. */
  readonly label: string;
  /** Where the SDK's copy was looked for, relative to `<sdkRoot>`. */
  readonly sdkRelativePath: string;
  /** sha256 of the vendored copy -- the pinned constant, not a re-hash. */
  readonly vendoredSha256: string;
  /** sha256 of the SDK's copy, or null when it could not be read. */
  readonly sdkSha256: string | null;
  /** True only when both were read and hash the same. */
  readonly matches: boolean;
  /** Why `sdkSha256` is null; null when it was read. */
  readonly unreadableReason: string | null;
  /** Which copy the editor validates this document kind against. */
  readonly served: SchemaSource;
  /** Why the SDK's copy was refused; null when it was not read, or was used. */
  readonly rejectedReason: string | null;
}

/** What the editor should tell the customer about schema provenance. */
export interface SchemaProvenance {
  readonly state: SchemaProvenanceState;
  readonly sdkRoot: string | null;
  /** From `<sdkRoot>/metadata/sdk_version.yaml`; null when absent. */
  readonly sdkVersion: string | null;
  /** The alp-sdk tag the bundled schemas came from. */
  readonly vendoredTag: string;
  readonly comparisons: readonly SchemaComparison[];
  /**
   * Top-level `board.yaml` keys the SERVED SDK schema declares that
   * `BOARD_KEY_ORDER` does not carry -- the visual configurator drops these on
   * round-trip (the C1 data-loss shape). Empty unless the SDK's board schema is
   * both served and newer than this extension's model.
   */
  readonly unknownBoardKeys: readonly string[];
}

/** Input to {@link buildSchemaProvenance}. */
export interface SchemaProvenanceInput {
  readonly sdkRoot: string | null;
  readonly sdkVersion: string | null;
  /** One entry per {@link COMPARED_SCHEMA_IDS}; absent entries read as failures. */
  readonly sdkReads: Readonly<Partial<Record<VendoredSchemaId, SchemaRead>>>;
}

/**
 * sha256 over LF-normalized utf-8 bytes.
 *
 * Must stay identical to how `test/board.schema.vendored.test.js` hashes, or a
 * vendored file would not hash to its own pinned constant on a CRLF checkout.
 */
export function sha256OfSchemaText(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  return createHash("sha256").update(normalized, "utf-8").digest("hex");
}

/** A comparison plus, when the SDK's copy was accepted, its parsed body. */
interface CompareResult {
  readonly comparison: SchemaComparison;
  readonly served: Readonly<Record<string, unknown>> | null;
}

function compareOne(id: VendoredSchemaId, read: SchemaRead): CompareResult {
  const vendoredSha256 = VENDORED_SCHEMA_SHA256[id];
  const base = {
    id,
    label: VENDORED_SCHEMA_LABEL[id],
    sdkRelativePath: SDK_SCHEMA_RELATIVE_PATHS[id].sdk,
    vendoredSha256,
  } as const;

  if (!read.ok) {
    return {
      comparison: {
        ...base,
        sdkSha256: null,
        matches: false,
        unreadableReason: read.reason,
        served: "bundled",
        rejectedReason: null,
      },
      served: null,
    };
  }

  const sdkSha256 = sha256OfSchemaText(read.text);
  // Acceptance runs even when the bytes match the vendored copy. It costs one
  // JSON.parse and it keeps `served` derived from ONE rule rather than from a
  // shortcut that would go wrong the moment the vendored copy itself changed
  // shape.
  const acceptance = acceptSdkSchemaText(read.text);

  return {
    comparison: {
      ...base,
      sdkSha256,
      matches: sdkSha256 === vendoredSha256,
      unreadableReason: null,
      served: acceptance.ok ? "sdk" : "bundled",
      rejectedReason: acceptance.ok ? null : acceptance.reason,
    },
    served: acceptance.ok ? acceptance.schema : null,
  };
}

function verdict(
  sdkRoot: string | null,
  comparisons: readonly SchemaComparison[],
): SchemaProvenanceState {
  if (sdkRoot === null) return "no-sdk";
  // Both fallbacks outrank a difference, because a difference now means the
  // editor followed the SDK and a fallback means it could not. A rejection
  // outranks an unreadable sibling in turn: the file is on disk and the
  // customer can be pointed at it.
  if (comparisons.some((c) => c.rejectedReason !== null)) return "rejected";
  if (comparisons.some((c) => c.sdkSha256 === null)) return "unreadable";
  if (comparisons.some((c) => !c.matches)) return "mismatch";
  return "match";
}

/**
 * Top-level properties the served board schema declares that the configurator's
 * model does not carry.
 *
 * This is the residue #493 cannot remove. Validation follows the SDK, but
 * `parseBoardConfig`/`serializeBoardConfig` whitelist top-level keys against
 * `BOARD_KEY_ORDER` and SILENTLY DROP the rest, so an SDK newer than this
 * extension can accept a key the visual configurator then deletes on save.
 * Before #493 the editor red-squiggled such a key, which at least deterred it;
 * serving the SDK's schema removes that accident of protection, so the loss has
 * to be named instead.
 */
function unknownBoardKeysIn(
  schema: Readonly<Record<string, unknown>> | null,
): string[] {
  if (schema === null) return [];
  const properties = schema.properties;
  if (properties === null || typeof properties !== "object") return [];

  const known = new Set<string>(BOARD_KEY_ORDER as readonly string[]);
  return Object.keys(properties)
    .filter((key) => !known.has(key))
    .sort();
}

/**
 * Compare the bundled schemas against the resolved SDK's copies.
 *
 * Never throws: an SDK read that failed is carried as a comparison with a
 * reason, because the editor still has to say something truthful.
 */
export function buildSchemaProvenance(
  input: SchemaProvenanceInput,
): SchemaProvenance {
  const results = COMPARED_SCHEMA_IDS.map((id) =>
    compareOne(
      id,
      input.sdkReads[id] ?? {
        ok: false,
        reason: `${SDK_SCHEMA_RELATIVE_PATHS[id].sdk} was not read`,
      },
    ),
  );
  const comparisons = results.map((r) => r.comparison);
  const board = results.find((r) => r.comparison.id === "board");

  return {
    state: verdict(input.sdkRoot, comparisons),
    sdkRoot: input.sdkRoot,
    sdkVersion: input.sdkVersion,
    vendoredTag: VENDORED_SDK_TAG,
    comparisons,
    unknownBoardKeys: unknownBoardKeysIn(board?.served ?? null),
  };
}

/**
 * How the SDK side is named in status text.
 *
 * `VENDORED_SDK_TAG` is a git tag (`v0.15.0`) while `metadata/sdk_version.yaml`
 * carries a bare version (`version: 0.15.0`), so the two sides must be
 * normalised or the customer reads "byte-identical to the ones in 0.15.0" next
 * to "alp-sdk v0.15.0" and cannot tell they are the same release.
 */
function sdkLabel(p: SchemaProvenance): string {
  if (p.sdkVersion === null) return "your resolved SDK";
  return `alp-sdk v${p.sdkVersion.replace(/^v/, "")}`;
}

/** Text for the language-status item and the one-time notice. */
export interface SchemaProvenanceText {
  /** One line, shown inline. */
  readonly short: string;
  /** The full explanation, shown on hover or in the notice. */
  readonly detail: string;
}

/**
 * The sentence a customer needs whenever the editor could NOT follow their SDK.
 *
 * It is the pre-#493 rule, and it is now correct only on the fallback paths --
 * saying it on a healthy `mismatch` would tell the customer to distrust a
 * squiggle that came from their own SDK.
 */
const TRUST_THE_CLI =
  "Until that is fixed the editor can flag a field your own toolchain " +
  "accepts, or accept one it rejects; where they disagree, trust `tan build`.";

/**
 * The residual data-loss note, or "" when there is nothing to lose.
 *
 * Only reachable when the SDK's board schema is SERVED and declares a top-level
 * key `BOARD_KEY_ORDER` has never heard of, which in practice means an SDK
 * newer than this extension. Silence here is a real answer, not a missing one.
 */
function configuratorLoss(p: SchemaProvenance): string {
  if (p.unknownBoardKeys.length === 0) return "";
  const keys = p.unknownBoardKeys.map((k) => `\`${k}\``).join(", ");
  return (
    ` Note: that schema declares top-level ${keys}, which this extension's ` +
    `visual configurator does not model -- opening board.yaml in the ` +
    `configurator and saving DROPS those keys. Edit them as YAML.`
  );
}

/**
 * Render {@link SchemaProvenance} as customer-facing text.
 *
 * Every branch names the schema actually in force, because that is the one
 * thing a red squiggle cannot tell the customer by itself. All details are a
 * SINGLE PARAGRAPH with no newlines: the string is rendered both in a
 * language-status HOVER (which does not honour `\n`) and in the output channel,
 * and a list that reads as one run-on line in the hover is worse than
 * separators that work in both.
 */
export function describeSchemaProvenance(
  p: SchemaProvenance,
): SchemaProvenanceText {
  if (p.state === "no-sdk") {
    return {
      short: `Schema: bundled ${p.vendoredTag}`,
      detail:
        `board.yaml and system-manifest.yaml are validated against the schemas ` +
        `bundled with this extension, vendored from alp-sdk ${p.vendoredTag}. ` +
        `No SDK is resolved, so there is nothing to follow instead.`,
    };
  }

  if (p.state === "match") {
    return {
      short: `Schema: ${sdkLabel(p)}`,
      detail:
        `Validating against ${sdkLabel(p)}'s own schemas, which are ` +
        `byte-identical to the ones bundled with this extension (vendored from ` +
        `alp-sdk ${p.vendoredTag}).`,
    };
  }

  if (p.state === "unreadable") {
    const missing = p.comparisons.filter((c) => c.sdkSha256 === null);
    const reasons = missing
      .map((c) => `${c.sdkRelativePath} (${c.unreadableReason})`)
      .join("; ");
    return {
      short: `Schema: bundled ${p.vendoredTag} (SDK schema unreadable)`,
      detail:
        `Falling back to the schemas bundled with this extension ` +
        `(alp-sdk ${p.vendoredTag}) because ${sdkLabel(p)}'s own copies could ` +
        `not be read: ${reasons}. The SDK install may be incomplete. ` +
        TRUST_THE_CLI,
    };
  }

  if (p.state === "rejected") {
    const refused = p.comparisons.filter((c) => c.rejectedReason !== null);
    const reasons = refused
      .map((c) => `${c.sdkRelativePath} (${c.rejectedReason})`)
      .join("; ");
    return {
      short: `Schema: bundled ${p.vendoredTag} (SDK schema rejected)`,
      detail:
        `Falling back to the schemas bundled with this extension ` +
        `(alp-sdk ${p.vendoredTag}) because ${sdkLabel(p)}'s own copies were ` +
        `refused: ${reasons}. ` +
        TRUST_THE_CLI,
    };
  }

  const differing = p.comparisons.filter(
    (c) => c.served === "sdk" && !c.matches,
  );
  const names = differing.map((c) => c.label).join(" and ");
  return {
    short: `Schema: ${sdkLabel(p)}`,
    detail:
      `${names} ${differing.length > 1 ? "are" : "is"} validated against ` +
      `${sdkLabel(p)}'s own schema rather than the copy bundled with this ` +
      `extension (vendored from alp-sdk ${p.vendoredTag}), so the editor and ` +
      `\`tan\` agree on what is valid.` +
      configuratorLoss(p),
  };
}
