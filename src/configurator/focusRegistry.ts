// SPDX-License-Identifier: Apache-2.0
//
// The Build Plan → Board Configurator hand-off (#484).
//
// The Build Plan never writes board.yaml. When a reader wants to change an
// IPC carve-out's `carve_out_kb` or a storage partition's `size_kib`, it asks
// the host to open the Configurator — the extension's ONE board.yaml writer —
// at that entry. Opening a custom editor is asynchronous, and a webview drops
// any message posted before its script is listening, so the request is held
// here, keyed by board.yaml path, until the Configurator panel on that file
// says `ready`. It is delivered once, and only to a panel on the same file.
//
// No `vscode` import: pure state, so it is unit-tested directly.

import * as path from "path";

/** The Configurator custom editor (`contributes.customEditors`). */
export const CONFIGURATOR_VIEW_TYPE = "alp.boardConfigurator";

/** Longest entry name accepted: a board.yaml `name` is an identifier, and a
 *  request carrying more than this is not one. */
const MAX_NAME_LENGTH = 128;

/** Which entry to bring into view: an `ipc[]` or `storage[]` entry by name. */
export interface FocusEntryTarget {
  section: "ipc" | "storage";
  name: string;
}

/** Narrowed at the host boundary — the webview's message is untrusted. */
export function isFocusEntryTarget(value: unknown): value is FocusEntryTarget {
  if (typeof value !== "object" || value === null) return false;
  const { section, name } = value as { section?: unknown; name?: unknown };
  return (
    (section === "ipc" || section === "storage") &&
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= MAX_NAME_LENGTH
  );
}

type Post = (message: {
  type: "focusEntry";
  section: FocusEntryTarget["section"];
  name: string;
}) => void;

interface LivePanel {
  post: Post;
  isReady: boolean;
}

const keyOf = (boardPath: string): string => path.resolve(boardPath);

const pending = new Map<string, FocusEntryTarget>();
const panels = new Map<string, LivePanel>();

function deliver(key: string): void {
  const panel = panels.get(key);
  const target = pending.get(key);
  if (!panel || !panel.isReady || !target) return;
  pending.delete(key);
  panel.post({
    type: "focusEntry",
    section: target.section,
    name: target.name,
  });
}

/** Ask the Configurator on `boardPath` to focus `target`: now, when a ready
 *  panel is open on that file, otherwise when the next one becomes ready.
 *  A newer request replaces an undelivered older one. */
export function requestConfiguratorFocus(
  boardPath: string,
  target: FocusEntryTarget,
): void {
  const key = keyOf(boardPath);
  pending.set(key, { section: target.section, name: target.name });
  deliver(key);
}

/** Remove and return the undelivered request for `boardPath`, if any — used
 *  to withdraw it when the open itself failed. */
export function takePendingFocus(boardPath: string): FocusEntryTarget | null {
  const key = keyOf(boardPath);
  const target = pending.get(key) ?? null;
  pending.delete(key);
  return target;
}

/** Register a Configurator panel on `boardPath`. Call `ready()` once its view
 *  has rendered the board (after `configuratorRender` is posted), and
 *  `dispose()` when the panel closes. */
export function attachConfiguratorPanel(
  boardPath: string,
  post: Post,
): { ready(): void; dispose(): void } {
  const key = keyOf(boardPath);
  const panel: LivePanel = { post, isReady: false };
  panels.set(key, panel);
  return {
    ready() {
      panel.isReady = true;
      deliver(key);
    },
    dispose() {
      if (panels.get(key) === panel) panels.delete(key);
    },
  };
}
