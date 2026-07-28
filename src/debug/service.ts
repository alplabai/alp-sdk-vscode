// SPDX-License-Identifier: Apache-2.0
//
// ── The extension edits launch.json here, and ONLY here ─────────────────────
//
// #387's whole point was that `tan` is the single writer of launch.json, and
// the extension has had no writer since: the `writeFileSync` in
// `./vscodeAdapter.ts` is the support bundle, and `launchJsonPath` had no live
// caller at all. This module puts one bounded edit back — through
// `./launchJsonFile.ts`, the one seam that touches the file. It is an
// exception, not a repeal, and it has to keep reading as one.
//
// WHAT IT IS. Data repair on a file the customer already owns. It moves values
// between two configurations that ALREADY EXIST in that file and deletes one
// of them. It composes nothing — no draft, no defaults, not one key or value
// this module invented; everything it writes was already in the file. The one
// fact it cannot derive, which of `ALP:` / `Alp:` the currently pinned tan
// maintains, it LEARNS from `tan debug-config --preview` instead of guessing
// (see `maybeRescueOrphanedLaunchConfig` in ../debug.ts). The extension is
// still not an author of debug configurations.
//
// WHY IT EXISTS. The configuration `name` is tan's merge key. tan v0.4.0 — the
// tag `SUPPORTED_CLI_VERSION` pins — writes `ALP: …`, while the extension-side
// writer that #387 deleted wrote `Alp: …`. So on a launch.json that predates
// #387 the merge finds no match and APPENDS, and the customer is left with the
// `"device": "AE822F4M55_HP"` they were told to fill in stranded on an entry
// nothing maintains, while the entry F5 actually uses still says
// `<resolved-device>`. Deleting the stale one by hand loses the value; keeping
// it leaves a permanent duplicate. The repair runs in BOTH directions because
// tan `dev` renames back to `Alp:` post-#155, which strands an `ALP:` entry on
// every machine now on v0.4.0 — the same defect, mirrored.
//
// WHAT BOUNDS IT. One offer per workspace until the customer answers it, never
// applied without them accepting, and only when a pair really exists AND a
// concrete value really is at risk. A repair removes the orphan, so the pair it
// repaired is gone — but a file holding THREE entries with the same suffix (two
// share a spelling, which only a hand-paste produces) pairs two of them and
// leaves the third, and needs a second pass. It gets one, because dismissing
// the offer does not silence it (../debug.ts): the next activation sees the
// remaining pair and asks again. Each pass moves values and deletes nothing
// that was not merged first, so a partial repair loses nothing.
//
// HOW IT ENDS. alplabai/tan-cli#169 asks tan to do this inside its own writer,
// which is where it belongs — that would also cover someone running
// `tan debug-config` from a terminal with no extension installed, which this
// module can never reach. This is the bridge until that ships, and it should
// be deleted when it does.

import { launchConfigPlaceholders } from "../alpCli/service";

type JsonObject = Record<string, unknown>;

/** The two prefixes that have ever led a generated Alp debug configuration.
 *  Anything else is a name neither tan nor this extension wrote. */
const ALP_PREFIX = /^(ALP|Alp):/;

/** Two configurations in one `launch.json` whose names differ ONLY by the
 *  `ALP:` / `Alp:` spelling, and between which something concrete is at stake.
 *  Index order is FILE order and says nothing about which half is maintained —
 *  only the pinned CLI knows that (`planOrphanRescue`). */
export interface RescuablePair {
  firstIndex: number;
  secondIndex: number;
}

export interface RescuedPair {
  keptName: string;
  removedName: string;
  /** Keys whose value moved off the removed entry onto the kept one. EMPTY is
   *  a real outcome, not a bug: an orphan holding only placeholders loses
   *  nothing by being removed. That is precisely the case a naive "copy
   *  everything across" gets wrong, by overwriting a good value with a
   *  placeholder. */
  movedKeys: string[];
  /** Keys where BOTH entries held a concrete value and the two differed, so the
   *  kept entry's own value stood and the removed entry's was DISCARDED rather
   *  than moved. The surviving value is the one F5 already used, which is why
   *  it wins — but a value the customer filled in by hand can end up here, and
   *  a repair that deletes one without naming it is the data loss this module
   *  exists to prevent. Every caller must say these out loud. */
  discardedKeys: string[];
}

export interface OrphanRescue {
  /** The whole document to write back — every key outside `configurations`,
   *  and every configuration this repair did not touch, carried through
   *  untouched. */
  document: JsonObject;
  pairs: RescuedPair[];
}

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

