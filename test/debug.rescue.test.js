// SPDX-License-Identifier: Apache-2.0
//
// The `ALP:` / `Alp:` orphaned-configuration repair (src/debug/service.ts).
//
// The fixture is not invented. `orphanedDocument()` is the launch.json a real
// `tan 0.4.0 debug-config --target-kind zephyr-mcu --server jlink` produced,
// verbatim, over a file holding the pre-#387 `Alp:` entry with a hand-filled
// `device` — the state every customer whose launch.json predates #387 lands in
// after one run.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  findRescuablePairs,
  planOrphanRescue,
} = require("../out/debug/service.js");
const { launchConfigPlaceholders } = require("../out/alpCli/service.js");

/** The `ALP:` name tan 0.4.0 reports in `data.configuration.name`. */
const TAN_0_4_0_NAME = "ALP: Zephyr Debug (J-Link)";
/** What tan `dev` reports post-#155, which strands the OTHER half. */
const TAN_DEV_NAME = "Alp: Zephyr Debug (J-Link)";

function orphanedDocument() {
  return {
    version: "0.2.0",
    configurations: [
      {
        name: "Alp: Zephyr Debug (J-Link)",
        type: "cortex-debug",
        request: "launch",
        cwd: "${workspaceFolder}",
        executable: "${workspaceFolder}/build/app/zephyr/zephyr.elf",
        runToEntryPoint: "main",
        servertype: "jlink",
        device: "AE822F4M55_HP",
        interface: "swd",
        myOwnKey: "keep-me",
      },
      {
        name: "ALP: Zephyr Debug (J-Link)",
        type: "cortex-debug",
        request: "launch",
        cwd: "${workspaceFolder}",
        executable: "${workspaceFolder}/build/app/zephyr/zephyr.elf",
        runToEntryPoint: "main",
        servertype: "jlink",
        device: "<resolved-device>",
        interface: "swd",
      },
    ],
  };
}

test("the placeholder predicate sees any <…> token, not just <resolved-", () => {
  // The trap this whole repair had to avoid: `<host>:<port>` rides on EVERY
  // yocto-userspace draft, and the `<resolved-` prefix test did not see it. A
  // rescue reusing that would read a Yocto orphan's placeholder as a real
  // gdbserver address and overwrite a good one with it.
  assert.deepStrictEqual(launchConfigPlaceholders("<host>:<port>"), [
    "<host>:<port>",
  ]);
  assert.deepStrictEqual(launchConfigPlaceholders("<resolved-device>"), [
    "<resolved-device>",
  ]);
  // `${…}` is VS Code's own substitution and carries no angle bracket, so a
  // fully-resolved configuration must still report clean.
  assert.deepStrictEqual(
    launchConfigPlaceholders({
      program: "${workspaceFolder}/build/yocto/app",
      device: "AE822F4M55_HP",
    }),
    [],
  );
});

test("a stranded concrete value moves onto the maintained entry", () => {
  const rescue = planOrphanRescue(orphanedDocument(), TAN_0_4_0_NAME);
  const configurations = rescue.document.configurations;

  assert.equal(configurations.length, 1);
  assert.equal(configurations[0].name, "ALP: Zephyr Debug (J-Link)");
  assert.equal(configurations[0].device, "AE822F4M55_HP");
  assert.deepStrictEqual(rescue.pairs, [
    {
      keptName: "ALP: Zephyr Debug (J-Link)",
      removedName: "Alp: Zephyr Debug (J-Link)",
      movedKeys: ["device", "myOwnKey"],
      discardedKeys: [],
    },
  ]);
  // Everything outside `configurations` is carried through untouched.
  assert.equal(rescue.document.version, "0.2.0");
});

test("an unknown key the customer added survives the repair", () => {
  // tan itself preserves `myOwnKey` (only the draft's own keys are visited by
  // its merge), and this repair must not be the thing that loses it.
  const rescue = planOrphanRescue(orphanedDocument(), TAN_0_4_0_NAME);
  assert.equal(rescue.document.configurations[0].myOwnKey, "keep-me");
});

