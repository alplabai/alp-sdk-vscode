// SPDX-License-Identifier: Apache-2.0

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { checkSdkReadiness } from "@alp-sdk/core/sdk/service";
import {
  COMPARED_SCHEMA_IDS,
  buildSchemaProvenance,
  describeSchemaProvenance,
  type SchemaProvenance,
  type SchemaRead,
} from "@alp-sdk/core/validation/schemaProvenance";
import {
  SDK_SCHEMA_RELATIVE_PATHS,
  type VendoredSchemaId,
} from "@alp-sdk/core/validation/vendoredSchemas";
import { planFailure } from "./notify/service";
import { notifyAsync } from "./notify/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";
import { log } from "./util";
import type { StateManager } from "./views/stateManager";

/**
 * Says WHICH schema `board.yaml` and `system-manifest.yaml` are being
 * validated against (#493).
 *
 * `package.json`'s `contributes.yamlValidation` still names two byte-pinned
 * snapshots of one alp-sdk tag, but they are now the FALLBACK:
 * `yamlSchemaContributor.ts` serves the resolved SDK's own copies ahead of
 * them. Which of the two is in force is therefore no longer inferable from the
 * manifest, and a red squiggle carries no hint of where it came from -- so this
 * surface names it.
 *
 * Repainted from `StateManager.onStateChange`. What the answer actually depends
 * on is narrow -- the resolved `sdkRoot`, the bytes of that SDK's schemas, and
 * the bundled constants -- so the events that matter are an SDK switch and a
 * workspace change. `onStateChange` also fires far more often than that
 * (`refreshState()` runs on window focus, `src/extension.ts:147-149`), which is
 * harmless: the read is two files against a `tan` spawn in the same refresh.
 */

/** The document kinds whose validation this status describes. */
const SELECTOR: vscode.DocumentSelector = [
  { language: "yaml", pattern: "**/board.yaml" },
  { language: "yaml", pattern: "**/system-manifest.yaml" },
];

/** `globalState` key holding the last mismatch already shown to the customer. */
const NOTICE_KEY = "alp.schemaProvenance.noticedMismatch";

function readText(filePath: string): SchemaRead {
  try {
    return { ok: true, text: fs.readFileSync(filePath, "utf-8") };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  }
}

/** One read of the resolved SDK's schemas, and who they belong to. */
export interface SdkSchemaSnapshot {
  readonly sdkRoot: string | null;
  readonly sdkVersion: string | null;
  readonly sdkReads: Readonly<Partial<Record<VendoredSchemaId, SchemaRead>>>;
}

/**
 * Locate the resolved SDK and read both of its schemas.
 *
 * Exported because `yamlSchemaContributor.ts` needs the same bytes to SERVE
 * that this module needs to DESCRIBE, and a second copy of the locate-and-read
 * logic is how the two surfaces would drift into disagreeing about which schema
 * is in force. They still call it separately, on the same refresh -- two small
 * `readFileSync` calls against a `tan` spawn in the same pass is not worth
 * threading shared state through activation to avoid.
 */
export function readSdkSchemas(): SdkSchemaSnapshot {
  const sdkRoot = collectProjectContext().sdkRoot;
  if (sdkRoot === null) {
    return { sdkRoot: null, sdkVersion: null, sdkReads: {} };
  }

  const readiness = checkSdkReadiness(sdkRoot, fs.existsSync, (p) => {
    try {
      return fs.readFileSync(p, "utf-8");
    } catch {
      return "";
    }
  });

  const sdkReads: Partial<Record<VendoredSchemaId, SchemaRead>> = {};
  for (const id of COMPARED_SCHEMA_IDS) {
    sdkReads[id] = readText(
      path.join(sdkRoot, SDK_SCHEMA_RELATIVE_PATHS[id].sdk),
    );
  }

  return { sdkRoot, sdkVersion: readiness.version, sdkReads };
}

/** Read the resolved SDK's copies and compare them to the bundled ones. */
export function readSchemaProvenance(): SchemaProvenance {
  return buildSchemaProvenance(readSdkSchemas());
}

/**
 * A stable identity for one mismatch, so the notice fires once per distinct
 * disagreement rather than once per repaint. Keyed on the SDK root and both
 * sides' hashes: switching SDKs, or the SDK changing underneath, is a NEW
 * mismatch the customer has not been told about yet.
 */
function mismatchSignature(p: SchemaProvenance): string {
  const parts = p.comparisons.map(
    (c) => `${c.id}:${c.vendoredSha256}:${c.sdkSha256 ?? "none"}:${c.served}`,
  );
  return `${p.sdkRoot ?? ""}|${parts.join("|")}|${p.unknownBoardKeys.join(",")}`;
}

