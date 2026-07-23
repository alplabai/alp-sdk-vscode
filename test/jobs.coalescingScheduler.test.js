// SPDX-License-Identifier: Apache-2.0

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createCoalescingScheduler,
} = require("../packages/alp-core/dist/jobs/coalescingScheduler.js");

// A fake clock: setTimer records the callback; flush() fires all due timers.
// clearTimer removes a pending one. This lets us drive debounce deterministically
// without real time.
function fakeClock() {
  let seq = 0;
  const pending = new Map();
  return {
    deps: {
      delayMs: 250,
      setTimer(fn) {
        const id = ++seq;
        pending.set(id, fn);
        return id;
      },
      clearTimer(id) {
        pending.delete(id);
      },
    },
    flush() {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
    },
    pendingCount() {
      return pending.size;
    },
  };
}

test("coalesces a burst per key: only the latest run fires", () => {
  const clock = fakeClock();
  const scheduler = createCoalescingScheduler(clock.deps);
  const ran = [];

  scheduler.schedule("a", () => ran.push("first"));
  scheduler.schedule("a", () => ran.push("second"));
  scheduler.schedule("a", () => ran.push("third"));
  // Three rapid schedules for the same key collapse to one pending timer.
  assert.equal(clock.pendingCount(), 1);

  clock.flush();
  assert.deepEqual(ran, ["third"]);
});

test("distinct keys run independently", () => {
  const clock = fakeClock();
  const scheduler = createCoalescingScheduler(clock.deps);
  const ran = [];

  scheduler.schedule("a", () => ran.push("a"));
  scheduler.schedule("b", () => ran.push("b"));
  assert.equal(clock.pendingCount(), 2);

  clock.flush();
  assert.deepEqual(ran.sort(), ["a", "b"]);
});

test("a new schedule aborts the in-flight run's token", async () => {
  const clock = fakeClock();
  const scheduler = createCoalescingScheduler(clock.deps);

  let firstToken;
  let release;
  const gate = new Promise((resolve) => (release = resolve));

  scheduler.schedule("a", async (token) => {
    firstToken = token;
    await gate; // stay in flight until we let it finish
  });
  clock.flush(); // first run starts, awaiting the gate
  assert.equal(firstToken.aborted, false);

  // A newer save arrives while the first is still running.
  scheduler.schedule("a", () => {});
  assert.equal(firstToken.aborted, true);

  release();
  await Promise.resolve();
});

test("cancel() aborts an in-flight token and fires onAbort listeners", async () => {
  const clock = fakeClock();
  const scheduler = createCoalescingScheduler(clock.deps);

  let token;
  let aborted = false;
  const gate = new Promise(() => {}); // never resolves

  scheduler.schedule("doc", async (t) => {
    token = t;
    t.onAbort(() => (aborted = true));
    await gate;
  });
  clock.flush();
  assert.equal(token.aborted, false);
  assert.equal(aborted, false);

  scheduler.cancel("doc");
  assert.equal(token.aborted, true);
  assert.equal(aborted, true);
});

test("cancel() on a pending (not-yet-fired) key clears the timer", () => {
  const clock = fakeClock();
  const scheduler = createCoalescingScheduler(clock.deps);
  const ran = [];

  scheduler.schedule("a", () => ran.push("a"));
  assert.equal(clock.pendingCount(), 1);
  scheduler.cancel("a");
  assert.equal(clock.pendingCount(), 0);

  clock.flush();
  assert.deepEqual(ran, []);
});

test("onAbort fires immediately if the token is already aborted", () => {
  const clock = fakeClock();
  const scheduler = createCoalescingScheduler(clock.deps);

  let token;
  scheduler.schedule("a", (t) => {
    token = t;
  });
  clock.flush();
  scheduler.cancel("a"); // aborts token
  let late = false;
  token.onAbort(() => (late = true));
  assert.equal(late, true);
});