test("a placeholder on the orphan never overwrites a concrete value", () => {
  // The case a naive "copy everything across" gets wrong. Same rule as tan's
  // `merge_value`: an unresolved value never wins.
  const document = orphanedDocument();
  document.configurations[0].device = "<resolved-device>";
  document.configurations[1].device = "AE822F4M55_HP";

  const rescue = planOrphanRescue(document, TAN_0_4_0_NAME);
  const configurations = rescue.document.configurations;

  assert.equal(configurations.length, 1);
  assert.equal(configurations[0].device, "AE822F4M55_HP");
  // `myOwnKey` still has nothing on the maintained side, so it still moves —
  // the rule is per key, not per entry.
  assert.deepStrictEqual(rescue.pairs[0].movedKeys, ["myOwnKey"]);
});

test("a yocto orphan's <host>:<port> does not overwrite a real address", () => {
  // Same shape as above but with the placeholder the narrow predicate missed —
  // this is the assertion that reds if the predicate is ever narrowed back.
  const document = {
    version: "0.2.0",
    configurations: [
      {
        name: "Alp: Yocto Remote Debug",
        type: "cppdbg",
        miDebuggerServerAddress: "<host>:<port>",
        miDebuggerPath: "/opt/toolchain/bin/aarch64-gdb",
      },
      {
        name: "ALP: Yocto Remote Debug",
        type: "cppdbg",
        miDebuggerServerAddress: "192.168.1.44:3333",
        miDebuggerPath: "<resolved-gdb>",
      },
    ],
  };

  const rescue = planOrphanRescue(document, "ALP: Yocto Remote Debug");
  const kept = rescue.document.configurations[0];
  assert.equal(kept.miDebuggerServerAddress, "192.168.1.44:3333");
  assert.equal(kept.miDebuggerPath, "/opt/toolchain/bin/aarch64-gdb");
  assert.deepStrictEqual(rescue.pairs[0].movedKeys, ["miDebuggerPath"]);
});

test("the repair runs in the other direction when tan's rename ships", () => {
  // tan `dev` post-#155 writes `Alp:`, which strands the `ALP:` entry every
  // machine on v0.4.0 now has. Same file, opposite verdict.
  const rescue = planOrphanRescue(orphanedDocument(), TAN_DEV_NAME);
  const configurations = rescue.document.configurations;

  assert.equal(configurations.length, 1);
  assert.equal(configurations[0].name, "Alp: Zephyr Debug (J-Link)");
  assert.equal(configurations[0].device, "AE822F4M55_HP");
  assert.equal(rescue.pairs[0].removedName, "ALP: Zephyr Debug (J-Link)");
  // Nothing moved: the `Alp:` half already held every concrete value.
  assert.deepStrictEqual(rescue.pairs[0].movedKeys, []);
});

test("repairing twice changes nothing and re-prompts nobody", () => {
  const once = planOrphanRescue(orphanedDocument(), TAN_0_4_0_NAME);
  // Detection is what gates the prompt, and it is what must go quiet.
  assert.deepStrictEqual(findRescuablePairs(once.document), []);
  assert.equal(planOrphanRescue(once.document, TAN_0_4_0_NAME), null);
});

