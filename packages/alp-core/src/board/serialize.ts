// SPDX-License-Identifier: Apache-2.0

import * as yaml from "js-yaml";
import * as YAML from "yaml";
import { BoardConfig, BOARD_KEY_ORDER } from "./models";

/**
 * Emit a board.yaml document. When `priorText` is the current on-disk YAML,
 * the configurator's changes are applied onto that document in place via the
 * comment-preserving `yaml` package (parse -> set/delete only the changed
 * paths -> stringify), so comments, key order and anchors on untouched keys
 * survive. Without prior text (a brand-new file, or a document that fails to
 * parse) it falls back to a fresh dump in canonical board.schema.json order.
 * Either way the data round-trips: parseBoardConfig(serializeBoardConfig(cfg))
 * deep-equals cfg.
 */
export function serializeBoardConfig(
  cfg: BoardConfig,
  priorText?: string,
): string {
  if (priorText === undefined || priorText.trim() === "") {
    return freshDump(cfg);
  }
  const doc = YAML.parseDocument(priorText);
  if (doc.errors.length > 0 || !YAML.isMap(doc.contents)) {
    return freshDump(cfg);
  }
  const record = cfg as unknown as Record<string, unknown>;
  const present = new Set<string>();
  for (const key of BOARD_KEY_ORDER) {
    const value = record[key];
    if (value !== undefined && value !== null) {
      present.add(key);
      syncInto(doc, [key], value);
    }
  }
  // Drop only schema-known top-level keys the model no longer carries; unknown
  // keys (and their comments) are left untouched.
  const known = new Set<string>(BOARD_KEY_ORDER as string[]);
  for (const item of [...doc.contents.items]) {
    const k = String(item.key);
    if (known.has(k) && !present.has(k)) {
      doc.deleteIn([k]);
    }
  }
  return doc.toString({ lineWidth: 0 });
}

/**
 * Merge `value` into `doc` at `path`. Two maps are merged key-by-key so
 * comments on untouched keys survive (setIn on a scalar leaf keeps the key
 * node); keys absent from the new map are deleted. Scalars, arrays and type
 * changes replace the node wholesale.
 */
function syncInto(
  doc: YAML.Document,
  path: (string | number)[],
  value: unknown,
): void {
  const isObject =
    value !== null && typeof value === "object" && !Array.isArray(value);
  const existing = doc.getIn(path);
  if (isObject && YAML.isMap(existing)) {
    const oldKeys = existing.items.map((i) => String(i.key));
    const newKeys = new Set<string>();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      newKeys.add(k);
      syncInto(doc, [...path, k], v);
    }
    for (const k of oldKeys) {
      if (!newKeys.has(k)) doc.deleteIn([...path, k]);
    }
  } else {
    // Scalars, arrays and type changes replace the node wholesale — but only
    // when the value actually changed. An unchanged array (e.g. chips:/models:)
    // must be left untouched so comments inside it survive (setIn would rebuild
    // the sequence node and drop them).
    const current = YAML.isNode(existing) ? existing.toJSON() : existing;
    if (JSON.stringify(current) === JSON.stringify(value)) return;
    doc.setIn(path, yaml11Safe(doc, value, existing));
  }
}

/**
 * Characters PyYAML will not accept inside a PLAIN scalar.
 *
 * C0 controls (tab and the line breaks included), DEL, the C1 block, and the
 * Unicode line/paragraph separators. Measured against PyYAML 6.0.3 -- each of
 * these makes the WHOLE DOCUMENT unreadable rather than one field invalid:
 *
 *   TAB U+0009  ScannerError     LS U+2028  ScannerError
 *   NEL U+0085  ScannerError     PS U+2029  ScannerError
 *   DEL U+007F  ReaderError
 *
 * Checked by CHARACTER rather than by the round-trip probe below, because the
 * probe cannot see any of them -- see `misreadUnderYaml11`.
 */
// eslint-disable-next-line no-control-regex
const PLAIN_SCALAR_HAZARD = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/;

