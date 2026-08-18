// SPDX-License-Identifier: Apache-2.0

/**
 * Whether a schema shipped by the resolved SDK is safe to hand to
 * `redhat.vscode-yaml` in place of the bundled copy (#493).
 *
 * `<sdkRoot>/metadata/schemas/*.json` is a file on a path the CUSTOMER
 * controls -- `alpSdk.sdkPath` accepts any directory, and an SDK can also be
 * unpacked by hand. Serving it means the YAML language server parses it and
 * resolves its `$ref`s, so it is untrusted input in exactly the sense the issue
 * uses the phrase, and it asks for it to be treated that way.
 *
 * The bar here is deliberately low and mechanical. This is NOT schema
 * validation -- a schema that is well-formed but wrong is the SDK's business,
 * and the whole point of #493 is that the SDK, not this extension, decides what
 * a valid board.yaml is. What is rejected is only what would make the editor
 * behave WORSE than the fallback:
 *
 *  1. a file too large to be a schema (a wrong path, or a truncated download
 *     that landed on a tarball);
 *  2. text that is not a JSON object at all, which the language server would
 *     fail to load, silently leaving the file unvalidated;
 *  3. any `$ref` that leaves the document, which turns opening board.yaml into
 *     a fetch driven by a file next to the customer's SDK.
 *
 * Anything rejected falls back to the vendored copy -- the same path a customer
 * with no SDK takes -- so a rejection degrades to today's behaviour rather than
 * to no validation at all.
 */

/**
 * Largest SDK schema this will serve, in UTF-16 code units.
 *
 * The two real schemas are far smaller (board.schema.json is ~60 KB at
 * v0.15.0), so the cap only ever fires on something that is not a schema.
 * Measured in code units rather than bytes because the caller has already
 * decoded the file; the difference cannot matter three orders of magnitude
 * below the limit.
 */
export const MAX_SDK_SCHEMA_LENGTH = 4 * 1024 * 1024;

/** Why an SDK schema was refused, or the parsed schema when it was accepted. */
export type SchemaAcceptance =
  | { readonly ok: true; readonly schema: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly reason: string };

/**
 * The only `$ref` shape that cannot leave the document: a local JSON pointer.
 *
 * Checking for `http(s)` instead would MISS the case that actually reaches the
 * network here. Both real schemas carry
 * `"$id": "https://github.com/alplabai/alp-sdk/metadata/schemas/<name>.json"`,
 * so a RELATIVE ref like `"other.json"` resolves against that base and is
 * fetched -- and a `file://` ref would read an arbitrary local path into the
 * customer's diagnostics. Measured at v0.15.0: every `$ref` in
 * `board.schema.json` and `system-manifest-v1.schema.json` is `#/$defs/...`,
 * so nothing legitimate is refused by requiring the leading `#`.
 */
const LOCAL_POINTER_REF = /^#/;

/**
 * Every `$ref` string anywhere in the parsed value.
 *
 * Iterative rather than recursive, and with a seen-set, because the input is
 * untrusted: a deeply nested document must not blow the stack on the way to
 * being rejected. `JSON.parse` cannot produce a cycle, but the seen-set also
 * keeps a heavily shared structure from being walked repeatedly.
 */
function collectRefs(root: unknown): string[] {
  const refs: string[] = [];
  const seen = new Set<unknown>();
  const stack: unknown[] = [root];

  while (stack.length > 0) {
    const node = stack.pop();
    if (node === null || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);

    if (Array.isArray(node)) {
      stack.push(...node);
      continue;
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") refs.push(value);
      if (value !== null && typeof value === "object") stack.push(value);
    }
  }

  return refs;
}

/**
 * Decide whether `text` may be served to the YAML language server.
 *
 * Never throws: a refusal is a normal outcome carried as a reason, because the
 * caller's job is to fall back and say why, not to fail.
 */
export function acceptSdkSchemaText(text: string): SchemaAcceptance {
  if (text.length > MAX_SDK_SCHEMA_LENGTH) {
    return {
      ok: false,
      reason:
        `it is ${text.length} characters, past the ${MAX_SDK_SCHEMA_LENGTH} ` +
        `limit for a schema file`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `it is not valid JSON (${detail})` };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "its top level is not a JSON object" };
  }

  const external = collectRefs(parsed).filter(
    (ref) => !LOCAL_POINTER_REF.test(ref),
  );
  if (external.length > 0) {
    return {
      ok: false,
      reason:
        `it points outside itself ($ref ${external[0]}), which would make ` +
        `opening this file fetch that location`,
    };
  }

  return { ok: true, schema: parsed as Record<string, unknown> };
}