test("a hand-added second .cfg is not deleted with the orphan", () => {
  // tan's `merge_value` has a THIRD branch, for arrays, added precisely so a
  // hand-added `.cfg` is not lost — and without it this repair was the thing
  // losing it. `isConcrete` reads an array as ONE opaque value, so a
  // `configFiles` holding an unresolved board cfg next to a hand-added
  // interface cfg is "not concrete" as a whole: it never travels, and the
  // orphan carrying it is deleted. `myOwnKey` is what opens the gate, and the
  // array rode along uninspected.
  //
  // `["<resolved-openocd-board-cfg>"]` is verbatim what a real
  // `tan 0.4.0 debug-config --target-kind zephyr-mcu --server openocd` writes:
  // a one-element, all-placeholder list. So the maintained entry really does
  // hold nothing but a placeholder here, and this is not a hypothetical.
  const document = {
    version: "0.2.0",
    configurations: [
      {
        name: "Alp: Zephyr Debug (OpenOCD)",
        servertype: "openocd",
        configFiles: [
          "<resolved-openocd-board-cfg>",
          "interface/stlink-v2-1.cfg",
        ],
        myOwnKey: "keep-me",
      },
      {
        name: "ALP: Zephyr Debug (OpenOCD)",
        servertype: "openocd",
        configFiles: ["<resolved-openocd-board-cfg>"],
      },
    ],
  };
  const rescue = planOrphanRescue(document, "ALP: Zephyr Debug (OpenOCD)");
  const kept = rescue.document.configurations[0];
  assert.deepStrictEqual(kept.configFiles, [
    "<resolved-openocd-board-cfg>",
    "interface/stlink-v2-1.cfg",
  ]);
  assert.deepStrictEqual(rescue.pairs[0].movedKeys, [
    "configFiles",
    "myOwnKey",
  ]);
});

test("a resolved .cfg on the maintained entry outranks the orphan's, per index", () => {
  // Element-wise, the same rule as the per-key one: what the maintained entry
  // resolved wins, a placeholder there is filled from the orphan, and an
  // all-placeholder orphan array moves nothing at all (tan: "an all-placeholder
  // incoming list keeps the existing list WHOLE").
  const document = {
    version: "0.2.0",
    configurations: [
      {
        name: "Alp: Zephyr Debug (OpenOCD)",
        configFiles: ["board/hand.cfg", "<resolved-openocd-interface-cfg>"],
        myOwnKey: "keep-me",
      },
      {
        name: "ALP: Zephyr Debug (OpenOCD)",
        configFiles: ["board/alif_e8.cfg", "interface/jlink.cfg"],
      },
    ],
  };
  const rescue = planOrphanRescue(document, "ALP: Zephyr Debug (OpenOCD)");
  assert.deepStrictEqual(rescue.document.configurations[0].configFiles, [
    "board/alif_e8.cfg",
    "interface/jlink.cfg",
  ]);
  assert.deepStrictEqual(rescue.pairs[0].movedKeys, ["myOwnKey"]);
});

test("a placeholder in the orphan's tail is not appended", () => {
  // Two reasons, and either alone is enough: a placeholder must not travel, and
  // skipping it would shift every later entry up a position — `configFiles` is
  // ORDERED (openocd sources them in sequence), so a silent reorder is its own
  // defect.
  const document = {
    version: "0.2.0",
    configurations: [
      {
        name: "Alp: Zephyr Debug (OpenOCD)",
        configFiles: ["board/alif_e8.cfg", "<resolved-openocd-interface-cfg>"],
        myOwnKey: "keep-me",
      },
      {
        name: "ALP: Zephyr Debug (OpenOCD)",
        configFiles: ["board/alif_e8.cfg"],
      },
    ],
  };
  const rescue = planOrphanRescue(document, "ALP: Zephyr Debug (OpenOCD)");
  assert.deepStrictEqual(rescue.document.configurations[0].configFiles, [
    "board/alif_e8.cfg",
  ]);
  assert.deepStrictEqual(rescue.pairs[0].movedKeys, ["myOwnKey"]);
});

