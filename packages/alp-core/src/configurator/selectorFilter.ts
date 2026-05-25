// SPDX-License-Identifier: Apache-2.0

/**
 * Filter a catalogue of ids for a searchable selector: drop already-selected ids,
 * keep those whose id contains the (case-insensitive) query as a substring, sorted
 * alphabetically. Plain substring match — the right behaviour for a library/chip search.
 */
export function filterChoices(all: string[], selected: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  const chosen = new Set(selected);
  return all
    .filter((id) => !chosen.has(id) && id.toLowerCase().includes(q))
    .sort((a, b) => a.localeCompare(b));
}
