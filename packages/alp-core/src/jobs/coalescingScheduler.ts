// SPDX-License-Identifier: Apache-2.0

/**
 * A per-key coalescing scheduler: rapid `schedule(key, run)` calls collapse to a
 * single run of the latest task after a debounce delay, and a new schedule for a
 * key aborts any run already in flight for that key. Built for LSP save/change
 * validation — repeated saves must not pile up N validator subprocesses, and a
 * stale run in flight must not post diagnostics over a newer one.
 *
 * Pure and host-agnostic: the timer and cancellation are abstractions so the
 * package stays free of Node/DOM globals (no `setTimeout`, no `AbortController`)
 * and is testable with a fake clock. The surface injects real timers and bridges
 * {@link CancelToken} to a real `AbortController`/`child.kill()`.
 */

/** A one-shot cancellation flag with abort notification. Never reset. */
export interface CancelToken {
  readonly aborted: boolean;
  /** Run `listener` when aborted; fires immediately if already aborted. */
  onAbort(listener: () => void): void;
}

/** Opaque handle a timer returns; the scheduler only stores and clears it. */
export type TimerHandle = unknown;

export interface CoalescingSchedulerDeps {
  /** Debounce window, in ms, before a scheduled run fires. */
  delayMs: number;
  setTimer(fn: () => void, ms: number): TimerHandle;
  clearTimer(handle: TimerHandle): void;
}

export interface CoalescingScheduler<K> {
  /** Debounce + coalesce a run for `key`; aborts any pending/in-flight run. */
  schedule(key: K, run: (token: CancelToken) => Promise<void> | void): void;
  /** Drop the pending timer and abort the in-flight run for `key`, if any. */
  cancel(key: K): void;
  /** Cancel everything (call on shutdown / document close sweep). */
  dispose(): void;
}

interface CancelSource {
  readonly token: CancelToken;
  abort(): void;
}

function createCancelSource(): CancelSource {
  let aborted = false;
  const listeners: Array<() => void> = [];
  return {
    token: {
      get aborted() {
        return aborted;
      },
      onAbort(listener: () => void) {
        if (aborted) {
          listener();
        } else {
          listeners.push(listener);
        }
      },
    },
    abort() {
      if (aborted) {
        return;
      }
      aborted = true;
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

export function createCoalescingScheduler<K>(
  deps: CoalescingSchedulerDeps,
): CoalescingScheduler<K> {
  const timers = new Map<K, TimerHandle>();
  const inflight = new Map<K, CancelSource>();

  function cancel(key: K): void {
    const timer = timers.get(key);
    if (timer !== undefined) {
      deps.clearTimer(timer);
      timers.delete(key);
    }
    const source = inflight.get(key);
    if (source) {
      inflight.delete(key);
      source.abort();
    }
  }

  function schedule(
    key: K,
    run: (token: CancelToken) => Promise<void> | void,
  ): void {
    // Latest-wins: drop any pending timer and abort any run already going.
    cancel(key);
    const handle = deps.setTimer(() => {
      timers.delete(key);
      const source = createCancelSource();
      inflight.set(key, source);
      void Promise.resolve(run(source.token)).finally(() => {
        // Only clear if we're still the current run for this key — a newer
        // schedule may have replaced us and must not be evicted here.
        if (inflight.get(key) === source) {
          inflight.delete(key);
        }
      });
    }, deps.delayMs);
    timers.set(key, handle);
  }

  function dispose(): void {
    for (const key of [...timers.keys(), ...inflight.keys()]) {
      cancel(key);
    }
  }

  return { schedule, cancel, dispose };
}