test("a discarded hand-filled value is NAMED, not silently dropped", () => {
  // Both entries hold a concrete `device` and they differ. The maintained one
  // stands — it is what F5 already used — so the orphan's is deleted with the
  // orphan. That is defensible; deleting it without saying so is not, and
  // `discardedKeys` is what every caller has to repeat back.
  const document = {
    version: "0.2.0",
    configurations: [
      {
        name: "Alp: Zephyr Debug (J-Link)",
        device: "AE822F4M55_HP",
        myOwnKey: "keep-me",
      },
      { name: "ALP: Zephyr Debug (J-Link)", device: "AE722F80F55_HP" },
    ],
  };
  const rescue = planOrphanRescue(document, TAN_0_4_0_NAME);
  assert.equal(rescue.document.configurations[0].device, "AE722F80F55_HP");
  assert.deepStrictEqual(rescue.pairs[0].movedKeys, ["myOwnKey"]);
  assert.deepStrictEqual(rescue.pairs[0].discardedKeys, ["device"]);
});

test("`name` is never reported as a discarded value", () => {
  // The two spellings ARE the pair. Reporting the removed entry's own name as a
  // discarded value would put "name was discarded" in front of every customer
  // who accepts, for the one key where it means nothing.
  const rescue = planOrphanRescue(orphanedDocument(), TAN_0_4_0_NAME);
  assert.deepStrictEqual(rescue.pairs[0].discardedKeys, []);
});

test("three same-suffix entries take two passes and lose nothing", () => {
  // The header used to claim this "cannot run twice over". It can: pairing is
  // (i, j) and stops, so a third entry with the same suffix is left for a
  // second pass. Nothing is lost — each pass merges before it deletes — and the
  // second pass happens because dismissing the offer does not silence it
  // (test/debug.rescueOffer.test.js).
  const document = {
    version: "0.2.0",
    configurations: [
      { name: "Alp: Zephyr Debug (J-Link)", device: "AE822F4M55_HP" },
      { name: "ALP: Zephyr Debug (J-Link)", device: "<resolved-device>" },
      { name: "Alp: Zephyr Debug (J-Link)", myOwnKey: "keep-me" },
    ],
  };

  const first = planOrphanRescue(document, TAN_0_4_0_NAME);
  assert.equal(first.document.configurations.length, 2);
  assert.equal(first.document.configurations[0].device, "AE822F4M55_HP");
  // Still a pair, so the offer must still be made — and is.
  assert.equal(findRescuablePairs(first.document).length, 1);

  const second = planOrphanRescue(first.document, TAN_0_4_0_NAME);
  assert.deepStrictEqual(second.document.configurations, [
    {
      name: "ALP: Zephyr Debug (J-Link)",
      device: "AE822F4M55_HP",
      myOwnKey: "keep-me",
    },
  ]);
  // And it converges: no third pass, no prompt.
  assert.deepStrictEqual(findRescuablePairs(second.document), []);
  assert.equal(planOrphanRescue(second.document, TAN_0_4_0_NAME), null);
});

test("a duplicate with nothing at risk is left alone, not repaired", () => {
  // Two entries identical but for the prefix spelling strand no value, so
  // hand-deleting either loses nothing. Interrupting anyone over a cosmetic
  // duplicate is the nagging this trigger exists to avoid.
  const document = {
    version: "0.2.0",
    configurations: [
      { name: "Alp: Zephyr Debug (J-Link)", device: "AE822F4M55_HP" },
      { name: "ALP: Zephyr Debug (J-Link)", device: "AE822F4M55_HP" },
    ],
  };
  assert.deepStrictEqual(findRescuablePairs(document), []);
  assert.equal(planOrphanRescue(document, TAN_0_4_0_NAME), null);
});

test("a name the pinned CLI does not spell either way is left alone", () => {
  // A tan that renamed the configuration outright: which half it would
  // maintain is unknowable, so guessing a direction is worse than doing
  // nothing.
  assert.equal(planOrphanRescue(orphanedDocument(), "Tan: Zephyr Debug"), null);
});