/** The `configurations` array, or null for a document that has none. A file
 *  that does not exist, does not parse, or has no array here is NORMAL — every
 *  caller must treat it as "nothing to do", never as an error. */
function configurationsOf(document: unknown): unknown[] | null {
  const configurations = asObject(document)?.configurations;
  return Array.isArray(configurations) ? configurations : null;
}

/** A configuration's `name`, but only when it is one of ours. */
function alpNameOf(entry: unknown): string | null {
  const name = asObject(entry)?.name;
  return typeof name === "string" && ALP_PREFIX.test(name) ? name : null;
}

/**
 * "The customer set this deliberately, or a real build resolved it": present,
 * non-null, and free of `<…>` placeholders anywhere inside it.
 *
 * The test is `launchConfigPlaceholders`, the repo's ONE placeholder
 * predicate, so what this calls concrete can never drift from what the
 * preflight check calls unresolved. Reusing the narrow `<resolved-` version
 * would have read a Yocto orphan's `<host>:<port>` as a real address and
 * overwritten a good one with it.
 */
function isConcrete(value: unknown): boolean {
  return (
    value !== undefined &&
    value !== null &&
    launchConfigPlaceholders(value).length === 0
  );
}

/** Structural equality, for telling "the removed entry's value was DISCARDED"
 *  apart from "both entries said the same thing". Both sides came out of one
 *  `JSON.parse` of one file, so key order is the file's order on both and a
 *  string compare answers it. */
function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * tan's array branch of `merge_value` (`crates/tan-core/src/debug_launch.rs`),
 * which exists precisely so a hand-added second `.cfg` is not lost.
 *
 * It is NOT a refinement of the per-key rule, it is load-bearing on its own:
 * `isConcrete` reads an array as ONE opaque value, so a cortex-debug
 * `configFiles` holding an unresolved board `.cfg` next to a hand-added
 * `interface/stlink-v2-1.cfg` is "not concrete" as a whole — and without this
 * the whole array, hand-added entry included, is deleted with the orphan.
 *
 * THE RULE IS TAN'S, PORTED, NOT A PER-INDEX MERGE. `merge_value`
 * (`crates/tan-core/src/debug_launch.rs` on tag v0.4.0) reads, for the array
 * case: *"an all-placeholder incoming list keeps the existing list WHOLE, or a
 * hand-added second `.cfg` is lost to a per-index merge against a one-element
 * draft. A mixed list still merges per element, so an entry we did resolve
 * wins."*
 *
 * Direction matters and is easy to get backwards. In tan, `existing` is the
 * customer's file and `next` is the fresh draft. Here the ORPHAN is the
 * customer's data and the MAINTAINED entry is what the draft produced, so
 * orphan plays `existing` and maintained plays `next`.
 *
 * A per-index merge was written here first and it was worse than the bug it
 * replaced. Driven, with the interface cfg first — cortex-debug's own
 * documented order — orphan `["interface/stlink-v2-1.cfg", "<resolved-…>"]`
 * against maintained `["<resolved-…>"]` produced `["interface/stlink-v2-1.cfg"]`:
 * the interface cfg written into the board-cfg slot, the array truncated, the
 * board cfg gone. openocd then starts with no target, `launchConfigPlaceholders`
 * returns `[]` so the preflight calls it launchable, and tan never repairs it
 * because its own array branch returns the existing list whole. Permanent, and
 * it looks fine.
 *
 * Null when nothing on the orphan's side travels, so the caller leaves the
 * maintained array exactly as it is and reports no moved key.
 */
function mergeArrays(
  maintained: unknown[],
  orphan: unknown[],
): { merged: unknown[]; moved: boolean; discarded: boolean } | null {
  // tan's first branch: the incoming (maintained) list is entirely
  // placeholders, so the customer's list survives intact — every element,
  // including the placeholder slots tan still needs in order to fill them in
  // later. Filling those slots here is what destroyed the board cfg.
  if (
    maintained.length > 0 &&
    orphan.length > 0 &&
    maintained.every((item) => !isConcrete(item))
  ) {
    return sameItems(maintained, orphan)
      ? null
      : { merged: [...orphan], moved: true, discarded: false };
  }

  // tan's second branch: merge per element, result length follows the
  // maintained list exactly as tan's does. Anything past its end is therefore
  // DROPPED rather than appended — tan behaves the same way, and the caller
  // names it to the customer instead of losing it quietly.
  let moved = false;
  const merged = maintained.map((item, index) => {
    if (isConcrete(item) || !isConcrete(orphan[index])) return item;
    moved = true;
    return orphan[index];
  });
  const discarded = orphan
    .slice(maintained.length)
    .some((item) => isConcrete(item));
  if (!moved && !discarded) return null;
  return { merged, moved, discarded };
}