/**
 * Would a YAML 1.1 reader resolve this string to a different TYPE?
 *
 * THE DOCUMENT AND ITS READER DISAGREE ON A VERSION. The `yaml` package writes
 * YAML 1.2, where `off` is the three-letter string and needs no quotes. Every
 * consumer of board.yaml is Python -- `tan validate` shells out to
 * `scripts/validate_board_yaml.py` -- and PyYAML reads YAML 1.1, where a bare
 * `off` is the BOOLEAN false. So the one value the New Project wizard writes
 * for a core the customer set to "Off (skip core)" changed type in transit,
 * measured on the pinned tan 0.6.0-rc1 against a scaffold that had just
 * validated clean:
 *
 *   validate.schema-violation | ALP-B004: False is not of type 'string'
 *   validate.schema-violation | ALP-B003: False is not one of ['zephyr', 'yocto', 'baremetal', 'off']
 *
 * Quoting that scalar and touching nothing else returned the project to
 * `ok: true`, exit 0.
 *
 * ASKED, NOT LISTED. A hand-maintained table of 1.1 keywords goes stale -- it
 * would have to carry `y`/`n`/`yes`/`no`/`on`/`off` in every casing,
 * sexagesimals (`1:30` is 90), `0777` (511), `~` and the empty string.
 * Re-reading the rendered scalar under 1.1 asks the question directly.
 *
 * THIS COVERS TAGS ONLY, and an earlier version of this comment wrongly
 * claimed it was "a superset of the real consumer, verified token by token"
 * and could "not drift". It IS a superset for tag RESOLUTION -- it also says
 * yes for `y`, `n` and `.`, which PyYAML reads as strings, and over-quoting
 * writes the same string. It is a strict SUBSET for the LEXER: npm yaml's
 * `version: "1.1"` switches the tag schema and nothing else, so it happily
 * accepts a plain scalar holding a TAB or U+2028 that PyYAML refuses outright.
 * That gap is covered by `PLAIN_SCALAR_HAZARD` above, by character, not here.
 */
function misreadUnderYaml11(text: string): boolean {
  try {
    const probe = YAML.parse(`x: ${text}`, { version: "1.1" }) as {
      x?: unknown;
    };
    return probe?.x !== text;
  } catch {
    // Not renderable as a plain scalar at all -- quoting is right anyway.
    return true;
  }
}

/** A scalar written plain would be misread, or would break the parse. */
function needsQuoting(text: string): boolean {
  return PLAIN_SCALAR_HAZARD.test(text) || misreadUnderYaml11(text);
}

/**
 * Build the node for `value`, keeping the style the document already used and
 * forcing quotes on every string that would be misread without them.
 *
 * THE STYLE ON DISK IS CARRIED OVER, and skipping that was a defect worse than
 * the one this module fixes. `doc.setIn(path, "some string")` overwrites the
 * EXISTING Scalar's value and leaves its `type` -- the quote style already in
 * the file -- alone. `doc.createNode(value)` builds a fresh Scalar with
 * `type: undefined`, so a value the customer had written double-quoted came
 * back PLAIN. Measured on the pinned tan 0.6.0-rc1, editing a description that
 * held a TAB inside a double-quoted scalar:
 *
 *   before   description: "release\tcandidate"       ok, exit 0
 *   after    description: release<TAB>candidate v2   ALP-B000: YAML parse
 *                                                    error, exit 2
 *
 * ALP-B003/ALP-B004 reject one FIELD; that rejects the whole document.
 *
 * Quotes are then forced only where the style would otherwise be PLAIN, so a
 * block scalar the customer wrote stays a block scalar.
 *
 * Recursive because `setIn` also replaces whole arrays and maps (`ipc:`,
 * `pins:`): a trap string nested three levels down is the same defect as one
 * at the top.
 */
function yaml11Safe(
  doc: YAML.Document,
  value: unknown,
  existing: unknown,
): unknown {
  const node = doc.createNode(value);
  if (YAML.isScalar(node) && YAML.isScalar(existing) && existing.type) {
    node.type = existing.type;
  }
  YAML.visit(node, {
    Scalar(_key, scalar) {
      if (
        !scalar.type &&
        typeof scalar.value === "string" &&
        needsQuoting(scalar.value)
      ) {
        scalar.type = YAML.Scalar.QUOTE_DOUBLE;
      }
    },
  });
  return node;
}

function freshDump(cfg: BoardConfig): string {
  const ordered: Record<string, unknown> = {};
  for (const key of BOARD_KEY_ORDER) {
    const value = (cfg as unknown as Record<string, unknown>)[key];
    if (value !== undefined && value !== null) {
      ordered[key] = value;
    }
  }
  return yaml.dump(ordered, { lineWidth: 100, noRefs: true });
}
