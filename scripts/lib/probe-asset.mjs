// SPDX-License-Identifier: Apache-2.0
//
// "Is this release asset published?" — the one question `check-cli-pin.mjs`
// asks, extracted so it can be driven against a local server instead of only
// against github.com.
//
// It answers one of three ways, and the difference between them is the whole
// point:
//
//   present  the asset is there
//   missing  the asset is NOT there, and we are confident enough to red a PR
//   unknown  we could not tell — reported as `skipped`, never as a failure,
//            because someone else's outage is not a defect in this repo
//
// Claiming `missing` is the expensive answer: the gate runs on every PR, and
// its message tells the reader to lower `SUPPORTED_CLI_VERSION` or add a
// `HOSTS_WITHOUT_RELEASE_ASSET` entry — the second of which silently stops
// covering a host that IS published.

export const TIMEOUT_MS = 15_000;
export const ATTEMPTS = 3;
export const RETRY_DELAY_MS = 1_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GitHub redirects release downloads to a CDN, so follow redirects on the
 * HEAD; a missing TAG and a missing ASSET both surface as 404.
 *
 * A 404 is retried like every other non-2xx. It did not used to be — `5xx` and
 * `429` looped, a `404` returned from inside the loop on the first attempt —
 * and that asymmetry is #510: on a CSS-only PR the gate called two assets
 * MISSING that existed, had not been touched since `2026-08-14T20:14:02Z`, and
 * answered `curl -I -L` with 200 from a dev machine. A re-run with no change
 * passed. WHY the runner saw a 404 is still not established; that it was ONE
 * SAMPLE is.
 *
 * So absence is only claimed when every attempt agrees on it. Anything else —
 * a mixed answer, a 5xx, a network error — is `unknown`, which the gate prints
 * as `skipped` and never fails on.
 *
 * `options` exists for the test: every field defaults to what CI uses.
 */
export async function probeAsset(url, options = {}) {
  const attempts = options.attempts ?? ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const doFetch = options.fetch ?? fetch;
  const wait = options.wait ?? sleep;

  /** One entry per attempt — a status code, or the error that replaced it. */
  const seen = [];
  for (let i = 1; i <= attempts; i += 1) {
    if (i > 1) await wait(retryDelayMs);
    try {
      const response = await doFetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        return { state: "present", attempts: i, seen: [...seen, "200"] };
      }
      seen.push(String(response.status));
    } catch (error) {
      seen.push(error instanceof Error ? error.message : String(error));
    }
  }

  // Every attempt failed, and only one shape of failure can claim absence.
  const absent = seen.length > 0 && seen.every((entry) => entry === "404");
  const observed = seen.join(", ");
  return absent
    ? {
        state: "missing",
        attempts,
        seen,
        detail: `404 on all ${attempts} attempts`,
      }
    : {
        state: "unknown",
        attempts,
        seen,
        detail: `${observed} across ${attempts} attempts`,
      };
}
