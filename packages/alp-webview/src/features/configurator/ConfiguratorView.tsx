import { useId, useMemo, useState } from "react";
import { Icon } from "../../shared/ui";
import type {
  BoardConfig,
  ChipChoice,
  ConfiguratorViewModel,
  CorePanel,
  Ota,
} from "../../types";
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

function TextInput({
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
  return (
    <input
      className={styles.control}
      type="text"
      value={value}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function NumberInput({
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
  return (
    <input
      className={styles.control}
      type="number"
      value={value}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
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
          <span className={styles.coreSpacer} />
          <span className={styles.coreInherit}>inherits SoM default</span>
        </div>
        <div className={styles.ghostNote}>
          Runs the SoM preset&apos;s default image.{" "}
          <button
            type="button"
            className={styles.btn}
            onClick={() => mutate((d) => void ensure(d))}
          >
            Override this core
          </button>
        </div>
      </div>
    );
  }

  const enabled = core.os !== "off";
  return (
    <div className={styles.core}>
      <div className={styles.coreHd}>
        <span className={styles.coreId}>{core.id}</span>
        <span className={styles.coreSpacer} />
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={enabled}
          onClick={() =>
            mutate((d) => {
              const c = ensure(d);
              if (enabled) c.os = "off";
              else delete c.os;
            })
          }
        >
          <span>Enabled</span>
          <span className={`${styles.sw} ${enabled ? styles.swOn : ""}`} />
        </button>
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
          <Field label="Libraries">
            <TagSelector
              all={vm?.libraries ?? []}
              selected={core.libraries}
              placeholder="Add library…"
              onChange={(next) =>
                mutate((d) => {
                  const c = ensure(d);
                  if (next.length) c.libraries = next;
                  else delete c.libraries;
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

function DiagnosticsSection({ cfg }: { cfg: UseConfigurator }) {
  const { board, mutate } = cfg;
  const d = board.diagnostics ?? {};
  const modules = d.modules ?? {};
  const [newMod, setNewMod] = useState("");

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
            <Check
              checked={!!boot.anti_rollback}
              label="Anti-rollback (monotonic image counters)"
              onChange={(c) =>
                mutate((d) => {
                  d.boot = d.boot || {};
                  if (c) d.boot.anti_rollback = true;
                  else delete d.boot.anti_rollback;
                })
              }
            />
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
  const { sdkConnected, dirty, validation, boardPath, save, reload, preview } =
    cfg;

  const validClass = validation.errors.length ? styles.vErr : styles.vOk;
  const validText = validation.errors.length
    ? `✗ ${validation.errors.length} error${validation.errors.length > 1 ? "s" : ""}: ${validation.errors[0]}`
    : validation.warnings.length
      ? `⚠ ${validation.warnings.length} warning${validation.warnings.length > 1 ? "s" : ""}`
      : "✓ Valid";

  function renderSection() {
    if (!cfg.loaded) {
      return <p className={styles.secHelp}>Loading board.yaml…</p>;
    }
    if (!sdkConnected) {
      return (
        <div className={styles.section}>
          <SectionLabel
            text="Not connected"
            hint="No ALP SDK found. Set alpSdk.path to your alp-sdk checkout to load SoMs, boards, chips and libraries."
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
        <div className={styles.brand}>
          <span className={styles.bolt} aria-hidden="true">
            <Icon name="bolt" size={16} />
          </span>
          <span className={styles.brandName}>
            ALP<span className={styles.brandLab}>LAB</span>
          </span>
        </div>
        <span className={styles.topDivider} aria-hidden="true" />
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

      <footer className={styles.footer}>
        <span className={`${styles.valid} ${validClass}`} role="status">
          {validText}
        </span>
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
          disabled={!dirty || validation.errors.length > 0}
          onClick={save}
        >
          Save board.yaml
        </button>
      </footer>
    </div>
  );
}
