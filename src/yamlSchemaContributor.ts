// SPDX-License-Identifier: Apache-2.0

import * as vscode from "vscode";
import { buildSchemaProvenance } from "@alp-sdk/core/validation/schemaProvenance";
import {
  ALP_SCHEMA_SCHEME,
  EMPTY_SCHEMA_OFFER,
  buildSchemaOffer,
  offeredUriForResource,
  type SchemaOffer,
} from "@alp-sdk/core/validation/schemaContribution";
import { readSdkSchemas } from "./schemaProvenance";
import { log } from "./util";
import type { StateManager } from "./views/stateManager";

/**
 * Validate `board.yaml` and `system-manifest.yaml` against the RESOLVED SDK's
 * schemas, with the vendored copies demoted to the no-SDK fallback (#493).
 *
 * `contributes.yamlValidation` is static package.json metadata, so the only way
 * to make validation a function of the resolved SDK is `redhat.vscode-yaml`'s
 * `registerContributor`. Its contract shapes everything here, and the reasoning
 * lives next to the pure half in `@alp-sdk/core/validation/schemaContribution`.
 * The three constraints that shape THIS file:
 *
 *  * the answer callback is SYNCHRONOUS, so it cannot read a file -- it answers
 *    from `offer`, which is refreshed on state change;
 *  * there is NO unregister, so registration happens once and an SDK switch
 *    changes the ANSWER, not the registration;
 *  * the client caches schema content by uri, so content is kept keyed by the
 *    hash-stamped uri rather than by schema id. A uri is content-addressed:
 *    the same uri always means the same bytes, so retaining a previous SDK's
 *    entry is a cache, not staleness.
 *
 * Known gap, not closable from here: the provider is consulted per validation
 * pass and vscode-yaml exposes no "revalidate now", so after an SDK switch an
 * OPEN, UNEDITED board.yaml keeps its previous diagnostics until its next
 * edit, save, or reopen. Every other document picks up the new schema at once.
 */

/** The extension whose API is the only route to dynamic schema association. */
export const YAML_EXTENSION_ID = "redhat.vscode-yaml";

/**
 * How many distinct schema bodies to keep addressable.
 *
 * Two schemas per SDK, so this holds the current SDK plus three previous ones.
 * It must stay ABOVE one offer's size, which is what makes plain oldest-first
 * eviction safe: the current offer's entries are always the newest insertions,
 * so eviction can never reach the schema actually in force. An evicted uri can
 * only be one the client cached from an SDK the customer has since left, and if
 * it somehow asks again the miss falls back to the bundled copy, not to
 * nothing.
 */
const MAX_RETAINED_SCHEMAS = 8;

/** The slice of vscode-yaml's exported API this uses. */
interface YamlSchemaApi {
  registerContributor(
    scheme: string,
    requestSchema: (resource: string) => string | undefined,
    requestSchemaContent: (uri: string) => string | undefined,
    label?: string,
  ): boolean;
}

/** Insert the offer's bodies, then evict oldest-first down to the cap. */
function retainOffer(retained: Map<string, string>, offer: SchemaOffer): void {
  for (const [uri, text] of Object.entries(offer.contentByUri)) {
    // Delete first so re-inserting moves the entry to the newest position;
    // Map iteration order is insertion order. This is also what keeps the
    // current offer out of eviction's reach without a special case for it.
    retained.delete(uri);
    retained.set(uri, text);
  }

  for (const uri of [...retained.keys()]) {
    if (retained.size <= MAX_RETAINED_SCHEMAS) break;
    retained.delete(uri);
  }
}

/**
 * Register the contributor and keep its answer current.
 *
 * Registration is async (the YAML extension must be activated first) but the
 * disposable is returned synchronously, so activation can push it into
 * `context.subscriptions` without awaiting. Until registration completes the
 * bundled schemas are in force -- the same state as a customer with no SDK.
 */
export function createSdkSchemaContributor(
  stateMgr: StateManager,
): vscode.Disposable {
  let offer: SchemaOffer = EMPTY_SCHEMA_OFFER;
  let disposed = false;
  const retained = new Map<string, string>();

  const refresh = (): void => {
    try {
      const snapshot = readSdkSchemas();
      const provenance = buildSchemaProvenance(snapshot);
      offer = buildSchemaOffer(provenance, snapshot.sdkReads);
      retainOffer(retained, offer);
    } catch (err) {
      // Keep the previous answer rather than flapping the customer's
      // diagnostics. "No SDK", "unreadable" and "rejected" all come back as an
      // ordinary empty offer through the code above -- reaching this catch
      // means our own code failed, and the last good answer beats a guess.
      log(`SDK schema offer refresh failed: ${err}`, "warn");
    }
  };

  refresh();
  const subscription = stateMgr.onStateChange(() => refresh());

  // `undefined`, never a falsy string: vscode-yaml pushes any truthy answer and
  // treats the empty list as "fall back to contributes.yamlValidation".
  const requestSchema = (resource: string): string | undefined => {
    if (disposed) return undefined;
    return offeredUriForResource(offer, resource) ?? undefined;
  };

  const requestSchemaContent = (uri: string): string | undefined =>
    retained.get(uri);

  void registerContributor(requestSchema, requestSchemaContent);

  return new vscode.Disposable(() => {
    disposed = true;
    subscription.dispose();
    retained.clear();
  });
}

/**
 * Hand the callbacks to vscode-yaml.
 *
 * Every failure here degrades to the bundled schemas, which is why none of them
 * throws: the customer keeps the validation they had before #493 rather than
 * losing validation altogether. They are all logged, because "why is the editor
 * using the old schema" is otherwise unanswerable.
 */
async function registerContributor(
  requestSchema: (resource: string) => string | undefined,
  requestSchemaContent: (uri: string) => string | undefined,
): Promise<void> {
  try {
    const extension =
      vscode.extensions.getExtension<YamlSchemaApi>(YAML_EXTENSION_ID);
    if (!extension) {
      // `extensionDependencies` lists it, so VS Code installs and activates it
      // ahead of us -- absence means a host that ignored that, not a race.
      log(
        `${YAML_EXTENSION_ID} is not present, so board.yaml is validated ` +
          `against the schemas bundled with this extension.`,
        "warn",
      );
      return;
    }

    const api = await extension.activate();
    if (typeof api?.registerContributor !== "function") {
      log(
        `${YAML_EXTENSION_ID} exposes no registerContributor, so board.yaml is ` +
          `validated against the schemas bundled with this extension.`,
        "warn",
      );
      return;
    }

    // No `label` argument on purpose: vscode-yaml turns it into a regex it
    // matches against the DOCUMENT TEXT, which would tie schema selection to
    // file contents instead of file name.
    const ok = api.registerContributor(
      ALP_SCHEMA_SCHEME,
      requestSchema,
      requestSchemaContent,
    );
    if (!ok) {
      // There is no unregister, so a scheme taken by an earlier activation of
      // this same extension stays bound to that activation's callbacks.
      log(
        `The ${ALP_SCHEMA_SCHEME} schema scheme is already registered; ` +
          `board.yaml falls back to the bundled schemas. Reload the window.`,
        "warn",
      );
      return;
    }

    log(`Registered the ${ALP_SCHEMA_SCHEME} schema contributor.`);
  } catch (err) {
    log(`Could not register the SDK schema contributor: ${err}`, "warn");
  }
}
