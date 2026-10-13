// SPDX-License-Identifier: Apache-2.0
//
// "Edit in Configurator" landing (#484): the host posts `focusEntry` when the
// Build Plan asked to open this editor at one IPC link or storage partition.
// The Configurator switches to the section that holds it, scrolls its size
// field into view and briefly highlights it.
//
// It does NOT focus the field. The field is an `<input type="number">`, and
// a focused number input steps its value on ArrowUp/ArrowDown/PageUp/
// PageDown and on the mouse wheel — each step is an `onChange`, i.e. a
// silent storage resize the reader never chose. The reader clicks (or Tabs)
// into the field to edit it, like any other field. A name board.yaml
// does not declare opens the section and says so — nothing is ever created,
// and this module never writes the board.

import { useEffect, useRef, useState } from "react";
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
        String((e as { name?: unknown }).name) === target.name,
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
 * rendered, then scroll to and highlight the field once it is. Returns the
 * notice to show when the entry cannot be shown (null otherwise); the
 * notice clears when the reader moves to another section (`active`), or —
 * for a missing entry — once the board declares it.
 */
export function useFocusEntry(
  board: BoardConfig,
  loaded: boolean,
  openSection: () => void,
  active: string,
): string | null {
  const [target, setTarget] = useState<FocusTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The request the current notice is about, so a board change can tell
  // whether the notice still holds.
  const noticeFor = useRef<FocusTarget | null>(null);

  // Declared BEFORE the landing effect below, so on the commit that both
  // opens the section and lands, the landing's notice is the one that stays.
  // Cleared on a section change only — NOT on every new board object: each
  // `configuratorRender` hands over a fresh (often equal) board, and wiping
  // the notice on that would erase it a moment after it appeared.
  useEffect(() => {
    setNotice(null);
    noticeFor.current = null;
  }, [active]);

  // A board change clears the "no entry named …" notice only once the entry
  // it named actually exists.
  useEffect(() => {
    const about = noticeFor.current;
    if (about && missingEntryNotice(board, about) === null) {
      setNotice(null);
      noticeFor.current = null;
    }
  }, [board]);

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
      noticeFor.current = target;
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
