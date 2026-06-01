import { useMemo, useState } from "react";
import { Button, Skeleton } from "../../shared/ui";
import { postMessage } from "../../vscode";
import styles from "./ConfiguratorView.module.css";
import {
    CONFIGURATOR_SECTIONS,
    CORE_OS_CHOICES,
    useConfigurator,
    type ConfiguratorSection,
    type IotKey,
} from "./useConfigurator";

const IOT_FIELDS: { key: IotKey; label: string }[] = [
  { key: "wifi", label: "Wi-Fi station path" },
  { key: "mqtt", label: "MQTT client" },
  { key: "ble", label: "BLE host stack" },
  { key: "tls", label: "TLS (MbedTLS-backed <alp/security.h>)" },
];

function Select({
  label,
  value,
  options,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <select
        className={styles.select}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ConfiguratorView() {
  const cfg = useConfigurator();
  const [mode, setMode] = useState<"basic" | "advanced">("basic");
  const [activeSection, setActiveSection] =
    useState<ConfiguratorSection>("project");

  const visibleSections = useMemo(
    () =>
      CONFIGURATOR_SECTIONS.filter(
        (s) => mode === "advanced" || s.level !== "advanced",
      ),
    [mode],
  );

  const active = visibleSections.some((s) => s.id === activeSection)
    ? activeSection
    : (visibleSections[0]?.id ?? "project");

  const { model, catalogue, validation } = cfg;

  if (!cfg.loaded || !model || !catalogue) {
    return (
      <div className={styles.root}>
        <div className={styles.shell}>
          <Skeleton lines={4} />
        </div>
      </div>
    );
  }

  const merged = cfg.mergedPopulated();
  const populatedKeys = Object.keys(merged).sort();

  return (
    <div className={styles.root}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <h1 className={styles.title}>ALP Board Configurator</h1>
          <p className={styles.subtitle}>
            Guided editing for <code>board.yaml</code>. The YAML editor stays
            first-class; this view writes the same file.
          </p>

          <div className={styles.topbar}>
            <label className={styles.modeSelect}>
              <span className={styles.fieldLabel}>Mode</span>
              <select
                className={styles.select}
                value={mode}
                onChange={(e) =>
                  setMode(e.target.value as "basic" | "advanced")
                }
              >
                <option value="basic">Basic</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>

            <nav
              className={styles.sectionNav}
              aria-label="Configurator sections"
            >
              {visibleSections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={styles.sectionTab}
                  data-active={s.id === active ? "" : undefined}
                  onClick={() => setActiveSection(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </nav>
          </div>

          <div className={styles.metaRow}>
            <span className={styles.metaChip}>
              {cfg.boardPath
                ? `Editing ${cfg.boardPath}`
                : "board.yaml path unresolved"}
            </span>
            <span
              className={styles.metaChip}
              data-dirty={cfg.dirty ? "" : undefined}
            >
              {cfg.dirty ? "Unsaved changes" : "Up to date"}
            </span>
          </div>
        </header>

        <main className={styles.content}>
          {active === "project" && (
            <section className={styles.section}>
              <h2 className={styles.sectionHeading}>Project and Hardware</h2>
              <p className={styles.help}>
                Start with identity fields. These values drive preset
                inheritance and generation defaults.
              </p>
              <Select
                label="SoM SKU"
                value={model.som?.sku ?? ""}
                options={catalogue.skus}
                onChange={cfg.setSku}
              />
              <Select
                label="Carrier name"
                value={model.carrier?.name ?? ""}
                options={catalogue.carriers.map((c) => c.name)}
                onChange={cfg.setCarrierName}
              />
              {!cfg.isV2 && (
                <Select
                  label="OS target"
                  value={model.os ?? ""}
                  options={catalogue.osChoices}
                  onChange={cfg.setOs}
                />
              )}
              {cfg.isV2 && (
                <div className={styles.coresBlock}>
                  <h3 className={styles.subHeading}>
                    Core configuration (schema v2)
                  </h3>
                  <p className={styles.help}>
                    Each row corresponds to a core in the SoM topology. Set{" "}
                    <code>off</code> to exclude a core from the build.
                  </p>
                  {Object.keys(model.cores ?? {}).map((coreId) => {
                    const entry = model.cores?.[coreId] ?? { os: "off" };
                    return (
                      <div key={coreId} className={styles.coreRow}>
                        <span className={styles.coreId}>{coreId}</span>
                        <select
                          className={styles.select}
                          value={entry.os ?? "off"}
                          aria-label={`${coreId} OS`}
                          onChange={(e) =>
                            cfg.setCoreOs(coreId, e.target.value)
                          }
                        >
                          {CORE_OS_CHOICES.map((choice) => (
                            <option key={choice} value={choice}>
                              {choice}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          className={styles.input}
                          placeholder="app (optional)"
                          aria-label={`${coreId} app`}
                          defaultValue={entry.app ?? ""}
                          onBlur={(e) => cfg.setCoreApp(coreId, e.target.value)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {active === "features" && (
            <section className={styles.section}>
              <h2 className={styles.sectionHeading}>Features</h2>
              <p className={styles.help}>
                Choose optional runtime capabilities. Keep fields empty to use
                inherited preset behavior.
              </p>
              <h3 className={styles.subHeading}>Inference</h3>
              <Select
                label="Backend"
                value={model.inference?.backend ?? ""}
                options={catalogue.inferenceBackends}
                placeholder="(use SoM preset's preferred_backend)"
                onChange={cfg.setInferenceBackend}
              />
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Tensor arena (KiB)</span>
                <input
                  type="number"
                  min={16}
                  placeholder="128"
                  className={styles.input}
                  defaultValue={model.inference?.default_arena_kib ?? ""}
                  onBlur={(e) => cfg.setInferenceArena(e.target.value)}
                />
              </label>

              <h3 className={styles.subHeading}>IoT</h3>
              {IOT_FIELDS.map(({ key, label }) => (
                <label key={key} className={styles.checkRow}>
                  <input
                    type="checkbox"
                    checked={!!model.iot?.[key]}
                    onChange={(e) => cfg.setIot(key, e.target.checked)}
                  />
                  {label}
                </label>
              ))}

              <h3 className={styles.subHeading}>Libraries</h3>
              <div className={styles.libGrid}>
                {catalogue.libraries.map((lib) => (
                  <label key={lib} className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={(model.libraries ?? []).includes(lib)}
                      onChange={(e) => cfg.toggleLibrary(lib, e.target.checked)}
                    />
                    {lib}
                  </label>
                ))}
              </div>
            </section>
          )}

          {active === "diagnostics" && (
            <section className={styles.section}>
              <h2 className={styles.sectionHeading}>Diagnostics</h2>
              <p className={styles.help}>
                Tune runtime observability and error-reporting behavior.
              </p>
              <label className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={model.diagnostics?.last_error !== false}
                  onChange={(e) => cfg.setDiagLastError(e.target.checked)}
                />
                <code>alp_last_error()</code> thread-local slot
              </label>
              <Select
                label="Log level"
                value={model.diagnostics?.log_level ?? ""}
                options={catalogue.logLevels}
                onChange={cfg.setLogLevel}
              />
            </section>
          )}

          {active === "review" && (
            <section className={styles.section}>
              <h2 className={styles.sectionHeading}>Review and Validation</h2>
              <p className={styles.help}>
                A lightweight summary runs before save so obvious issues are
                visible before writing files.
              </p>
              <p className={styles.validationCounts}>
                Errors: {validation.errors.length} | Warnings:{" "}
                {validation.warnings.length} | Suggestions:{" "}
                {validation.suggestions.length}
              </p>
              <ul className={styles.validationItems}>
                {validation.errors.map((m) => (
                  <li key={`e-${m}`} data-severity="error">
                    Error: {m}
                  </li>
                ))}
                {validation.warnings.map((m) => (
                  <li key={`w-${m}`} data-severity="warning">
                    Warning: {m}
                  </li>
                ))}
                {validation.suggestions.map((m) => (
                  <li key={`s-${m}`} data-severity="suggestion">
                    Suggestion: {m}
                  </li>
                ))}
                {validation.errors.length === 0 &&
                  validation.warnings.length === 0 &&
                  validation.suggestions.length === 0 && (
                    <li data-severity="clean">No issues detected.</li>
                  )}
              </ul>
            </section>
          )}

          {active === "advanced" && (
            <section className={styles.section}>
              <h2 className={styles.sectionHeading}>
                Advanced Carrier Overrides
              </h2>
              <p className={styles.help}>
                Override per-chip <code>carrier.populated</code> flags.
                Preset-matching values are omitted when saved.
              </p>
              {populatedKeys.length === 0 && (
                <p className={styles.help}>
                  No populated chips defined for this carrier.
                </p>
              )}
              {populatedKeys.map((chip) => (
                <div key={chip} className={styles.populatedRow}>
                  <label className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={!!merged[chip]}
                      onChange={(e) => cfg.setPopulated(chip, e.target.checked)}
                    />
                    {chip}
                  </label>
                  <span className={styles.source}>
                    {cfg.populatedSource(chip)}
                  </span>
                </div>
              ))}
            </section>
          )}
        </main>

        <footer className={styles.actions}>
          <Button
            appearance="primary"
            onClick={() => {
              if (!cfg.save() && validation.errors.length > 0) {
                setActiveSection("review");
              }
            }}
          >
            Save board.yaml
          </Button>
          <Button appearance="secondary" onClick={cfg.reload}>
            Reload from disk
          </Button>
          <Button appearance="ghost" onClick={cfg.preview}>
            Preview effective config
          </Button>
          <Button
            appearance="ghost"
            onClick={() => postMessage({ type: "closePanel" })}
          >
            Close
          </Button>
          <span className={styles.status} role="status">
            {cfg.status}
          </span>
        </footer>
      </div>
    </div>
  );
}
