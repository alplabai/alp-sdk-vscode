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
    doc.setIn(path, value);
  }
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
