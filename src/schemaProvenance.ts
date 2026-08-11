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
import { SDK_SCHEMA_RELATIVE_PATHS } from "@alp-sdk/core/validation/vendoredSchemas";
import { planFailure } from "./notify/service";
import { notifyAsync } from "./notify/vscodeAdapter";
import { collectProjectContext } from "./project/vscodeAdapter";
import { log } from "./util";
import type { StateManager } from "./views/stateManager";

/**
 * Says WHICH schema `board.yaml` and `system-manifest.yaml` are being
 * validated against (#493).
 *
 * `package.json`'s `contributes.yamlValidation` hands `redhat.vscode-yaml` two
 * byte-pinned snapshots of one alp-sdk tag, unconditionally. A customer on a
 * different tag therefore gets diagnostics their own `tan` does not produce --
 * or misses ones it does. This surface does not change that; it stops it being
 * silent, so a squiggle that contradicts `tan build` is adjudicable instead of
 * mysterious.
 *
 * Repainted from `StateManager.onStateChange`, which already fires on an SDK
 * switch, a workspace change and a board.yaml change -- the three ways the
 * answer can go stale.
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

/** Read the resolved SDK's copies and compare them to the bundled ones. */
export function readSchemaProvenance(): SchemaProvenance {
  const sdkRoot = collectProjectContext().sdkRoot;
  if (sdkRoot === null) {
    return buildSchemaProvenance({
      sdkRoot: null,
      sdkVersion: null,
      sdkReads: {},
    });
  }

  const readiness = checkSdkReadiness(sdkRoot, fs.existsSync, (p) => {
    try {
      return fs.readFileSync(p, "utf-8");
    } catch {
      return "";
    }
  });

  const sdkReads: Record<string, SchemaRead> = {};
  for (const id of COMPARED_SCHEMA_IDS) {
    sdkReads[id] = readText(
      path.join(sdkRoot, SDK_SCHEMA_RELATIVE_PATHS[id].sdk),
    );
  }

  return buildSchemaProvenance({
    sdkRoot,
    sdkVersion: readiness.version,
    sdkReads,
  });
}

/**
 * A stable identity for one mismatch, so the notice fires once per distinct
 * disagreement rather than once per repaint. Keyed on the SDK root and both
 * sides' hashes: switching SDKs, or the SDK changing underneath, is a NEW
 * mismatch the customer has not been told about yet.
 */
function mismatchSignature(p: SchemaProvenance): string {
  const parts = p.comparisons.map(
    (c) => `${c.id}:${c.vendoredSha256}:${c.sdkSha256 ?? "none"}`,
  );
  return `${p.sdkRoot ?? ""}|${parts.join("|")}`;
}

function severityFor(
  state: SchemaProvenance["state"],
): vscode.LanguageStatusSeverity {
  return state === "mismatch"
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
  if (provenance.state !== "mismatch") return;

  const signature = mismatchSignature(provenance);
  if (context.globalState.get<string>(NOTICE_KEY) === signature) return;
  await context.globalState.update(NOTICE_KEY, signature);

  notifyAsync(
    planFailure({
      operation: "Schema check",
      cause:
        "The bundled board.yaml schema differs from your resolved SDK's. " +
        "Where they disagree, trust the CLI over the editor.",
      detail,
      severity: "warning",
      dedupeKey: "schema-provenance-mismatch",
    }),
  );
}

/**
 * Create the language-status item and keep it current.
 *
 * Never throws: a status surface that can break activation is worse than one
 * that is occasionally absent.
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

  const refresh = (): void => {
    try {
      const provenance = readSchemaProvenance();
      const text = describeSchemaProvenance(provenance);
      item.text = text.short;
      item.detail = text.detail;
      item.severity = severityFor(provenance.state);
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
