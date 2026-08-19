import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "../../shared/ui";
import type {
  BoardConfig,
  ChipChoice,
  ConfiguratorViewModel,
  CorePanel,
  LibraryEntry,
  ModelEntry,
  Ota,
} from "../../types";
import { consoleRecommendation } from "./consoleRecommendation";
import styles from "./ConfiguratorView.module.css";
import {
  CONFIGURATOR_SECTIONS,
  useConfigurator,
  type ConfiguratorSection,
  type UseConfigurator,
} from "./useConfigurator";

// ───────────────────────── primitives ─────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.fieldLabel}>
        {label}
      </label>
      {/* children consume the id via aria-labelledby fallback */}
      <div id={id}>{children}</div>
      {hint ? <div className={styles.hint}>{hint}</div> : null}
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}

type Opt = [string, string];

function Select({
  value,
  options,
  onChange,
  label,
}: {
  value: string;
  options: Opt[];
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <select
      className={styles.control}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

/**
 * A text field that can actually be typed in.
 *
 * The `value` prop is the HOST's view model (`CorePanel.app` and friends),
 * which lags every keystroke by a full round-trip: the mutation is debounced
 * 200 ms, then written to the document, re-parsed and posted back as
 * `configuratorRender`. Bound straight to `value`, React re-rendered each
 * keystroke with the stale host value and wiped the character the customer had
 * just typed — every letter vanished and reappeared a fifth of a second later,
 * and typing at speed lost most of them.
 *
 * So the field keeps a DRAFT while it has focus, and accepts the incoming
 * `value` only when it does not — a blurred field must still follow the
 * document (an external edit in a side-by-side YAML editor, or a reload), which
 * is why the draft is not simply local state forever.
 *
 * Exported for `test/webview/ui-render.tsx`, which drives it with a
 * deliberately stale prop — the exact condition that produced the bug.
 */
export function TextInput({
  value,
  placeholder,
  onChange,
  label,
}: {
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <input
      className={styles.control}
      type="text"
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

/** Same draft-while-focused rule as `TextInput` — see its comment. A number
 *  field is worse without it: the host drops a partial value like "12" on the
 *  way through `parseInt`, so the round-trip could snap the caret back mid-entry. */
export function NumberInput({
  value,
  placeholder,
  onChange,
  label,
}: {
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return (
    <input
      className={styles.control}
      type="number"
      value={draft}
      placeholder={placeholder}
      aria-label={label}
      onFocus={() => {
        focused.current = true;
      }}
      onBlur={() => {
        focused.current = false;
      }}
      onChange={(e) => {
        setDraft(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

function Check({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={styles.check}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function AdvCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.advCard}>
      <div className={styles.advHead}>{title}</div>
      <div className={styles.advBody}>{children}</div>
    </div>
  );
}

// Searchable multi-select (chips + filter dropdown).
function TagSelector({
  all,
  selected,
  onChange,
  placeholder,
}: {
  all: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const chosen = new Set(selected);
  const matches = useMemo(
    () =>
      all
        .filter(
          (id) =>
            !chosen.has(id) && id.toLowerCase().includes(query.toLowerCase()),
        )
        .sort()
        .slice(0, 8),
    [all, query, selected],
  );

  function add(id: string) {
    if (!chosen.has(id)) onChange([...selected, id]);
    setQuery("");
  }
  function remove(id: string) {
    onChange(selected.filter((x) => x !== id));
  }

  return (
    <div className={styles.sel}>
      <div className={styles.selChips}>
        {selected.length === 0 ? (
          <span className={styles.selEmpty}>none</span>
        ) : (
          selected.map((id) => (
            <span key={id} className={styles.selChip}>
              {id}
              <button
                type="button"
                className={styles.selX}
                aria-label={`Remove ${id}`}
                onClick={() => remove(id)}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>
      <div className={styles.combo}>
        <input
          className={styles.control}
          type="text"
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {open && matches.length > 0 ? (
          <div className={styles.dd}>
            {matches.map((id) => (
              <button
                key={id}
                type="button"
                className={styles.opt}
                onMouseDown={(e) => {
                  e.preventDefault();
                  add(id);
                }}
              >
                {id}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ───────────────────────── sections ─────────────────────────

function SectionLabel({ text, hint }: { text: string; hint?: string }) {
  return (
    <>
      <p className={styles.secLabel}>§ {text}</p>
      {hint ? <p className={styles.secHelp}>{hint}</p> : null}
    </>
  );
}

function HardwareCard({ vm }: { vm: ConfiguratorViewModel }) {
  const hw = vm.hardware;
  if (!hw) {
    return (
      <div className={styles.card}>
        <div className={styles.cardTop}>
          <span className={styles.cardName}>Unknown SoM</span>
        </div>
        <p className={styles.cardKv}>Select a SoM SKU recognised by the SDK.</p>
      </div>
    );
  }
  const compute = hw.cores.length
    ? hw.cores
        .map(
          (c) =>
            `${c.count}× ${c.type}${c.freqMhz ? ` @ ${c.freqMhz}MHz` : ""}`,
        )
        .join(" · ")
    : "—";
  return (
    <div className={styles.card}>
      <div className={styles.cardTop}>
        <span className={styles.cardName}>{hw.displayName || hw.sku}</span>
        <span className={styles.cardSilicon}>{hw.silicon}</span>
        {hw.preliminary ? (
          <span className={styles.pillWarn}>preliminary</span>
        ) : null}
      </div>
      <dl className={styles.kv}>
        <dt>Compute</dt>
        <dd>{compute}</dd>
        <dt>Inference</dt>
        <dd>{hw.preferredBackend || "—"}</dd>
        <dt>Default board</dt>
        <dd>{hw.defaultBoard || "—"}</dd>
        {hw.onModule.length ? (
          <>
            <dt>On-module</dt>
            <dd>{hw.onModule.join(" · ")}</dd>
          </>
        ) : null}
        <dt>Accelerators</dt>
        <dd>
          <div className={styles.acc}>
            {vm.accelerators.filter((a) => a.available).length === 0 ? (
              <span className={styles.selEmpty}>—</span>
            ) : (
              vm.accelerators
                .filter((a) => a.available)
                .map((a) => (
                  <span key={a.id} className={styles.accChip}>
                    {a.label}
                  </span>
                ))
            )}
          </div>
        </dd>
      </dl>
    </div>
  );
}

function ProjectSection({ cfg }: { cfg: UseConfigurator }) {
  const { vm, board, mutate } = cfg;
  if (!vm) return null;
  const skuGroups = vm.som.options;
  return (
    <div className={styles.section}>
      <SectionLabel text="Project & Hardware" />
      <Field label="SoM SKU" hint="drives backend, default board & chips">
        <select
          className={styles.control}
          value={vm.som.selected}
          aria-label="SoM SKU"
          onChange={(e) =>
            mutate((d) => {
              d.som = d.som || { sku: "" };
              d.som.sku = e.target.value;
            })
          }
        >
          {skuGroups.map((g) => (
            <optgroup key={g.family} label={g.family}>
              {g.soms.map((s) => (
                <option key={s.sku} value={s.sku}>
                  {s.displayName}
                  {s.preliminary ? "  (preliminary)" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <Row>
        <Field label="Name">
          <TextInput
            label="Board name"
            value={board.name || ""}
            placeholder="(optional board name)"
            onChange={(v) =>
              mutate(
                (d) => {
                  if (v) d.name = v;
                  else delete d.name;
                },
                { debounce: true },
              )
            }
          />
        </Field>
        <Field label="Description">
          <TextInput
            label="Board description"
            value={board.description || ""}
            placeholder="(optional one-line description)"
            onChange={(v) =>
              mutate(
                (d) => {
                  if (v) d.description = v;
                  else delete d.description;
                },
                { debounce: true },
              )
            }
          />
        </Field>
      </Row>
      <Field
        label="Carrier / board preset"
        hint={
          vm.boardMode === "inline" ? "inline populated mode" : "preset mode"
        }
      >
        <Select
          label="Carrier / board preset"
          value={vm.carriers.selected || ""}
          options={[
            ["", "(inline — no preset)"],
            ...vm.carriers.options.map(
              (b) => [b.name, b.displayName || b.name] as Opt,
            ),
          ]}
          onChange={(v) =>
            mutate((d) => {
              if (v) d.preset = v;
              else delete d.preset;
            })
          }
        />
      </Field>
      <HardwareCard vm={vm} />
    </div>
  );
}

type CoreClass = "cortex-m" | "cortex-a" | "unknown";

/** Best-effort silicon class from the core ID (stopgap until the CLI emits the
 *  SoM topology's per-core class): m33/m55/… → Cortex-M, a55/a32/… → Cortex-A.
 *
 *  This used to carry a "KEEP IN SYNC with Rust `infer_runtime_for_core_id`
 *  (`cli-rs/crates/alp-core/src/wizard/service.rs`)" note. That counterpart is
 *  gone: `cli-rs/` is down to six files with no `wizard/`, and the symbol
 *  returns no hit anywhere on an alplabai default branch — the Rust wizard did
 *  not survive the cli-rs → tan-cli move. So this heuristic is UNPAIRED, and
 *  nothing here or in CI can gate it. If tan grows a per-core class in its
 *  topology output, delete this function rather than re-pairing it.
 *
 *  The old note also recorded a deliberate divergence worth keeping if a
 *  counterpart ever reappears: a runtime picker must resolve an unknown id to
 *  something (it chose `zephyr`), whereas this returns "unknown" on purpose so
 *  the UI offers every OS option instead of pre-committing the user. */
function coreSiliconClass(id: string): CoreClass {
  const s = id.toLowerCase();
  if (/(^|[_-])m\d/.test(s)) return "cortex-m";
  if (/(^|[_-])a\d/.test(s)) return "cortex-a";
  return "unknown";
}

/** DeepX NPU compile target enabled but missing its config/calibration path(s).
 *  A configurator-time gate so the user fixes it here instead of hitting a
 *  downstream `alp generate` file-not-found. */
function deepxPathMissing(m: ModelEntry): boolean {
  const d = m.compile?.deepx_dxm1;
  return !!d && (!d.config.trim() || !d.calibration.trim());
}

/** DRP-AI NPU compile target enabled but missing its spec path. */
function drpaiPathMissing(m: ModelEntry): boolean {
  const d = m.compile?.drpai;
  return !!d && !d.spec.trim();
}

/** The runtime a core naturally runs (its SoM-topology default). */
function naturalRuntime(id: string): string | null {
  const cls = coreSiliconClass(id);
  return cls === "cortex-m" ? "zephyr" : cls === "cortex-a" ? "yocto" : null;
}

/** Runtimes selectable for a core, gated by silicon class: a Cortex-A core runs
 *  Linux (Yocto) or off — you never pick Zephyr there; a Cortex-M core runs
 *  Zephyr (default), bare-metal, or off. Unknown ids fall back to all four. */
function runtimeOptions(id: string): Array<[string, string]> {
  const cls = coreSiliconClass(id);
  if (cls === "cortex-m")
    return [
      ["zephyr", "Zephyr (default)"],
      ["baremetal", "Bare-metal"],
      ["off", "Off (skip core)"],
    ];
  if (cls === "cortex-a")
    return [
      ["yocto", "Yocto Linux (default)"],
      ["off", "Off (skip core)"],
    ];
  return [
    ["zephyr", "Zephyr"],
    ["yocto", "Yocto Linux"],
    ["baremetal", "Bare-metal"],
    ["off", "Off (skip core)"],
  ];
}

/** Per-core peripheral classes. Source of truth is the vendored schema's
 * `$defs.core_entry.properties.peripherals.items.enum` in
 * schemas/board.schema.json; kept in sync manually (webview doesn't depend
 * on @alp-sdk/core). Drift-guarded by test/configurator.peripheralCatalog.test.js --
 * a schema change fails that test until this array is updated to match. */
const PERIPHERAL_CHOICES = [
  "adc",
  "can",
  "counter",
  "dac",
  "emmc",
  "ethernet",
  "flash",
  "gpio",
  "i2c",
  "i2s",
  "i3c",
  "pwm",
  "rtc",
  "sensor",
  "spi",
  "uart",
  "usb",
  "watchdog",
];

/** Names of the top-level `libraries[]` entries effective for `coreId`.
 * Mirrors `librariesForCore` in `@alp-sdk/core/board/models` (separate
 * webview build, kept in sync manually — see types.ts header comment). */
function librariesForCore(
  libraries: LibraryEntry[] | undefined,
  coreId: string,
): string[] {
  return (libraries ?? [])
    .filter(
      (entry) =>
        typeof entry === "string" ||
        entry.cores === undefined ||
        entry.cores.includes(coreId),
    )
    .map((entry) => (typeof entry === "string" ? entry : entry.name));
}

/** Apply a per-core library-name pick (this core's Libraries TagSelector) onto
 * the top-level `libraries[]` array. Mirrors `applyCoreLibrarySelection` in
 * `@alp-sdk/core/board/models` (same manual-sync caveat as above).
 *
 * Removing a *project-wide* entry (bare string / no `cores`) from a single
 * core's picker can't be expressed as "exclude just this core" — the schema
 * has no such primitive — so it is narrowed to the other ids in `allCoreIds`
 * (dropped entirely if that leaves none). `allCoreIds` is the SoM topology's
 * full core list (`vm.cores`, including topology-inherited cores with no
 * board.yaml override); narrowing still silently drops the library for any
 * core NOT in that list. */
function applyCoreLibrarySelection(
  libraries: LibraryEntry[] | undefined,
  coreId: string,
  nextNames: string[],
  allCoreIds: string[],
): LibraryEntry[] {
  const next = libraries ? [...libraries] : [];
  const currentNames = librariesForCore(next, coreId);
  const nextSet = new Set(nextNames);
  const indexOf = (name: string) =>
    next.findIndex((e) =>
      typeof e === "string" ? e === name : e.name === name,
    );

  for (const name of currentNames) {
    if (nextSet.has(name)) continue;
    const idx = indexOf(name);
    if (idx === -1) continue;
    const entry = next[idx];
    if (typeof entry === "string" || entry.cores === undefined) {
      const others = allCoreIds.filter((id) => id !== coreId);
      if (others.length === 0) next.splice(idx, 1);
      else next[idx] = { name, cores: others };
    } else {
      const cores = entry.cores.filter((id) => id !== coreId);
      if (cores.length === 0) next.splice(idx, 1);
      else next[idx] = { ...entry, cores };
    }
  }

  for (const name of nextNames) {
    if (currentNames.includes(name)) continue;
    const idx = indexOf(name);
    if (idx === -1) {
      next.push({ name, cores: [coreId] });
    } else {
      const entry = next[idx];
      if (
        typeof entry !== "string" &&
        entry.cores !== undefined &&
        !entry.cores.includes(coreId)
      ) {
        next[idx] = { ...entry, cores: [...entry.cores, coreId] };
      }
    }
  }

  return next;
}

function CoreCard({ core, cfg }: { core: CorePanel; cfg: UseConfigurator }) {
  const { mutate, vm } = cfg;
  const ensure = (d: BoardConfig) => {
    d.cores = d.cores || {};
    d.cores[core.id] = d.cores[core.id] || {};
    return d.cores[core.id];
  };

  if (core.inheritedFromTopology) {
    return (
      <div className={`${styles.core} ${styles.coreGhost}`}>
        <div className={styles.coreHd}>
          <span className={styles.coreId}>{core.id}</span>
          {core.hwConsole === false ? (
            <span
              className={styles.warn}
              title="No console UART on this core (alp-sdk#686) — use the ram console backend."
            >
              headless — no console UART
            </span>
          ) : null}
          <span className={styles.coreSpacer} />
          <span className={styles.coreInherit}>inherits SoM default</span>
        </div>
        <div className={styles.ghostNote}>
          Runs the SoM preset&apos;s default image. Override to set this
          core&apos;s runtime and its own app directory.{" "}
          <button
            type="button"
            className={styles.btn}
            onClick={() => mutate((d) => void ensure(d))}
          >
            Override (set app directory)
          </button>
        </div>
      </div>
    );
  }

  const currentOs = core.os || naturalRuntime(core.id) || "zephyr";
  const enabled = currentOs !== "off";
  return (
    <div className={styles.core}>
      <div className={styles.coreHd}>
        <span className={styles.coreId}>{core.id}</span>
        {core.hwConsole === false ? (
          <span
            className={styles.warn}
            title="No console UART on this core (alp-sdk#686) — use the ram console backend."
          >
            headless — no console UART
          </span>
        ) : null}
        <span className={styles.coreSpacer} />
        <select
          className={`${styles.control} ${styles.coreRuntime}`}
          value={currentOs}
          aria-label={`Runtime for ${core.id}`}
          title="Runtime is fixed by the SoM's core silicon class — override only to bare-metal or off."
          onChange={(e) => {
            const next = e.target.value;
            mutate((d) => {
              const c = ensure(d);
              // Selecting the SoM-natural OS clears the override (inherit).
              if (next === naturalRuntime(core.id)) delete c.os;
              else c.os = next as never;
            });
          }}
        >
          {runtimeOptions(core.id).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {!enabled ? (
        <div className={styles.ghostNote}>Disabled (os: off).</div>
      ) : (
        <div className={styles.coreBody}>
          <Row>
            <Field label="App directory">
              <TextInput
                label="App directory"
                value={core.app || ""}
                placeholder="./src"
                onChange={(v) =>
                  mutate(
                    (d) => {
                      const c = ensure(d);
                      if (v) c.app = v;
                      else delete c.app;
                    },
                    { debounce: true },
                  )
                }
              />
            </Field>
            <Field label="Inference arena (KiB)">
              <NumberInput
                label="Inference arena (KiB)"
                value={
                  core.inferenceArenaKib != null
                    ? String(core.inferenceArenaKib)
                    : ""
                }
                placeholder="128"
                onChange={(v) =>
                  mutate(
                    (d) => {
                      const c = ensure(d);
                      const n = parseInt(v, 10);
                      if (Number.isFinite(n)) {
                        c.inference = c.inference || {};
                        c.inference.default_arena_kib = n;
                      } else if (c.inference) {
                        delete c.inference.default_arena_kib;
                        if (Object.keys(c.inference).length === 0)
                          delete c.inference;
                      }
                    },
                    { debounce: true },
                  )
                }
              />
            </Field>
          </Row>
          <Field label="Connectivity (IoT)">
            <div className={styles.chips}>
              {(["wifi", "mqtt", "ble", "tls"] as const).map((flag) => {
                const on = core.iot[flag];
                return (
                  <button
                    key={flag}
                    type="button"
                    className={`${styles.chip} ${on ? styles.chipOn : ""}`}
                    aria-pressed={on}
                    onClick={() =>
                      mutate((d) => {
                        const c = ensure(d);
                        c.iot = c.iot || {};
                        if (on) delete c.iot[flag];
                        else c.iot[flag] = true;
                        if (Object.keys(c.iot).length === 0) delete c.iot;
                      })
                    }
                  >
                    {flag}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field
            label="Peripherals"
            hint="Peripheral subsystems this core uses directly — enables the matching Zephyr Kconfig / Yocto package."
          >
            <TagSelector
              all={PERIPHERAL_CHOICES}
              selected={core.peripherals}
              placeholder="Add peripheral…"
              onChange={(next) =>
                mutate((d) => {
                  const c = ensure(d);
                  if (next.length) c.peripherals = next;
                  else delete c.peripherals;
                })
              }
            />
          </Field>
          <Field label="Libraries">
            <TagSelector
              all={vm?.libraries ?? []}
              selected={core.libraries}
              placeholder="Add library…"
              onChange={(next) =>
                mutate((d) => {
                  ensure(d);
                  const allCoreIds = (vm?.cores ?? []).map((c) => c.id);
                  const libraries = applyCoreLibrarySelection(
                    d.libraries,
                    core.id,
                    next,
                    allCoreIds,
                  );
                  if (libraries.length) d.libraries = libraries;
                  else delete d.libraries;
                })
              }
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function CoresSection({ cfg }: { cfg: UseConfigurator }) {
  const { vm } = cfg;
  if (!vm) return null;
  return (
    <div className={`${styles.section} ${styles.wide}`}>
      <SectionLabel
        text={`Cores · ${vm.som.selected || "—"}`}
        hint="One slice per core from the SoM topology. Blank cores inherit the SoM preset's defaults."
      />
      {vm.cores.map((core) => (
        <CoreCard key={core.id} core={core} cfg={cfg} />
      ))}
    </div>
  );
}

function ChipsSection({ cfg }: { cfg: UseConfigurator }) {
  const { vm, board, mutate } = cfg;
  if (!vm) return null;
  const allChips = (vm.chips as ChipChoice[]).map((c) => c.chipId);
  return (
    <div className={styles.section}>
      <SectionLabel
        text="Chips"
        hint="Chip drivers the app links directly via <alp/chips/…>, project-wide. Filtered to the selected SoM's family."
      />
      <Field
        label="Linked chip drivers"
        hint={`${allChips.length} chip drivers available for this SoM`}
      >
        <TagSelector
          all={allChips}
          selected={board.chips ?? []}
          placeholder="Add chip driver…"
          onChange={(next) =>
            mutate((d) => {
              if (next.length) d.chips = next;
              else delete d.chips;
            })
          }
        />
      </Field>
    </div>
  );
}

const LOG_LEVELS: Opt[] = [
  ["error", "error"],
  ["warn", "warn"],
  ["info", "info"],
  ["debug", "debug"],
  ["trace", "trace"],
];

const CONSOLE_BACKENDS: Opt[] = [
  ["auto", "auto — by slice OS"],
  ["alp", "alp — module UART"],
  ["uart", "uart — module UART"],
  ["ram", "ram — RAM console (SWD)"],
  ["linux", "linux — Linux console"],
  ["none", "none — board default"],
];

/** Where a core's printf/LOG output goes, and how you read it, for each console
 *  backend — shown live under the selector so the debug path is explicit. */
const CONSOLE_BACKEND_HELP: Record<string, string> = {
  auto: "Default. Picks by slice OS: a Zephyr slice → the module UART console; a Yocto slice → the Linux console.",
  alp: "printf / LOG → the module console UART (e.g. E1M edge UART0). Read it on a serial terminal.",
  uart: "printf / LOG → the module console UART (e.g. E1M edge UART0). Read it on a serial terminal.",
  ram: "printf / LOG → the Zephyr RAM console buffer (ram_console_buf) — no UART needed. Read it over SWD/J-Link, for serial-less bench boards.",
  linux:
    "Kernel/console output → the Linux console (Yocto slice), on the Linux tty.",
  none: "No console Kconfig emitted — inherits the board's default console (DT zephyr,console).",
};

function DiagnosticsSection({ cfg }: { cfg: UseConfigurator }) {
  const { board, mutate, vm } = cfg;
  const d = board.diagnostics ?? {};
  const modules = d.modules ?? {};
  const [newMod, setNewMod] = useState("");
  const { recommendation, warning } = consoleRecommendation(
    vm?.cores ?? [],
    d.console,
  );

  const cleanup = (draft: BoardConfig) => {
    if (draft.diagnostics && Object.keys(draft.diagnostics).length === 0)
      delete draft.diagnostics;
  };

  return (
    <div className={styles.section}>
      <SectionLabel text="Diagnostics" />
      <div className={styles.field}>
        <Check
          checked={d.last_error !== false}
          label="Keep alp_last_error() slot (thread-local)"
          onChange={(c) =>
            mutate((draft) => {
              draft.diagnostics = draft.diagnostics || {};
              if (c) delete draft.diagnostics.last_error;
              else draft.diagnostics.last_error = false;
              cleanup(draft);
            })
          }
        />
      </div>
      <Field
        label="Default log level"
        hint="applies to every module without an override below"
      >
        <Select
          label="Default log level"
          value={d.log_level || "info"}
          options={LOG_LEVELS}
          onChange={(v) =>
            mutate((draft) => {
              draft.diagnostics = draft.diagnostics || {};
              if (v === "info") delete draft.diagnostics.log_level;
              else draft.diagnostics.log_level = v as never;
              cleanup(draft);
            })
          }
        />
      </Field>
      <Field
        label="Console backend"
        hint={CONSOLE_BACKEND_HELP[d.console || "auto"]}
      >
        <Select
          label="Console backend"
          value={d.console || "auto"}
          options={CONSOLE_BACKENDS}
          onChange={(v) =>
            mutate((draft) => {
              draft.diagnostics = draft.diagnostics || {};
              if (v === "auto") delete draft.diagnostics.console;
              else draft.diagnostics.console = v as never;
              cleanup(draft);
            })
          }
        />
      </Field>
      {recommendation ? (
        <div className={styles.hint}>{recommendation}</div>
      ) : null}
      {warning ? <div className={styles.warn}>{warning}</div> : null}
      <div className={styles.field}>
        <Check
          checked={d.sim_console === true}
          label="Simulator console for headless cores (issue #686)"
          onChange={(c) =>
            mutate((draft) => {
              draft.diagnostics = draft.diagnostics || {};
              if (c) draft.diagnostics.sim_console = true;
              else delete draft.diagnostics.sim_console;
              cleanup(draft);
            })
          }
        />
      </div>
      <Field label="Per-module overrides">
        <div className={styles.modules}>
          {Object.keys(modules).length === 0 ? (
            <span className={styles.selEmpty}>
              no overrides — every module uses the default level
            </span>
          ) : (
            Object.entries(modules).map(([name, level]) => (
              <div key={name} className={styles.modRow}>
                <span className={styles.modName}>{name}</span>
                <Select
                  label={`${name} log level`}
                  value={level}
                  options={[...LOG_LEVELS, ["off", "off"]]}
                  onChange={(v) =>
                    mutate((draft) => {
                      draft.diagnostics = draft.diagnostics || {};
                      draft.diagnostics.modules =
                        draft.diagnostics.modules || {};
                      draft.diagnostics.modules[name] = v as never;
                    })
                  }
                />
                <button
                  type="button"
                  className={styles.modX}
                  aria-label={`Remove ${name}`}
                  onClick={() =>
                    mutate((draft) => {
                      if (draft.diagnostics?.modules) {
                        delete draft.diagnostics.modules[name];
                        if (Object.keys(draft.diagnostics.modules).length === 0)
                          delete draft.diagnostics.modules;
                      }
                      cleanup(draft);
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))
          )}
          <div className={styles.modAdd}>
            <TextInput
              label="New module name"
              value={newMod}
              placeholder="module name (e.g. alp_inference)"
              onChange={setNewMod}
            />
            <button
              type="button"
              className={styles.btn}
              onClick={() => {
                const name = newMod.trim();
                if (/^[a-z][a-z0-9_]*$/.test(name)) {
                  mutate((draft) => {
                    draft.diagnostics = draft.diagnostics || {};
                    draft.diagnostics.modules = draft.diagnostics.modules || {};
                    draft.diagnostics.modules[name] = "debug";
                  });
                  setNewMod("");
                }
              }}
            >
              Add override
            </button>
          </div>
        </div>
      </Field>
    </div>
  );
}

function AdvancedSection({ cfg }: { cfg: UseConfigurator }) {
  const { board, mutate } = cfg;
  const boot = board.boot ?? {};
  const storage = board.storage ?? [];
  const sec = board.security?.psa;
  const ota: Partial<Ota> = board.ota ?? {};
  const ipc = board.ipc ?? [];
  const models = board.models ?? [];

  return (
    <div className={`${styles.section} ${styles.wide}`}>
      <SectionLabel
        text="Advanced"
        hint="Production blocks — bootloader, storage, security, OTA, and cross-core IPC. Leave a block off to use the SDK defaults."
      />

      {/* Boot */}
      <AdvCard title="Boot">
        <Field label="Bootloader">
          <Select
            label="Bootloader"
            value={boot.method || ""}
            options={[
              ["", "(SDK default)"],
              ["mcuboot", "mcuboot"],
              ["none", "none"],
            ]}
            onChange={(v) =>
              mutate((d) => {
                if (!v) delete d.boot;
                else {
                  d.boot = d.boot || {};
                  d.boot.method = v as never;
                }
              })
            }
          />
        </Field>
        {boot.method === "mcuboot" ? (
          <>
            <Row>
              <Field label="Signing algorithm">
                <Select
                  label="Signing algorithm"
                  value={boot.signing?.algorithm || "ecdsa_p256"}
                  options={[
                    ["ecdsa_p256", "ecdsa_p256"],
                    ["rsa2048", "rsa2048"],
                    ["rsa3072", "rsa3072"],
                    ["ed25519", "ed25519"],
                  ]}
                  onChange={(v) =>
                    mutate((d) => {
                      d.boot = d.boot || {};
                      d.boot.signing = d.boot.signing || {
                        algorithm: "ecdsa_p256",
                        key_file: "",
                      };
                      d.boot.signing.algorithm = v as never;
                    })
                  }
                />
              </Field>
              <Field label="Public key file">
                <TextInput
                  label="Public key file"
                  value={boot.signing?.key_file || ""}
                  placeholder="keys/prod.pub.pem"
                  onChange={(v) =>
                    mutate(
                      (d) => {
                        d.boot = d.boot || {};
                        d.boot.signing = d.boot.signing || {
                          algorithm: "ecdsa_p256",
                          key_file: "",
                        };
                        d.boot.signing.key_file = v;
                      },
                      { debounce: true },
                    )
                  }
                />
              </Field>
            </Row>
            <Row>
              <Field label="Swap algorithm">
                <Select
                  label="Swap algorithm"
                  value={boot.swap_algorithm || "scratch"}
                  options={[
                    ["scratch", "scratch"],
                    ["move", "move"],
                    ["overwrite", "overwrite"],
                  ]}
                  onChange={(v) =>
                    mutate((d) => {
                      d.boot = d.boot || {};
                      if (v === "scratch") delete d.boot.swap_algorithm;
                      else d.boot.swap_algorithm = v as never;
                    })
                  }
                />
              </Field>
              <Field label="Build type">
                <Select
                  label="Build type"
                  value={boot.build_type || "Release"}
                  options={[
                    ["Release", "Release"],
                    ["Debug", "Debug"],
                    ["MinSizeRel", "MinSizeRel"],
                  ]}
                  onChange={(v) =>
                    mutate((d) => {
                      d.boot = d.boot || {};
                      if (v === "Release") delete d.boot.build_type;
                      else d.boot.build_type = v as never;
                    })
                  }
                />
              </Field>
            </Row>
          </>
        ) : null}
      </AdvCard>

      {/* Storage */}
      <AdvCard title="Storage partitions">
        <div className={styles.partList}>
          {storage.length === 0 ? (
            <span className={styles.selEmpty}>no partitions</span>
          ) : (
            storage.map((p, i) => (
              <div key={i} className={styles.partRow}>
                <TextInput
                  label="Partition name"
                  value={p.name}
                  placeholder="name"
                  onChange={(v) =>
                    mutate(
                      (d) => {
                        d.storage![i].name = v;
                      },
                      { debounce: true },
                    )
                  }
                />
                <NumberInput
                  label="Partition size KiB"
                  value={p.size_kib != null ? String(p.size_kib) : ""}
                  placeholder="size KiB"
                  onChange={(v) =>
                    mutate(
                      (d) => {
                        const n = parseInt(v, 10);
                        if (Number.isFinite(n)) d.storage![i].size_kib = n;
                      },
                      { debounce: true },
                    )
                  }
                />
                <Select
                  label="Filesystem"
                  value={p.fs || "raw"}
                  options={[
                    ["raw", "raw"],
                    ["littlefs", "littlefs"],
                    ["fat", "fat"],
                    ["ext4", "ext4"],
                  ]}
                  onChange={(v) =>
                    mutate((d) => {
                      if (v === "raw") delete d.storage![i].fs;
                      else d.storage![i].fs = v as never;
                    })
                  }
                />
                <TextInput
                  label="Flash device"
                  value={p.flash_device || ""}
                  placeholder="flash device"
                  onChange={(v) =>
                    mutate(
                      (d) => {
                        if (v) d.storage![i].flash_device = v;
                        else delete d.storage![i].flash_device;
                      },
                      { debounce: true },
                    )
                  }
                />
                <button
                  type="button"
                  className={styles.modX}
                  aria-label="Remove partition"
                  onClick={() =>
                    mutate((d) => {
                      d.storage!.splice(i, 1);
                      if (d.storage!.length === 0) delete d.storage;
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
        <button
          type="button"
          className={styles.btn}
          onClick={() =>
            mutate((d) => {
              d.storage = d.storage || [];
              d.storage.push({ name: "data", size_kib: 64 });
            })
          }
        >
          Add partition
        </button>
      </AdvCard>

      {/* Security */}
      <AdvCard title="Security (PSA)">
        <Check
          checked={!!sec}
          label="Enable PSA Crypto key store"
          onChange={(c) =>
            mutate((d) => {
              if (c) {
                d.security = d.security || {};
                d.security.psa = d.security.psa || {};
              } else delete d.security;
            })
          }
        />
        {sec ? (
          <>
            <Row>
              <Field label="Persistent key slots">
                <NumberInput
                  label="Persistent key slots"
                  value={
                    sec.persistent_slots != null
                      ? String(sec.persistent_slots)
                      : ""
                  }
                  placeholder="16"
                  onChange={(v) =>
                    mutate(
                      (d) => {
                        d.security = d.security || {};
                        d.security.psa = d.security.psa || {};
                        const n = parseInt(v, 10);
                        if (Number.isFinite(n))
                          d.security.psa.persistent_slots = n;
                        else delete d.security.psa.persistent_slots;
                      },
                      { debounce: true },
                    )
                  }
                />
              </Field>
              <Field label="Attestation root">
                <Select
                  label="Attestation root"
                  value={sec.attestation_root || "none"}
                  options={[
                    ["none", "none"],
                    ["optiga_trust_m", "optiga_trust_m"],
                    ["tfm_internal", "tfm_internal"],
                  ]}
                  onChange={(v) =>
                    mutate((d) => {
                      d.security = d.security || {};
                      d.security.psa = d.security.psa || {};
                      if (v === "none") delete d.security.psa.attestation_root;
                      else d.security.psa.attestation_root = v as never;
                    })
                  }
                />
              </Field>
            </Row>
            <Check
              checked={!!sec.tfm}
              label="Enable TF-M secure partition"
              onChange={(c) =>
                mutate((d) => {
                  d.security = d.security || {};
                  d.security.psa = d.security.psa || {};
                  if (c) d.security.psa.tfm = true;
                  else delete d.security.psa.tfm;
                })
              }
            />
          </>
        ) : null}
      </AdvCard>

      {/* OTA */}
      <AdvCard title="OTA">
        <Field label="OTA provider">
          <Select
            label="OTA provider"
            value={ota.provider || ""}
            options={[
              ["", "(none)"],
              ["mender", "mender"],
              ["hawkbit", "hawkbit"],
              ["mcumgr", "mcumgr"],
            ]}
            onChange={(v) =>
              mutate((d) => {
                if (!v) delete d.ota;
                else {
                  d.ota = d.ota || { provider: "none" };
                  d.ota.provider = v as never;
                }
              })
            }
          />
        </Field>
        {ota.provider ? (
          <>
            <Row>
              <Field label="Artifact name">
                <TextInput
                  label="Artifact name"
                  value={ota.artifact_name || ""}
                  placeholder="my-fw-v1"
                  onChange={(v) =>
                    mutate(
                      (d) => {
                        d.ota = d.ota || { provider: "none" };
                        if (v) d.ota.artifact_name = v;
                        else delete d.ota.artifact_name;
                      },
                      { debounce: true },
                    )
                  }
                />
              </Field>
              <Field label="Poll interval (s)">
                <NumberInput
                  label="Poll interval (s)"
                  value={
                    ota.poll_interval_s != null
                      ? String(ota.poll_interval_s)
                      : ""
                  }
                  placeholder="1800"
                  onChange={(v) =>
                    mutate(
                      (d) => {
                        d.ota = d.ota || { provider: "none" };
                        const n = parseInt(v, 10);
                        if (Number.isFinite(n)) d.ota.poll_interval_s = n;
                        else delete d.ota.poll_interval_s;
                      },
                      { debounce: true },
                    )
                  }
                />
              </Field>
            </Row>
            <Field label="Server URL">
              <TextInput
                label="Server URL"
                value={ota.server?.url || ""}
                placeholder="https://hosted.mender.io"
                onChange={(v) =>
                  mutate(
                    (d) => {
                      d.ota = d.ota || { provider: "none" };
                      if (v) d.ota.server = { ...(d.ota.server || {}), url: v };
                      else delete d.ota.server;
                    },
                    { debounce: true },
                  )
                }
              />
            </Field>
          </>
        ) : null}
      </AdvCard>

      {/* IPC */}
      <AdvCard title="IPC carve-outs">
        <div className={styles.partList}>
          {ipc.length === 0 ? (
            <span className={styles.selEmpty}>no IPC channels</span>
          ) : (
            ipc.map((e, i) => (
              <div key={i} className={`${styles.partRow} ${styles.ipcRow}`}>
                <TextInput
                  label="IPC name"
                  value={e.name}
                  placeholder="name"
                  onChange={(v) =>
                    mutate(
                      (d) => {
                        d.ipc![i].name = v;
                      },
                      { debounce: true },
                    )
                  }
                />
                <Select
                  label="IPC kind"
                  value={e.kind || "rpmsg"}
                  options={[
                    ["rpmsg", "rpmsg"],
                    ["raw_shmem", "raw_shmem"],
                    ["mailbox_only", "mailbox_only"],
                  ]}
                  onChange={(v) =>
                    mutate((d) => {
                      d.ipc![i].kind = v as never;
                    })
                  }
                />
                <TextInput
                  label="IPC endpoints"
                  value={(e.endpoints || []).join(", ")}
                  placeholder="core_a, core_b"
                  onChange={(v) =>
                    mutate(
                      (d) => {
                        d.ipc![i].endpoints = v
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean);
                      },
                      { debounce: true },
                    )
                  }
                />
                <NumberInput
                  label="IPC carve-out KiB"
                  value={e.carve_out_kb != null ? String(e.carve_out_kb) : ""}
                  placeholder="KiB"
                  onChange={(v) =>
                    mutate(
                      (d) => {
                        const n = parseInt(v, 10);
                        if (Number.isFinite(n)) d.ipc![i].carve_out_kb = n;
                      },
                      { debounce: true },
                    )
                  }
                />
                <button
                  type="button"
                  className={styles.modX}
                  aria-label="Remove IPC channel"
                  onClick={() =>
                    mutate((d) => {
                      d.ipc!.splice(i, 1);
                      if (d.ipc!.length === 0) delete d.ipc;
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
        <button
          type="button"
          className={styles.btn}
          onClick={() =>
            mutate((d) => {
              d.ipc = d.ipc || [];
              d.ipc.push({
                kind: "rpmsg",
                name: "alp_rpmsg",
                endpoints: [],
                carve_out_kb: 256,
              });
            })
          }
        >
          Add IPC channel
        </button>
      </AdvCard>

      {/* AI models */}
      <AdvCard title="AI models">
        <div className={styles.partList}>
          {models.length === 0 ? (
            <span className={styles.selEmpty}>no models</span>
          ) : (
            models.map((m, i) => (
              <div key={i} className={`${styles.partRow} ${styles.modelRow}`}>
                <TextInput
                  label="Model name"
                  value={m.name}
                  placeholder="name"
                  onChange={(v) =>
                    mutate(
                      (d) => {
                        d.models![i].name = v;
                      },
                      { debounce: true },
                    )
                  }
                />
                <TextInput
                  label="Source path"
                  value={m.source}
                  placeholder="models/foo.tflite"
                  onChange={(v) =>
                    mutate(
                      (d) => {
                        d.models![i].source = v;
                      },
                      { debounce: true },
                    )
                  }
                />
                <label
                  className={`${styles.modelChk}${
                    deepxPathMissing(m) ? " " + styles.modelChkWarn : ""
                  }`}
                  title={
                    deepxPathMissing(m)
                      ? "DeepX is enabled but its config/calibration paths are empty — fill them in the YAML, or `alp generate` fails with file-not-found."
                      : "Compile for the DeepX DX-M1 NPU — fill the config/calibration paths in YAML"
                  }
                >
                  <input
                    type="checkbox"
                    checked={!!m.compile?.deepx_dxm1}
                    onChange={(e) =>
                      mutate((d) => {
                        const mm = d.models![i];
                        mm.compile = mm.compile || {};
                        if (e.target.checked)
                          // Schema requires both paths; seed empty for the user to fill.
                          mm.compile.deepx_dxm1 = mm.compile.deepx_dxm1 || {
                            config: "",
                            calibration: "",
                          };
                        else {
                          delete mm.compile.deepx_dxm1;
                          if (!mm.compile.drpai) delete mm.compile;
                        }
                      })
                    }
                  />
                  DeepX
                </label>
                <label
                  className={`${styles.modelChk}${
                    drpaiPathMissing(m) ? " " + styles.modelChkWarn : ""
                  }`}
                  title={
                    drpaiPathMissing(m)
                      ? "DRP-AI is enabled but its spec path is empty — fill it in the YAML, or `alp generate` fails with file-not-found."
                      : "Compile for the Renesas DRP-AI NPU — fill the spec path in YAML"
                  }
                >
                  <input
                    type="checkbox"
                    checked={!!m.compile?.drpai}
                    onChange={(e) =>
                      mutate((d) => {
                        const mm = d.models![i];
                        mm.compile = mm.compile || {};
                        if (e.target.checked)
                          // Schema requires the spec path; seed empty for the user to fill.
                          mm.compile.drpai = mm.compile.drpai || { spec: "" };
                        else {
                          delete mm.compile.drpai;
                          if (!mm.compile.deepx_dxm1) delete mm.compile;
                        }
                      })
                    }
                  />
                  DRP-AI
                </label>
                <button
                  type="button"
                  className={styles.modX}
                  aria-label="Remove model"
                  onClick={() =>
                    mutate((d) => {
                      d.models!.splice(i, 1);
                      if (d.models!.length === 0) delete d.models;
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
        <button
          type="button"
          className={styles.btn}
          onClick={() =>
            mutate((d) => {
              d.models = d.models || [];
              d.models.push({ name: "model", source: "models/model.tflite" });
            })
          }
        >
          Add model
        </button>
      </AdvCard>
    </div>
  );
}

function ReviewSection({ cfg }: { cfg: UseConfigurator }) {
  const { vm, board, preview, validation } = cfg;
  if (!vm) return null;
  const enabledCores = vm.cores
    .filter((c) => !c.inheritedFromTopology && c.os !== "off")
    .map((c) => c.id);
  return (
    <div className={styles.section}>
      <SectionLabel text="Review" />
      {validation.errors.length ? (
        <>
          <p className={`${styles.revHead} ${styles.err}`}>
            <Icon name="x" size={14} /> {validation.errors.length} error(s)
          </p>
          <ul className={styles.revList}>
            {validation.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className={`${styles.revHead} ${styles.ok}`}>
          <Icon name="check" size={14} /> board.yaml is valid
        </p>
      )}
      {validation.warnings.length ? (
        <ul className={`${styles.revList} ${styles.warn}`}>
          {validation.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}

      <div className={styles.card}>
        <div className={styles.cardTop}>
          <span className={styles.cardName}>Effective summary</span>
        </div>
        <dl className={styles.kv}>
          <dt>SoM</dt>
          <dd>{vm.som.selected || "—"}</dd>
          <dt>Board</dt>
          <dd>
            {board.preset
              ? board.preset
              : vm.boardMode === "inline"
                ? "inline"
                : "—"}
          </dd>
          <dt>Active cores</dt>
          <dd>{enabledCores.length ? enabledCores.join(" · ") : "—"}</dd>
          {board.chips && board.chips.length ? (
            <>
              <dt>Chips</dt>
              <dd>{board.chips.join(" · ")}</dd>
            </>
          ) : null}
        </dl>
      </div>

      <div style={{ marginTop: 14 }}>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={preview}
        >
          Preview effective config
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── shell ─────────────────────────

export function ConfiguratorView() {
  const cfg = useConfigurator();
  const [active, setActive] = useState<ConfiguratorSection>("project");
  const {
    sdkConnected,
    dirty,
    validation,
    boardPath,
    status,
    save,
    reload,
    preview,
  } = cfg;

  const validClass = validation.errors.length ? styles.vErr : styles.vOk;
  const validText = validation.errors.length
    ? `✗ ${validation.errors.length} error${validation.errors.length > 1 ? "s" : ""}`
    : validation.warnings.length
      ? `⚠ ${validation.warnings.length} warning${validation.warnings.length > 1 ? "s" : ""}`
      : "✓ Valid — ready to save";

  function renderSection() {
    if (!cfg.loaded) {
      return <p className={styles.secHelp}>Loading board.yaml…</p>;
    }
    if (cfg.parseError) {
      return (
        <div className={styles.section}>
          <SectionLabel
            text="board.yaml could not be parsed"
            hint="Fix the YAML syntax in the text editor (Reopen Editor With… → Text Editor), then reopen the configurator. Editing is disabled here so your file is never overwritten."
          />
          <p className={`${styles.secHelp} ${styles.err}`}>{cfg.parseError}</p>
        </div>
      );
    }
    if (!sdkConnected) {
      return (
        <div className={styles.section}>
          <SectionLabel
            text="SDK catalog not connected"
            hint="No Alp SDK is linked, so the SoM / board / chip pickers can't load. Set alpSdk.path to your alp-sdk checkout to enable catalog-assisted editing — your board.yaml still validates and saves without it."
          />
        </div>
      );
    }
    switch (active) {
      case "cores":
        return <CoresSection cfg={cfg} />;
      case "chips":
        return <ChipsSection cfg={cfg} />;
      case "diagnostics":
        return <DiagnosticsSection cfg={cfg} />;
      case "advanced":
        return <AdvancedSection cfg={cfg} />;
      case "review":
        return <ReviewSection cfg={cfg} />;
      default:
        return <ProjectSection cfg={cfg} />;
    }
  }

  return (
    <div className={styles.root}>
      <header className={styles.topbar}>
        <span className={styles.topTitle}>Board Configurator</span>
        <span className={styles.topSpacer} />
        <span className={styles.savedTag}>
          {boardPath ? `board.yaml · ${dirty ? "edited" : "saved"}` : ""}
        </span>
      </header>

      <div className={styles.shell}>
        <nav className={styles.nav} aria-label="Configurator sections">
          {CONFIGURATOR_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`${styles.navItem} ${active === s.id ? styles.navActive : ""}`}
              aria-current={active === s.id}
              onClick={() => setActive(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <main className={styles.main}>{renderSection()}</main>
      </div>

      {validation.errors.length > 0 && (
        <div className={styles.vBanner} role="alert">
          <p className={styles.vBannerHead}>
            This board.yaml has {validation.errors.length} validation error
            {validation.errors.length > 1 ? "s" : ""}:
          </p>
          <ul className={styles.vBannerList}>
            {validation.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      <footer className={styles.footer}>
        <span className={`${styles.valid} ${validClass}`} role="status">
          {validText}
        </span>
        {status ? (
          <span className={styles.statusMsg} role="status" aria-live="polite">
            {status}
          </span>
        ) : null}
        <span className={styles.footSpacer} />
        <button type="button" className={styles.btn} onClick={preview}>
          Preview
        </button>
        <button type="button" className={styles.btn} onClick={reload}>
          Reload
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.btnPrimary}`}
          title="Save board.yaml"
          onClick={save}
        >
          Save board.yaml
        </button>
      </footer>
    </div>
  );
}
