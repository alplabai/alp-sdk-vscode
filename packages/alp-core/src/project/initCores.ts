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
// The contract, quoted from `tan init --help` at the pinned 0.6.0:
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

// THEN #582 ADDED THE OTHER HALF. The Cores step collects an answer per core,
// and the argv was built from the declared topology anyway — so a core the
// customer set to "Off (skip core)" still reached `--cores` as an enabled
// runtime. Forwarding the answers verbatim instead is measurably worse than the
// defect (276 of 368 combinations refused, against 0 today), because most
// answers collapse to `<id>:off` and `:off` on the app core is refused. The
// answers are therefore SPLIT: what `--cores` can express is emitted, the rest
// comes back in `deferred` for the second pass. See `planInitCores` below.

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
  /**
   * The customer's answers `--cores` has no spelling for, so the second pass
   * has to carry them: `baremetal` anywhere, `off` on a declared-zephyr core,
   * `yocto` on an id tan will not honour it for, and any os this build does not
   * know.
   *
   * Returned rather than swallowed because swallowing one is exactly #582: the
   * customer answers, the answer is quietly replaced by something else, and
   * nobody says so. The caller must either see it honoured by the second pass
   * or tell them.
   */
  deferred: { id: string; requested: string }[];
  /**
   * Answers naming a core the SoM does not declare. Dropped: the declared
   * topology is the authority on which cores exist, and the assignments arrive
   * in a webview message. Reported for the same reason as `deferred`.
   */
  unknown: string[];
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
 * Decide what `tan init --cores` may carry for one wizard submission.
 *
 * MONOTONE-DOWN, and that is the whole safety argument. The value returned is
 * always the DECLARED-topology value with zero or more entries turned down to
 * `:off`, and never anything else:
 *
 *   - a declared-`zephyr` core is omitted whatever the customer answered, so no
 *     answer can ever name the core tan resolves as the plan's app core;
 *   - a declared companion is emitted `:yocto` only where the topology already
 *     was, and `:off` otherwise.
 *
 * Measured over four answers for every core of all eleven SoMs, driving the
 * pinned tan 0.6.0: sending the declared topology is refused 0 times in
 * 368, and sending the customer's answers VERBATIM is refused 276 times with
 * exit 2 / `init.invalid-cores`. Every one of the 276 is the same rule —
 * `--cores` naming the app core as `:off` — and an answer of `baremetal`,
 * `yocto` or `off` on that core collapses to exactly that. Turning the Cortex-A
 * companion off, which is #582's own complaint, was never refused at all.
 *
 * So the answers are split rather than forwarded: what `--cores` can express
 * goes here, and the rest comes back in `deferred` for the second pass, which
 * edits tan's own board.yaml and has no such limits.
 *
 * Companion os values run through a SAFE-DIRECTION allowlist — `yocto` on a
 * Cortex-A id, everything else `off`. That is deliberately the opposite of the
 * pass-tan's-word-through rule the dependency planner follows, and for a
 * different job: this value is an ARGUMENT being sent back to tan, not a fact
 * being displayed. An os value this extension has not seen, forwarded blindly,
 * is a refusal at best and a wrong plan at worst; `off` always scaffolds.
 *
 * @param declared The SoM's topology, verbatim from `tan presets`. The
 *   authority on which cores exist.
 * @param assignments The customer's answers from the Cores step. Omitted (or
 *   empty) means "no answers" — NOT "everything off" — and reproduces the
 *   topology argv exactly, which is what an older webview and the example flow
 *   still take.
 */
export function planInitCores(
  declared: readonly PresetCore[],
  assignments?: readonly PresetCore[],
): InitCoresPlan {
  const answers = new Map(
    (assignments ?? []).map((core) => [core.id, core.os] as const),
  );
  const declaredIds = new Set(declared.map((core) => core.id));

  const zephyrCores: string[] = [];
  const companions: string[] = [];
  const deferred: { id: string; requested: string }[] = [];

  for (const core of declared) {
    const requested = answers.get(core.id);

    if (core.os === "zephyr") {
      zephyrCores.push(core.id);
      // Omitted unconditionally. `--cores` cannot give a zephyr core an `app:`,
      // and naming it `:off` is refused whenever it is the app core — which is
      // a fact `tan presets` does not report, so it can never be ruled out.
      if (requested !== undefined && requested !== "zephyr") {
        deferred.push({ id: core.id, requested });
      }
      continue;
    }

    const effective = requested ?? core.os;
    if (effective === "yocto" && isCortexA(core.id)) {
      companions.push(`${core.id}:yocto`);
      continue;
    }
    companions.push(`${core.id}:off`);
    if (effective !== "off") {
      deferred.push({ id: core.id, requested: effective });
    }
  }

  return {
    arg: companions.length > 0 ? companions.join(",") : null,
    zephyrCores,
    deferred,
    unknown: (assignments ?? [])
      .map((core) => core.id)
      .filter((id) => !declaredIds.has(id)),
  };
}