test("configurations this repair does not touch are carried through", () => {
  const document = orphanedDocument();
  document.configurations.unshift({ name: "My own gdb", type: "cppdbg" });
  document.inputs = [{ id: "port", type: "promptString" }];

  const rescue = planOrphanRescue(document, TAN_0_4_0_NAME);
  assert.deepStrictEqual(
    rescue.document.configurations.map((c) => c.name),
    ["My own gdb", "ALP: Zephyr Debug (J-Link)"],
  );
  assert.deepStrictEqual(rescue.document.inputs, [
    { id: "port", type: "promptString" },
  ]);
});

test("a file with no pair, or no configurations at all, never throws", () => {
  // Every one of these is NORMAL — a project with a hand-written launch.json,
  // a project with none, a file that did not parse (the adapter hands null
  // through for all three of missing/unparseable/not-an-object).
  const cases = [
    null,
    undefined,
    {},
    { configurations: null },
    { configurations: [] },
    { configurations: [{ name: "ALP: Zephyr Debug (J-Link)" }] },
    { configurations: [{ name: "My own gdb" }, { name: "Another" }] },
    { configurations: ["not an object", 42, null] },
    { configurations: [{}, {}] },
    { configurations: {} },
    { configurations: "text" },
    "a bare string",
    42,
    [],
  ];
  for (const document of cases) {
    assert.deepStrictEqual(findRescuablePairs(document), [], String(document));
    assert.equal(planOrphanRescue(document, TAN_0_4_0_NAME), null);
  }
});

test("a placeholder never travels onto a key the maintained entry lacks", () => {
  // Not the same rule as "never overwrites". tan REMOVES `svdFile`/`svdPath`
  // when no SVD resolved, because a path that does not exist makes
  // cortex-debug fail on start. Re-inserting the orphan's `<resolved-svd>`
  // over the absent key hands that failure straight back — and the maintained
  // entry has nothing there to refuse it with.
  const document = {
    version: "0.2.0",
    configurations: [
      {
        name: "Alp: Zephyr Debug (J-Link)",
        svdFile: "<resolved-svd>",
        svdPath: "<resolved-svd>",
        device: "AE822F4M55_HP",
      },
      { name: "ALP: Zephyr Debug (J-Link)", device: "<resolved-device>" },
    ],
  };
  const kept = planOrphanRescue(document, TAN_0_4_0_NAME).document
    .configurations[0];
  assert.equal(kept.device, "AE822F4M55_HP");
  assert.ok(!("svdFile" in kept), "svdFile must not be re-created");
  assert.ok(!("svdPath" in kept), "svdPath must not be re-created");
});

test("a hand-pasted same-name duplicate is not offered a repair", () => {
  // tan never writes one — its merge key would have folded them — but a
  // customer can paste one, and this repair cannot tell which of two identical
  // names is maintained. Detecting it would prompt for a repair that
  // `planOrphanRescue` then refuses: a prompt that does nothing, on their file.
  const document = {
    version: "0.2.0",
    configurations: [
      { name: "ALP: Zephyr Debug (J-Link)", device: "AE822F4M55_HP" },
      { name: "ALP: Zephyr Debug (J-Link)", device: "<resolved-device>" },
    ],
  };
  assert.deepStrictEqual(findRescuablePairs(document), []);
  assert.equal(planOrphanRescue(document, TAN_0_4_0_NAME), null);
});

test("two ALP:/Alp: pairs in one file are both repaired", () => {
  const document = {
    version: "0.2.0",
    configurations: [
      { name: "Alp: Zephyr Debug (J-Link)", device: "AE822F4M55_HP" },
      { name: "ALP: Zephyr Debug (J-Link)", device: "<resolved-device>" },
      { name: "Alp: Yocto Remote Debug", miDebuggerPath: "/opt/bin/gdb" },
      { name: "ALP: Yocto Remote Debug", miDebuggerPath: "<resolved-gdb>" },
    ],
  };
  const rescue = planOrphanRescue(document, TAN_0_4_0_NAME);
  assert.deepStrictEqual(
    rescue.document.configurations.map((c) => c.name),
    ["ALP: Zephyr Debug (J-Link)", "ALP: Yocto Remote Debug"],
  );
  assert.equal(rescue.document.configurations[0].device, "AE822F4M55_HP");
  assert.equal(
    rescue.document.configurations[1].miDebuggerPath,
    "/opt/bin/gdb",
  );
});

