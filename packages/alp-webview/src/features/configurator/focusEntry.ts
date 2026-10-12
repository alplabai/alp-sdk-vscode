// SPDX-License-Identifier: Apache-2.0
//
// "Edit in Configurator" landing (#484): the host posts `focusEntry` when the
// Build Plan asked to open this editor at one IPC link or storage partition.
// The Configurator switches to the section that holds it, scrolls its size
// field into view, focuses it and briefly highlights it. A name board.yaml
// does not declare opens the section and says so — nothing is ever created,
// and this module never writes the board.

import { useEffect, useState } from "react";
import type { BoardConfig } from "../../types";
import { onMessage } from "../../vscode";

export interface FocusTarget {
  section: "ipc" | "storage";
  name: string;
}

/** How long the landed-on field stays highlighted. */
const HIGHLIGHT_MS = 1600;

/** The `data-focus-entry` value an entry's size field carries. */
export const focusKeyOf = (section: FocusTarget["section"], name: string) =>
  `${section}:${name}`;

/** Null when `board` declares the entry; otherwise the sentence to show. */
export function missingEntryNotice(
  board: BoardConfig,
  target: FocusTarget,
): string | null {
  const list = (board as Record<string, unknown>)[target.section];
  const declared =
    Array.isArray(list) &&
    list.some(
      (e) =>
        typeof e === "object" &&
        e !== null &&
        (e as { name?: unknown }).name === target.name,
    );
  if (declared) return null;
  return (
    `board.yaml declares no ${target.section} entry named "${target.name}" — ` +
    "nothing was created."
  );
}

/** The element whose `data-focus-entry` equals `key`, compared as a string —
 *  the name is never spliced into a selector. */
export function findFocusElement(
  root: Pick<ParentNode, "querySelectorAll">,
  key: string,
): Element | null {
  for (const el of Array.from(root.querySelectorAll("[data-focus-entry]"))) {
    if (el.getAttribute("data-focus-entry") === key) return el;
  }
  return null;
}

/**
 * Listen for `focusEntry`, call `openSection` so the entry's section is
 * rendered, then land on the field once it is. Returns the notice to show
 * when the entry is not declared (null otherwise).
 */
export function useFocusEntry(
  board: BoardConfig,
  loaded: boolean,
  openSection: () => void,
): string | null {
  const [target, setTarget] = useState<FocusTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(
    () =>
      onMessage((msg) => {
        if (msg.type !== "focusEntry") return;
        openSection();
        setNotice(null);
        setTarget({ section: msg.section, name: msg.name });
      }),
    [openSection],
  );

  // Keyed on the request and on the board having loaded — NOT on the board
  // itself, or every keystroke in the form would land the focus again. The
  // request object is new per message, so a repeat request re-runs this.
  useEffect(() => {
    if (!target || !loaded) return;
    const missing = missingEntryNotice(board, target);
    if (missing) {
      setNotice(missing);
      return;
    }
    const el = findFocusElement(
      document,
      focusKeyOf(target.section, target.name),
    );
    if (!(el instanceof HTMLElement)) {
      // Declared, but its field is not on screen — the form is showing a
      // parse error or has no SDK catalogue. Say so rather than do nothing.
      setNotice(
        `The ${target.section} entry "${target.name}" is in board.yaml, but ` +
          "its field is not shown right now.",
      );
      return;
    }
    el.scrollIntoView({ block: "center" });
    el.focus();
    el.setAttribute("data-focus-flash", "");
    const timer = setTimeout(
      () => el.removeAttribute("data-focus-flash"),
      HIGHLIGHT_MS,
    );
    return () => {
      clearTimeout(timer);
      el.removeAttribute("data-focus-flash");
    };
  }, [target, loaded]);

  return notice;
}
