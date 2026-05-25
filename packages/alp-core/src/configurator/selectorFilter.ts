// SPDX-License-Identifier: Apache-2.0

/**
 * Filter a catalogue of ids for a searchable selector: drop already-selected ids,
 * keep those whose id contains the (case-insensitive) query, sorted alphabetically.
 *
 * Matching is token-aware (tokens split on "_"):
 *  - Short tokens (< 5 chars): match if the token ends with the query.
 *  - Long tokens (>= 5 chars): match if the query appears within the first
 *    (q.length + 1) characters of the token, i.e. indexOf(q) <= q.length.
 */
export function filterChoices(all: string[], selected: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  const chosen = new Set(selected);

  function tokenMatches(token: string): boolean {
    if (token.length < 5) {
      return token.endsWith(q);
    }
    const idx = token.indexOf(q);
    return idx !== -1 && idx <= q.length;
  }

  function idMatches(id: string): boolean {
    return id.split("_").some(tokenMatches);
  }

  return all
    .filter((id) => !chosen.has(id) && idMatches(id))
    .sort((a, b) => a.localeCompare(b));
}
