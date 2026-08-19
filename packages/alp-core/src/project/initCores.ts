// SPDX-License-Identifier: Apache-2.0
//
// What may legally go into `tan init --cores` (#528).
//
// The New Project flow used to send the SoM's ENTIRE declared topology,
// verbatim from `tan presets`, on the reasonable-looking assumption that data
// tan itself published would be data tan accepts. It is not, and every SoM
// declaring two Zephyr cores failed at `tan init` with exit 2 /
// `init.invalid-cores` — six of eleven SoMs, the whole Alif Ensemble line,
// whose defining topology is dual-M55.
//
// The contract, quoted from `tan init --help` at the pinned 0.6.0-rc1:
//
//   OS is inferred from the id when omitted, but that inference is only
//   honored for the plan's app core -- any other id can only be spliced in
//   app-less, as `:off` or (on a Cortex-A id) `:yocto`, so a bare companion id
//   like `m55_he` infers `:zephyr` and is refused unless `m55_he` is the app
//   core.
//
// `--cores` splices companions in APP-LESS, and the planner refuses an app-less
// `os: zephyr` slice ("os: zephyr requires `app:`"). tan refusing up front is
// the correct half of this: the alternative is a `board.yaml` the customer
// never hand-edited failing two commands later at `tan build`. An older tan
// (0.5.0-rc4) does exactly that — it accepts the same argv and writes
// `m55_he: os: zephyr` with no `app:`, which then cannot build.
//
// WHICH core is the app core is a fact only the SoM declares, and `tan presets`
// does not report it: `soms[].cores[]` is `{id, os}` and nothing else. So this
// planner never names one. It OMITS every Zephyr core — explicitly allowed
// ("Omit the entry or use m55_hp:zephyr") — and lets tan resolve its own app
// core. Guessing "the first Zephyr core in preset order" would be right today
// on all eleven SoMs and would still be a TypeScript re-derivation of a fact
// tan owns, which is the mistake `deps/planner.ts` already warns about.
//
// The cost of omitting is real and is not hidden: a second Zephyr core is left
// out of the generated `board.yaml` entirely, so the caller warns rather than
// silently downgrading. `--cores` cannot give a companion its own `app:` at
// all, so no `--template` + `--cores` combination can express a dual-Zephyr
// project — that is a CLI limitation tracked upstream, not something this
// filter can route around. The shipped `multicore/mproc-mailbox` example is
// what does express it (`m55_hp: app: ./src`, `m55_he: app: ./peer`), and it
// arrives through `--from-example`, which takes no `--cores`.

/** One core as `tan presets` declares it. */
export interface PresetCore {
  id: string;
  os: string;
}

export interface InitCoresPlan {
  /**
   * The `--cores` value, or `null` when there is nothing to say — the flag is
   * then omitted entirely rather than passed empty.
   */
  arg: string | null;
  /**
   * Every core declaring `os: zephyr`, all of which are omitted from `arg`.
   * ONE of them is the SoM's app core and gets the scaffolded app; any others
   * are not configured at all. Which is which is tan's answer to give, so this
   * is the whole set rather than a claim about a subset.
   */
  zephyrCores: string[];
}

/**
 * tan honors a companion's `yocto` "only when ... its id starts with 'a'" —
 * its own words, from the `init.invalid-cores` message. Matched on the id, not
 * on a family name, because that is the rule as stated.
 */
function isCortexA(id: string): boolean {
  return /^a/i.test(id);
}

/**
 * Filter a SoM's declared topology down to what `tan init --cores` accepts.
 *
 * Companion os values run through a SAFE-DIRECTION allowlist — `yocto` on a
 * Cortex-A id, everything else `off`. That is deliberately the opposite of the
 * pass-tan's-word-through rule the dependency planner follows, and for a
 * different job: this value is an ARGUMENT being sent back to tan, not a fact
 * being displayed. An os value this extension has not seen, forwarded blindly,
 * is a refusal at best and a wrong plan at worst; `off` always scaffolds.
 */
export function planInitCores(cores: readonly PresetCore[]): InitCoresPlan {
  const zephyrCores: string[] = [];
  const companions: string[] = [];

  for (const core of cores) {
    if (core.os === "zephyr") {
      zephyrCores.push(core.id);
      continue;
    }
    companions.push(
      core.os === "yocto" && isCortexA(core.id)
        ? `${core.id}:yocto`
        : `${core.id}:off`,
    );
  }

  return {
    arg: companions.length > 0 ? companions.join(",") : null,
    zephyrCores,
  };
}