/** Element-wise equality for the two shallow string-ish lists this handles. */
function sameItems(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/**
 * Fold one orphan onto the entry the pinned CLI maintains — tan's `merge_value`
 * rule, ALL THREE of its branches, and the one place this module states it.
 * `findRescuablePairs` decides what to offer by running this rather than
 * re-typing the rule, so detection can never come to think something is at risk
 * that the merge then drops, or the reverse.
 *
 * Key order follows the maintained entry with new keys appended, which is also
 * what tan's writer does.
 */
function mergeOrphanInto(
  maintained: JsonObject,
  orphan: JsonObject,
): { merged: JsonObject; movedKeys: string[]; discardedKeys: string[] } {
  const merged: JsonObject = { ...maintained };
  const movedKeys: string[] = [];
  const discardedKeys: string[] = [];

  for (const [key, value] of Object.entries(orphan)) {
    // ARRAYS FIRST — see `mergeArrays`. Guarded on both sides being arrays,
    // exactly as tan guards its own array branch; an orphan array landing on a
    // key the maintained entry does not have falls through to the rule below
    // and is refused if it holds any placeholder.
    const existing = merged[key];
    if (Array.isArray(value) && Array.isArray(existing)) {
      const outcome = mergeArrays(existing, value);
      if (outcome) {
        merged[key] = outcome.merged;
        // Only when something actually travelled. The maintained list can win
        // outright and still drop a tail element, and reporting that key as
        // BOTH moved and discarded is a sentence the customer cannot act on.
        if (outcome.moved) movedKeys.push(key);
        // An element past the maintained list's end is dropped by tan's own
        // per-element branch. Naming it is the difference between a migration
        // and a quiet deletion: the file is rewritten in place with no backup,
        // so a `board/hand-written.cfg` that vanishes unmentioned is
        // unrecoverable and the customer has no reason to look.
        if (outcome.discarded) discardedKeys.push(key);
      }
      continue;
    }

    // A placeholder never travels. Not merely "never overwrites" — never
    // travels at all, because the maintained entry may not have the key. tan
    // REMOVES `svdFile`/`svdPath` when no SVD resolved, on the grounds that a
    // path which does not exist makes cortex-debug fail on start; re-inserting
    // the orphan's `<resolved-svd>` would hand that failure straight back.
    if (!isConcrete(value)) continue;

    // A concrete value already on the maintained entry outranks the orphan's,
    // which is what makes running this after a real build safe — the survivor
    // is what F5 already used. The orphan's is then DISCARDED, and `name` is
    // the one key for which that is not news: it IS tan's merge key, the two
    // spellings are the whole reason this pair exists, and copying it across
    // would rebuild the orphan under the survivor's identity.
    if (isConcrete(existing)) {
      if (key !== "name" && !sameValue(value, existing))
        discardedKeys.push(key);
      continue;
    }

    merged[key] = value;
    movedKeys.push(key);
  }

  return { merged, movedKeys, discardedKeys };
}

/**
 * True when hand-deleting either half of the pair would lose something: some
 * key holds a value on one side that the merge would carry onto the other.
 *
 * Two entries that differ ONLY in the prefix spelling put nothing at risk, and
 * are deliberately NOT reported. A duplicate with no stranded value is a
 * cosmetic complaint, and this repair is not worth interrupting anyone over
 * one. Neither is a pair whose only difference is two DIFFERENT concrete
 * values: no merge direction can move one without discarding the other, so
 * saying nothing loses nothing, while offering would not.
 */
function valueAtRisk(first: JsonObject, second: JsonObject): boolean {
  return (
    mergeOrphanInto(first, second).movedKeys.length > 0 ||
    mergeOrphanInto(second, first).movedKeys.length > 0
  );
}

/**
 * The `ALP:` / `Alp:` pairs in a parsed `launch.json` that are worth repairing.
 *
 * This is the DETECTION path and it is offline by design — a parse and two
 * loops, no CLI, no prompt. Which half is maintained is not decided here and
 * cannot be: that answer costs a `tan debug-config --preview` run, and asking
 * for it before the customer has accepted anything is exactly the intrusion
 * this repair is meant to avoid.
 */
export function findRescuablePairs(document: unknown): RescuablePair[] {
  const configurations = configurationsOf(document);
  if (!configurations) return [];

  const pairs: RescuablePair[] = [];
  const paired = new Set<number>();
  for (let i = 0; i < configurations.length; i += 1) {
    if (paired.has(i)) continue;
    const first = alpNameOf(configurations[i]);
    if (!first) continue;
    for (let j = i + 1; j < configurations.length; j += 1) {
      if (paired.has(j)) continue;
      const second = alpNameOf(configurations[j]);
      // An IDENTICAL name means tan's own merge key did its job — no split, so
      // nothing here to repair. Only a differing prefix over the same
      // remainder is the orphan this module exists for. tan never writes a
      // same-name duplicate, but a customer can hand-paste one, and without
      // this they would be offered a repair that `planOrphanRescue` then
      // refuses (it cannot tell which of two identical names is maintained) —
      // a prompt that does nothing, on their file, which is worse than
      // silence.
      if (!second || second === first) continue;
      if (second.replace(ALP_PREFIX, "") !== first.replace(ALP_PREFIX, "")) {
        continue;
      }
      const firstEntry = asObject(configurations[i]);
      const secondEntry = asObject(configurations[j]);
      if (!firstEntry || !secondEntry) continue;
      if (!valueAtRisk(firstEntry, secondEntry)) continue;

      pairs.push({ firstIndex: i, secondIndex: j });
      paired.add(i);
      paired.add(j);
      break;
    }
  }
  return pairs;
}

/**
 * Fold each orphan's concrete values onto the entry the pinned tan maintains
 * and drop the orphan, returning the whole document to write back. Null when
 * there is nothing to repair — including a `maintainedConfigName` whose prefix
 * is neither spelling, which is a tan this build does not know.
 *
 * `maintainedConfigName` is `data.configuration.name` from a real
 * `tan debug-config` run. Only its PREFIX is read: every draft tan emits
 * carries the same one, and the prefix is the entire question.
 *
 * The merge is `mergeOrphanInto` — tan's `merge_value` rule, all three of its
 * branches. Keys the orphan carries and the maintained entry does not (a
 * `myOwnKey` the customer added, which tan itself preserves) come across.
 *
 * Where both entries hold a DIFFERENT concrete value the maintained one stands
 * and the orphan's is dropped; those keys come back in `discardedKeys` and the
 * caller has to say so, because that is a value the customer may have typed.
 */
export function planOrphanRescue(
  document: unknown,
  maintainedConfigName: string,
): OrphanRescue | null {
  const maintainedPrefix = ALP_PREFIX.exec(maintainedConfigName)?.[1];
  const root = asObject(document);
  const configurations = configurationsOf(document);
  if (!maintainedPrefix || !root || !configurations) return null;

  const replaced = new Map<number, JsonObject>();
  const dropped = new Set<number>();
  const pairs: RescuedPair[] = [];

  for (const pair of findRescuablePairs(document)) {
    const prefixAt = (index: number): string | undefined =>
      ALP_PREFIX.exec(alpNameOf(configurations[index]) ?? "")?.[1];
    const firstIsMaintained = prefixAt(pair.firstIndex) === maintainedPrefix;
    const secondIsMaintained = prefixAt(pair.secondIndex) === maintainedPrefix;
    // Both halves the same answer means there is no orphan to pick: which one
    // the CLI would maintain is unknowable, so the pair is left exactly as it
    // is rather than repaired in a guessed direction.
    //
    // UNREACHABLE while `findRescuablePairs` refuses a pair whose two names
    // are IDENTICAL — a pair whose names differ must carry one spelling each,
    // so exactly one matches. It is kept because this branch is what DELETES a
    // configuration the customer has, and the two files would otherwise have
    // to be re-read together to see that it is safe. A mutation test proves it
    // stays unreachable rather than that it fires; the reachable half of the
    // same defence is the `maintainedPrefix` return above, which IS exercised.
    if (firstIsMaintained === secondIsMaintained) continue;

    const maintainedIndex = firstIsMaintained
      ? pair.firstIndex
      : pair.secondIndex;
    const orphanIndex = firstIsMaintained ? pair.secondIndex : pair.firstIndex;
    const maintained = asObject(configurations[maintainedIndex]);
    const orphan = asObject(configurations[orphanIndex]);
    if (!maintained || !orphan) continue;

    const { merged, movedKeys, discardedKeys } = mergeOrphanInto(
      maintained,
      orphan,
    );

    replaced.set(maintainedIndex, merged);
    dropped.add(orphanIndex);
    pairs.push({
      keptName: String(maintained.name),
      removedName: String(orphan.name),
      movedKeys,
      discardedKeys,
    });
  }

  if (pairs.length === 0) return null;

  return {
    document: {
      ...root,
      // `map` keeps the array length, so `filter`'s index still addresses the
      // same entries `dropped` was built from.
      configurations: configurations
        .map((entry, index) => replaced.get(index) ?? entry)
        .filter((_, index) => !dropped.has(index)),
    },
    pairs,
  };
}
