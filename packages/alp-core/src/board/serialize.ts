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
    doc.setIn(path, yaml11Safe(doc, value));
  }
}

/**
 * Would a YAML 1.1 reader see something other than this string?
 *
 * THE DOCUMENT AND ITS READER DISAGREE ON A VERSION. The `yaml` package writes
 * YAML 1.2, where `off` is the three-letter string and needs no quotes. Every
 * consumer of board.yaml is Python — `tan validate` shells out to
 * `scripts/validate_board_yaml.py` — and PyYAML reads YAML 1.1, where a bare
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
 * ASKED, NOT LISTED. A hand-maintained table of 1.1 keywords is a table that
 * goes stale — it would have to carry `y`/`n`/`yes`/`no`/`on`/`off` in every
 * casing, sexagesimals (`1:30` is 90), `0777` (511), `~`, and the empty string.
 * Re-reading the rendered scalar under 1.1 asks the question directly and
 * cannot drift.
 *
 * DELIBERATELY A SUPERSET of the real consumer, verified token by token against
 * PyYAML: this says yes for `y`, `n` and `.`, which PyYAML reads as strings.
 * Over-quoting writes the same string; under-quoting writes a boolean. Only one
 * of those directions can corrupt a project, so the check errs into the safe
 * one. (`.` is why the whole document is NOT parsed as 1.1 instead: under 1.1
 * the `yaml` package resolves tan's own `app: .` to NaN and re-emits it as
 * `.nan`, silently repointing the application directory of every project.)
 */
function misreadUnderYaml11(text: string): boolean {
  try {
    const probe = YAML.parse(`x: ${text}`, { version: "1.1" }) as {
      x?: unknown;
    };
    return probe?.x !== text;
  } catch {
    // Not renderable as a plain scalar at all — quoting is right anyway.
    return true;
  }
}

/**
 * Build the node for `value`, forcing quotes on every string inside it that a
 * YAML 1.1 reader would misread.
 *
 * Recursive because `setIn` also replaces whole arrays and maps (`ipc:`,
 * `pins:`): a trap string nested three levels down is the same defect as one at
 * the top, and `board.yaml` carries free-form strings in several places.
 */
function yaml11Safe(doc: YAML.Document, value: unknown): unknown {
  const node = doc.createNode(value);
  YAML.visit(node, {
    Scalar(_key, scalar) {
      if (
        typeof scalar.value === "string" &&
        misreadUnderYaml11(scalar.value)
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