/**
 * Which provenance answers are worth a yellow item and a one-time toast.
 *
 * `mismatch` is NOT one of them any more. Before the contributor shipped it was
 * the whole defect; now it is the feature working -- the editor followed the
 * customer's SDK -- and warning about it would train people to ignore the item.
 * What survives is the two states where the editor could not follow the SDK,
 * and the one where it did but the visual configurator would still eat a key
 * (`unknownBoardKeys`), which is silent data loss and outranks tidiness.
 */
function isActionable(provenance: SchemaProvenance): boolean {
  return (
    provenance.state === "rejected" || provenance.unknownBoardKeys.length > 0
  );
}

function severityFor(
  provenance: SchemaProvenance,
): vscode.LanguageStatusSeverity {
  return isActionable(provenance)
    ? vscode.LanguageStatusSeverity.Warning
    : vscode.LanguageStatusSeverity.Information;
}

/**
 * Tell the customer once per distinct mismatch.
 *
 * Routed through the notify seam rather than a raw toast: the seam owns
 * severity and guarantees an action, and it puts the interpolated detail (SDK
 * version, paths, hashes) in the output channel instead of the toast text. The
 * `globalState` signature is a SEPARATE guarantee from the seam's in-session
 * `dedupeKey` -- it survives a window reload, so a mismatch that is still true
 * tomorrow does not nag again.
 */
async function maybeNotify(
  context: vscode.ExtensionContext,
  provenance: SchemaProvenance,
  detail: string,
): Promise<void> {
  if (!isActionable(provenance)) return;

  const signature = mismatchSignature(provenance);
  if (context.globalState.get<string>(NOTICE_KEY) === signature) return;

  // Present BEFORE persisting. `notifyAsync` is fire-and-forget with an
  // internal catch (src/notify/vscodeAdapter.ts), so a notice that dies on a
  // shutdown cancellation is silent -- persisting first would mark it "told"
  // and it would never be shown again, in this window or any future one. The
  // language-status item is the durable surface either way; the toast is the
  // once-per-mismatch nudge.
  notifyAsync(
    planFailure({
      operation: "Schema check",
      cause:
        provenance.state === "rejected"
          ? "Your SDK's board.yaml schema could not be used, so the editor " +
            "fell back to the bundled one. Where they disagree, trust the CLI."
          : "Your SDK's board.yaml schema has fields the visual configurator " +
            "does not model, and saving there would drop them.",
      detail,
      severity: "warning",
      dedupeKey: "schema-provenance-mismatch",
    }),
  );

  await context.globalState.update(NOTICE_KEY, signature);
}

/**
 * Create the language-status item and keep it current.
 *
 * Every REPAINT is guarded: a failed read or comparison keeps the last painted
 * answer rather than replacing a true one with a wrong one, because a status
 * surface that goes wrong is worse than one that goes quiet. Creating the item
 * itself is deliberately NOT guarded -- if `createLanguageStatusItem` fails,
 * activation has bigger problems than this surface and should say so.
 */
export function createSchemaProvenanceStatus(
  context: vscode.ExtensionContext,
  stateMgr: StateManager,
): vscode.Disposable {
  const item = vscode.languages.createLanguageStatusItem(
    "alp.schemaProvenance",
    SELECTOR,
  );
  item.name = "Alp schema";
  // A Warning-severity item with nothing to click strands the customer: the
  // hover names the disagreement, the log carries the paths and hashes.
  item.command = {
    command: "alp.showOutput",
    title: "Show Alp log",
  };

  // Log on CHANGE, not on every repaint: `onStateChange` fires on window focus,
  // and an unchanged answer repeated into the channel is noise that buries the
  // one line that matters.
  let lastLogged: string | null = null;

  const refresh = (): void => {
    try {
      const provenance = readSchemaProvenance();
      const text = describeSchemaProvenance(provenance);
      item.text = text.short;
      item.detail = text.detail;
      item.severity = severityFor(provenance);

      if (provenance.state !== "match" && text.detail !== lastLogged) {
        lastLogged = text.detail;
        log(text.detail, isActionable(provenance) ? "warn" : "info");
      }

      void maybeNotify(context, provenance, text.detail);
    } catch (err) {
      // Keep whatever was last painted rather than replacing a true answer
      // with a wrong one.
      log(`Schema provenance check failed: ${err}`, "warn");
    }
  };

  refresh();
  const subscription = stateMgr.onStateChange(() => refresh());

  return new vscode.Disposable(() => {
    subscription.dispose();
    item.dispose();
  });
}
