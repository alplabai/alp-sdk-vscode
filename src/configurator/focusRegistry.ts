// SPDX-License-Identifier: Apache-2.0
//
// The Build Plan → Board Configurator hand-off (#484).
//
// The Build Plan never writes board.yaml. When a reader wants to change an
// IPC carve-out's or a storage partition's size, it asks the host to open the
// Configurator — the extension's ONE board.yaml writer — at that entry.
// Opening a custom editor is asynchronous, and a webview drops any message
// posted before its script is listening, so the request is held here, keyed
// by board.yaml path, and delivered once:
//
//  - to a NEW panel, when it reports `ready`;
//  - to a panel that was ALREADY ready, when the open resolves
//    (`deliverPendingFocus`), so the tab is visible when it scrolls.
//
// A request never outlives its moment: a panel disposed before it was ready
// takes its request with it, and one older than `FOCUS_REQUEST_TTL_MS` is
// dropped rather than landing on an unrelated later open.
//
// No `vscode` import: pure state, so it is unit-tested directly.

import * as path from "path";

/** The Configurator custom editor (`contributes.customEditors`). */
export const CONFIGURATOR_VIEW_TYPE = "alp.boardConfigurator";

/** How long an undelivered focus request stays valid. */
export const FOCUS_REQUEST_TTL_MS = 30_000;

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

interface Pending {
  target: FocusEntryTarget;
  at: number;
  token: number;
}

/** Identifies one request, so withdrawing it cannot remove a newer one. */
export type FocusRequestToken = number;

export interface FocusRegistry {
  requestConfiguratorFocus(
    boardPath: string,
    target: FocusEntryTarget,
  ): FocusRequestToken;
  deliverPendingFocus(boardPath: string): void;
  takePendingFocus(
    boardPath: string,
    token?: FocusRequestToken,
  ): FocusEntryTarget | null;
  attachConfiguratorPanel(
    boardPath: string,
    post: Post,
  ): { ready(): void; dispose(): void };
}

/**
 * One registry. `now` and `platform` are injectable so the time limit and
 * the Windows path rule are testable on any host.
 */
export function createFocusRegistry({
  now = Date.now,
  platform = process.platform,
}: { now?: () => number; platform?: string } = {}): FocusRegistry {
  // Windows paths are case-insensitive and accept either separator; a
  // drive letter in particular arrives as `C:` from one API and `c:` from
  // another. macOS's default APFS volume is case-insensitive too. Elsewhere
  // case is significant and is kept.
  const keyOf = (boardPath: string): string =>
    platform === "win32"
      ? path.win32.resolve(boardPath).toLowerCase()
      : platform === "darwin"
        ? path.posix.resolve(boardPath).toLowerCase()
        : path.resolve(boardPath);
  let nextToken = 1;

  const pending = new Map<string, Pending>();
  const panels = new Map<string, LivePanel>();

  const live = (key: string): FocusEntryTarget | null => {
    const entry = pending.get(key);
    if (!entry) return null;
    if (now() - entry.at > FOCUS_REQUEST_TTL_MS) {
      pending.delete(key);
      return null;
    }
    return entry.target;
  };

  const deliver = (key: string): void => {
    const panel = panels.get(key);
    if (!panel || !panel.isReady) return;
    const target = live(key);
    if (!target) return;
    pending.delete(key);
    panel.post({
      type: "focusEntry",
      section: target.section,
      name: target.name,
    });
  };

  return {
    /** Queue `target` for the Configurator on `boardPath`. Delivered when a
     *  new panel becomes ready, or by `deliverPendingFocus` once the open
     *  resolves. A newer request replaces an undelivered older one. */
    requestConfiguratorFocus(boardPath, target) {
      const token = nextToken++;
      pending.set(keyOf(boardPath), {
        target: { section: target.section, name: target.name },
        at: now(),
        token,
      });
      return token;
    },
    /** The open resolved: deliver to the panel if it is already ready. */
    deliverPendingFocus(boardPath) {
      deliver(keyOf(boardPath));
    },
    /** Remove and return the undelivered request, if still valid — used to
     *  withdraw it when the open itself failed. With a `token`, only THAT
     *  request is withdrawn: a newer one queued meanwhile stays. */
    takePendingFocus(boardPath, token) {
      const key = keyOf(boardPath);
      const entry = pending.get(key);
      if (token !== undefined && entry?.token !== token) return null;
      const target = live(key);
      pending.delete(key);
      return target;
    },
    /** Register a Configurator panel on `boardPath`. Call `ready()` once its
     *  view has rendered the board, and `dispose()` when it closes. */
    attachConfiguratorPanel(boardPath, post) {
      const key = keyOf(boardPath);
      const panel: LivePanel = { post, isReady: false };
      panels.set(key, panel);
      return {
        ready() {
          panel.isReady = true;
          deliver(key);
        },
        dispose() {
          if (panels.get(key) !== panel) return;
          panels.delete(key);
          // Closed before it could take the request: the request goes too,
          // or it would land on whatever opens this file next.
          if (!panel.isReady) pending.delete(key);
        },
      };
    },
  };
}

/** The extension's one registry. */
export const focusRegistry: FocusRegistry = createFocusRegistry();