test("the maintained name is never moved off the orphan", () => {
  // `name` IS tan's merge key. Copying it across would rebuild the orphan
  // under the surviving entry's identity and undo the repair.
  const rescue = planOrphanRescue(orphanedDocument(), TAN_0_4_0_NAME);
  assert.equal(
    rescue.document.configurations[0].name,
    "ALP: Zephyr Debug (J-Link)",
  );
  assert.ok(!rescue.pairs[0].movedKeys.includes("name"));
});

test("an all-placeholder maintained list keeps the orphan's list WHOLE, whatever the order", () => {
  // The case a per-index merge destroys, and the reason this ports tan's
  // branch instead of refining the per-key rule. The customer put the interface
  // cfg FIRST, which is cortex-debug's own documented order.
  //
  // Per-index, index 0 is "maintained placeholder, orphan concrete" so the
  // INTERFACE cfg is written into the BOARD-cfg slot; the tail then stops on
  // the orphan's placeholder and the array truncates to one element. The result
  // starts openocd with no target, `launchConfigPlaceholders` returns [] so the
  // preflight calls it launchable, and tan never puts it back — its own array
  // branch returns the existing list whole. Permanent, and it looks fine.
  const rescue = planOrphanRescue(
    {
      version: "0.2.0",
      configurations: [
        {
          name: "Alp: Zephyr Debug (OpenOCD)",
          configFiles: [
            "interface/stlink-v2-1.cfg",
            "<resolved-openocd-board-cfg>",
          ],
          myOwnKey: "keep-me",
        },
        {
          name: "ALP: Zephyr Debug (OpenOCD)",
          configFiles: ["<resolved-openocd-board-cfg>"],
        },
      ],
    },
    "ALP: Zephyr Debug (OpenOCD)",
  );

  assert.deepStrictEqual(rescue.document.configurations[0].configFiles, [
    "interface/stlink-v2-1.cfg",
    "<resolved-openocd-board-cfg>",
  ]);
  // The placeholder slot SURVIVES on purpose: tan fills it on the next run, and
  // until it does the preflight must still report the configuration unresolved.
  assert.deepStrictEqual(rescue.pairs[0].discardedKeys, []);
});

test("a concrete tail the maintained list has no room for is discarded, and NAMED", () => {
  // tan's per-element branch produces a list the length of the incoming one, so
  // an orphan longer than the maintained entry loses its tail. That is tan's
  // behaviour and it stands — but the file is rewritten in place with no
  // backup, so a `board/hand-written.cfg` that vanishes unmentioned is
  // unrecoverable and the customer has no reason to go looking.
  const rescue = planOrphanRescue(
    {
      version: "0.2.0",
      configurations: [
        {
          name: "Alp: Zephyr Debug (OpenOCD)",
          configFiles: ["board/hand-written.cfg", "interface/stlink-v2-1.cfg"],
          myOwnKey: "keep-me",
        },
        {
          name: "ALP: Zephyr Debug (OpenOCD)",
          configFiles: ["board/alif_e8.cfg"],
        },
      ],
    },
    "ALP: Zephyr Debug (OpenOCD)",
  );

  assert.deepStrictEqual(rescue.document.configurations[0].configFiles, [
    "board/alif_e8.cfg",
  ]);
  assert.deepStrictEqual(rescue.pairs[0].discardedKeys, ["configFiles"]);
  // And NOT also reported as moved: the maintained value won outright, so
  // "moved across: configFiles" would be a sentence the customer cannot act on.
  assert.deepStrictEqual(rescue.pairs[0].movedKeys, ["myOwnKey"]);
});
