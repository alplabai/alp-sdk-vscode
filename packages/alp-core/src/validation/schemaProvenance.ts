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
 * This module does not fix that -- it makes it VISIBLE. The fix (registering
 * the resolved SDK's schema through `redhat.vscode-yaml`'s
 * `registerContributor`) is the second half of #493 and reuses the comparison
 * built here. Until then the rule the customer needs is one sentence: when the
 * squiggle and `tan build` disagree, trust `tan build`.
 *
 * Pure by design -- callers read the files and pass the bytes in, so the
 * comparison is testable without a filesystem or a resolved SDK.
 */

import { createHash } from "crypto";

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
 * - `match`       -- every compared schema is byte-identical to the SDK's.
 * - `mismatch`    -- at least one differs. The editor and `tan` disagree.
 * - `unreadable`  -- an SDK is resolved but at least one schema could not be
 *                    read, and none of the readable ones differed. Reported
 *                    separately from `mismatch` because the customer's action
 *                    is different: a mismatch means distrust the squiggle, an
 *                    unreadable schema means the SDK install is incomplete.
 */
export type SchemaProvenanceState =
  | "no-sdk"
  | "match"
  | "mismatch"
  | "unreadable";

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

function compareOne(id: VendoredSchemaId, read: SchemaRead): SchemaComparison {
  const vendoredSha256 = VENDORED_SCHEMA_SHA256[id];
  const base = {
    id,
    label: VENDORED_SCHEMA_LABEL[id],
    sdkRelativePath: SDK_SCHEMA_RELATIVE_PATHS[id].sdk,
    vendoredSha256,
  } as const;

  if (!read.ok) {
    return {
      ...base,
      sdkSha256: null,
      matches: false,
      unreadableReason: read.reason,
    };
  }

  const sdkSha256 = sha256OfSchemaText(read.text);
  return {
    ...base,
    sdkSha256,
    matches: sdkSha256 === vendoredSha256,
    unreadableReason: null,
  };
}

function verdict(
  sdkRoot: string | null,
  comparisons: readonly SchemaComparison[],
): SchemaProvenanceState {
  if (sdkRoot === null) return "no-sdk";
  // A real difference outranks an unreadable sibling: if we KNOW one schema
  // disagrees, that is the fact the customer has to act on.
  if (comparisons.some((c) => c.sdkSha256 !== null && !c.matches)) {
    return "mismatch";
  }
  if (comparisons.some((c) => c.sdkSha256 === null)) return "unreadable";
  return "match";
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
  const comparisons = COMPARED_SCHEMA_IDS.map((id) =>
    compareOne(
      id,
      input.sdkReads[id] ?? {
        ok: false,
        reason: `${SDK_SCHEMA_RELATIVE_PATHS[id].sdk} was not read`,
      },
    ),
  );

  return {
    state: verdict(input.sdkRoot, comparisons),
    sdkRoot: input.sdkRoot,
    sdkVersion: input.sdkVersion,
    vendoredTag: VENDORED_SDK_TAG,
    comparisons,
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
 * Render {@link SchemaProvenance} as customer-facing text.
 *
 * The mismatch wording deliberately names which side to trust. A squiggle that
 * disagrees with `tan build` is worse than no squiggle if the customer cannot
 * tell which one is lying.
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
        `No SDK is resolved, so there is nothing to disagree with.`,
    };
  }

  if (p.state === "match") {
    return {
      short: `Schema: ${p.vendoredTag} (matches SDK)`,
      detail:
        `The bundled schemas are byte-identical to the ones in ${sdkLabel(p)}, ` +
        `so the editor and \`tan\` agree on what a valid board.yaml is.`,
    };
  }

  if (p.state === "unreadable") {
    // Single paragraph, no newlines: this string is rendered both in a
    // language-status HOVER (which does not honour \n) and in the output
    // channel. A list that reads as one run-on line in the hover is worse than
    // separators that work in both.
    const missing = p.comparisons.filter((c) => c.sdkSha256 === null);
    const reasons = missing
      .map((c) => `${c.sdkRelativePath} (${c.unreadableReason})`)
      .join("; ");
    return {
      short: `Schema: bundled ${p.vendoredTag} (SDK schema unreadable)`,
      detail:
        `Validating against the schemas bundled with this extension ` +
        `(alp-sdk ${p.vendoredTag}) because ${sdkLabel(p)}'s own copies could ` +
        `not be read: ${reasons}. The SDK install may be incomplete.`,
    };
  }

  const differing = p.comparisons.filter(
    (c) => c.sdkSha256 !== null && !c.matches,
  );
  const names = differing.map((c) => c.label).join(" and ");
  return {
    short: `Schema: bundled ${p.vendoredTag} differs from SDK`,
    detail:
      `The editor validates ${names} against the schema bundled with this ` +
      `extension (alp-sdk ${p.vendoredTag}), but ${sdkLabel(p)} ships a ` +
      `different one. Where the two disagree, the editor can flag a field your ` +
      `own toolchain accepts -- or accept one it rejects. ` +
      `Trust \`tan build\` over the squiggle. Tracked as #493.`,
  };
}
