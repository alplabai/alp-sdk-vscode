import { useEffect, useMemo, useState } from "react";
import { useAppContext } from "../../shared/AppContext";
import type { StepDef } from "../../shared/hooks/useStepper";
import { useStepper } from "../../shared/hooks/useStepper";
import {
  Button,
  Card,
  EmptyState,
  Field,
  Icon,
  Skeleton,
  StatusChip,
  Stepper,
  StepperNav,
} from "../../shared/ui";
import type { E1mModule, LocalSdkEntry, ProjectTemplate } from "../../types";
import { onMessage, postMessage } from "../../vscode";
import styles from "./NewProjectFlowView.module.css";

const STEPS: StepDef[] = [
  { id: "template", title: "Template" },
  { id: "hardware", title: "Hardware" },
  { id: "sdk", title: "SDK" },
  { id: "name", title: "Name" },
  { id: "confirm", title: "Confirm" },
];

/** Last path segment (cross-platform); the cache dir is named after the tag. */
function pathTail(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

// ---------------------------------------------------------------------------
// Step components
// ---------------------------------------------------------------------------

interface TemplateStepProps {
  templates: ProjectTemplate[];
  selected: string;
  onSelect: (id: string) => void;
}

function TemplateStep({ templates, selected, onSelect }: TemplateStepProps) {
  const starters = templates.filter((t) => t.category === "starter");
  const examples = templates.filter((t) => t.category === "example");

  // Search + domain filter are purely presentational — they only decide which
  // example cards render, so the state stays local to this step.
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState(""); // "" = all domains

  // Domains are the first segment of each example's sourceDir (audio, ai, …).
  const domains = useMemo(() => {
    const set = new Set<string>();
    for (const t of examples) {
      const d = t.sourceDir?.split("/")[0];
      if (d) set.add(d);
    }
    return Array.from(set).sort();
  }, [examples]);

  const filteredExamples = useMemo(() => {
    const q = query.trim().toLowerCase();
    return examples.filter((t) => {
      const d = t.sourceDir?.split("/")[0] ?? "";
      if (domain && d !== domain) return false;
      if (!q) return true;
      return [t.title, t.description, t.sourceDir ?? "", t.id]
        .join("\n")
        .toLowerCase()
        .includes(q);
    });
  }, [examples, query, domain]);

  return (
    <>
      <p className={styles.stepHeading}>Choose a project type</p>

      {starters.length > 0 && (
        <>
          <p className={styles.groupLabel}>Starters</p>
          <div className={styles.templateGrid}>
            {starters.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                selected={selected === t.id}
                onSelect={onSelect}
              />
            ))}
          </div>
        </>
      )}

      {examples.length > 0 && (
        <>
          <p className={styles.groupLabel}>Examples</p>
          <div className={styles.fieldWrap}>
            <Field
              label="Search examples"
              placeholder="Search by name, description, or path…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {domains.length > 1 && (
            <div
              className={styles.filterChips}
              role="group"
              aria-label="Filter examples by domain"
            >
              <button
                type="button"
                className={styles.filterChip}
                data-selected={domain === "" ? "" : undefined}
                aria-pressed={domain === ""}
                onClick={() => setDomain("")}
              >
                All
              </button>
              {domains.map((d) => (
                <button
                  type="button"
                  key={d}
                  className={styles.filterChip}
                  data-selected={domain === d ? "" : undefined}
                  aria-pressed={domain === d}
                  onClick={() => setDomain(d)}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
          {filteredExamples.length > 0 ? (
            <div className={styles.templateGrid}>
              {filteredExamples.map((t) => (
                <TemplateCard
                  key={t.id}
                  template={t}
                  selected={selected === t.id}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No examples match"
              description="Try a different search term or clear the domain filter."
            />
          )}
        </>
      )}

      {starters.length === 0 && examples.length === 0 && (
        <EmptyState
          title="No templates available"
          description="No project templates resolved. Check that an Alp SDK is selected and the tan CLI is reachable (see the Alp SDK output channel)."
        />
      )}
    </>
  );
}

interface TemplateCardProps {
  template: ProjectTemplate;
  selected: boolean;
  onSelect: (id: string) => void;
}

function TemplateCard({ template, selected, onSelect }: TemplateCardProps) {
  return (
    <button
      className={styles.templateCard}
      data-selected={selected ? "" : undefined}
      onClick={() => onSelect(template.id)}
      aria-pressed={selected}
    >
      <span className={styles.templateIcon} aria-hidden="true">
        {template.icon}
      </span>
      <span className={styles.templateTitle}>{template.title}</span>
      <span className={styles.templateDesc}>{template.description}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------

interface HardwareStepProps {
  modules: E1mModule[];
  selected: string;
  onSelect: (id: string) => void;
}

function HardwareStep({ modules, selected, onSelect }: HardwareStepProps) {
  const families: Record<string, string> = {
    "alif-ensemble": "Alif Ensemble",
    "renesas-rzv2n": "Renesas RZ/V2N",
    "renesas-rzv2n-deepx": "Renesas RZ/V2N + DEEPX",
    "nxp-imx9": "NXP i.MX 9",
  };

  const byFamily = modules.reduce<Record<string, E1mModule[]>>((acc, m) => {
    const key = families[m.family] ?? m.family;
    if (!acc[key]) acc[key] = [];
    acc[key].push(m);
    return acc;
  }, {});

  return (
    <>
      <p className={styles.stepHeading}>Select E1M module</p>
      {Object.entries(byFamily).map(([family, mods]) => (
        <div key={family} className={styles.moduleGroup}>
          <p className={styles.groupLabel}>{family}</p>
          {mods.map((m) => (
            <button
              key={m.id}
              className={styles.moduleRow}
              data-selected={selected === m.id ? "" : undefined}
              onClick={() => onSelect(m.id)}
              aria-pressed={selected === m.id}
            >
              <span className={styles.moduleId}>{m.id}</span>
              <span className={styles.moduleDesc}>
                {m.displayName.replace(`${m.id} `, "")}
              </span>
              {selected === m.id && <StatusChip state="ready" />}
            </button>
          ))}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------

interface NameStepProps {
  value: string;
  onChange: (v: string) => void;
  error: string;
  destination: string;
  onBrowse: () => void;
}

function NameStep({
  value,
  onChange,
  error,
  destination,
  onBrowse,
}: NameStepProps) {
  const sep =
    destination.includes("\\") && !destination.includes("/") ? "\\" : "/";
  const fullPath = destination
    ? `${destination.replace(/[/\\]+$/, "")}${sep}${value || "…"}`
    : "";

  return (
    <>
      <p className={styles.stepHeading}>Name your project</p>
      <div className={styles.fieldWrap}>
        <Field
          label="Project name"
          hint="Used as the folder name and CMake project name. Letters, digits, hyphens only."
          placeholder="my-alp-project"
          value={value}
          error={error || undefined}
          onChange={(e) => onChange(e.target.value)}
          autoFocus
        />
      </div>
      <div className={styles.fieldWrap}>
        <p className={styles.groupLabel}>Location</p>
        <div className={styles.locationRow}>
          <span
            className={styles.locationPath}
            title={destination || undefined}
          >
            {destination || "Choose a folder…"}
          </span>
          <Button appearance="secondary" onClick={onBrowse}>
            Browse…
          </Button>
        </div>
      </div>
      <p className={styles.stepDesc}>
        {fullPath ? (
          <>
            The project folder will be created at <code>{fullPath}</code>.
          </>
        ) : (
          "Choose the parent folder; a new folder named after the project is created inside it."
        )}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------

interface ConfirmStepProps {
  templateId: string;
  moduleId: string;
  projectName: string;
  sdkLabel: string;
  destination: string;
  templates: ProjectTemplate[];
  modules: E1mModule[];
  openInThisWindow: boolean;
  onToggleOpenInThisWindow: (v: boolean) => void;
}

function ConfirmStep({
  templateId,
  moduleId,
  projectName,
  sdkLabel,
  destination,
  templates,
  modules,
  openInThisWindow,
  onToggleOpenInThisWindow,
}: ConfirmStepProps) {
  const tpl = templates.find((t) => t.id === templateId);
  const mod = modules.find((m) => m.id === moduleId);
  const sep =
    destination.includes("\\") && !destination.includes("/") ? "\\" : "/";

  // An example ships its own board.yaml, so `alp init --from-example` ignores the
  // chosen SoM/cores — don't summarize hardware config that won't be applied.
  const isExample = !!tpl?.sourceDir;

  const rows = [
    { label: "Template", value: tpl ? `${tpl.icon} ${tpl.title}` : templateId },
    ...(isExample
      ? []
      : [
          { label: "Module", value: mod?.displayName ?? moduleId },
          ...(mod?.cores && mod.cores.length >= 2
            ? [
                {
                  label: "Cores",
                  value: mod.cores.map((c) => `${c.id} (${c.os})`).join(", "),
                },
              ]
            : []),
        ]),
    { label: "SDK", value: sdkLabel },
    { label: "Project name", value: projectName || "—" },
    {
      label: "Location",
      value: destination
        ? `${destination.replace(/[/\\]+$/, "")}${sep}${projectName || "…"}`
        : "Chosen when you click Create",
    },
  ];

  return (
    <>
      <p className={styles.stepHeading}>Review and create</p>
      <Card padding="sm" className={styles.summaryCard}>
        {rows.map(({ label, value }) => (
          <div key={label} className={styles.summaryRow}>
            <span className={styles.summaryLabel}>{label}</span>
            <span className={styles.summaryValue}>{value}</span>
          </div>
        ))}
      </Card>
      <p className={styles.groupLabel}>When created</p>
      <div
        className={styles.filterChips}
        role="group"
        aria-label="Where to open the new project"
      >
        <Button
          appearance={openInThisWindow ? "accent" : "secondary"}
          onClick={() => onToggleOpenInThisWindow(true)}
        >
          {openInThisWindow ? "✓ " : ""}Open in this window
        </Button>
        <Button
          appearance={!openInThisWindow ? "accent" : "secondary"}
          onClick={() => onToggleOpenInThisWindow(false)}
        >
          {!openInThisWindow ? "✓ " : ""}Open in new window
        </Button>
      </div>
      <p className={styles.stepDesc}>
        Click <strong>Create Project</strong> to scaffold{" "}
        <code>{projectName || "…"}</code>{" "}
        {isExample ? (
          <>
            by copying the selected example verbatim (its own{" "}
            <code>board.yaml</code>, sources, and build files)
          </>
        ) : (
          <>
            with <code>board.yaml</code>, <code>CMakeLists.txt</code>, and a
            starter <code>src/main.c</code>
          </>
        )}
        {destination ? "" : " — you'll choose a folder first"}.
      </p>
    </>
  );
}

interface SdkStepProps {
  entries: LocalSdkEntry[];
  activePath: string | null;
  selected: string; // "" = default
  onSelect: (path: string) => void;
}

function SdkStep({ entries, activePath, selected, onSelect }: SdkStepProps) {
  return (
    <>
      <p className={styles.stepHeading}>Choose an SDK</p>
      <div className={styles.moduleGroup}>
        <button
          className={styles.moduleRow}
          data-selected={selected === "" ? "" : undefined}
          onClick={() => onSelect("")}
          aria-pressed={selected === ""}
        >
          <span className={styles.moduleId}>Default</span>
          <span className={styles.moduleDesc}>
            {activePath
              ? "Use the active / default SDK"
              : "Resolve automatically when the project opens"}
          </span>
          {selected === "" && <StatusChip state="ready" />}
        </button>
        {entries.map((e) => (
          <button
            key={e.path}
            className={styles.moduleRow}
            data-selected={selected === e.path ? "" : undefined}
            onClick={() => onSelect(e.path)}
            aria-pressed={selected === e.path}
          >
            <span className={styles.moduleId}>
              {e.version ?? pathTail(e.path)}
            </span>
            <span className={styles.moduleDesc}>{pathTail(e.path)}</span>
            {selected === e.path && <StatusChip state="ready" />}
          </button>
        ))}
      </div>
      {entries.length === 0 && (
        <p className={styles.stepDesc}>
          No SDKs installed yet — the project will use the default SDK. Install
          one from the SDK Manager.
        </p>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function NewProjectFlowView() {
  const { state, projectTemplates, e1mModules } = useAppContext();
  const { state: stepper, goNext, goBack } = useStepper(STEPS);

  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [selectedModule, setSelectedModule] = useState("");
  const [selectedSdk, setSelectedSdk] = useState(""); // "" = default SDK
  const [projectName, setProjectName] = useState("");
  const [nameError, setNameError] = useState("");
  const [destination, setDestination] = useState("");
  // Open the created project in the current window (replace) vs a new window.
  const [openInThisWindow, setOpenInThisWindow] = useState(true);

  // Receive the parent folder chosen via the native picker (or the default).
  useEffect(() => {
    return onMessage((msg) => {
      if (msg.type === "projectLocationPicked") setDestination(msg.path);
    });
  }, []);

  const templates = projectTemplates ?? [];
  const modules = e1mModules ?? [];
  const sdkEntries = state?.sdk.localEntries ?? [];
  const activeSdkPath = state?.sdk.activePath ?? null;
  const isLoading = !state;

  const nameValid = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(projectName);

  const sdkLabel = selectedSdk
    ? (sdkEntries.find((e) => e.path === selectedSdk)?.version ??
      pathTail(selectedSdk))
    : "Default";

  // Examples ship their own board.yaml, so the Hardware (SoM) step is optional
  // for them — don't block Next on a module the scaffold will ignore.
  const selectedIsExample = useMemo(
    () => templates.some((t) => t.id === selectedTemplate && !!t.sourceDir),
    [templates, selectedTemplate],
  );

  const canAdvance = useMemo(() => {
    return [
      selectedTemplate !== "",
      selectedModule !== "" || selectedIsExample,
      true, // SDK step — default is always valid
      projectName !== "" && nameValid,
      true,
    ];
  }, [
    selectedTemplate,
    selectedModule,
    selectedIsExample,
    projectName,
    nameValid,
  ]);

  function handleNameChange(v: string) {
    setProjectName(v);
    if (v && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(v)) {
      setNameError("Use letters, digits, underscores or hyphens only.");
    } else {
      setNameError("");
    }
  }

  function browseLocation() {
    postMessage({
      type: "pickProjectLocation",
      current: destination || undefined,
    });
  }

  // Re-fetch the template + SoM catalog against the newly selected SDK, so the
  // Examples list the wizard shows matches the SDK the project is scaffolded
  // from (else `alp init --from-example` fails with "was not found" on a
  // divergent pick — issue #144).
  function handleSelectSdk(path: string) {
    setSelectedSdk(path);
    postMessage({ type: "reloadProjectTemplates", sdkPath: path || undefined });
  }

  function handleNext() {
    if (stepper.isLast) {
      postMessage({
        type: "createNewProject",
        templateId: selectedTemplate,
        moduleId: selectedModule,
        projectName,
        sdkPath: selectedSdk || undefined,
        destination: destination || undefined,
        openInCurrentWindow: openInThisWindow,
      });
    } else {
      goNext();
    }
  }

  return (
    <div className={styles.root}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <h1 className={styles.title}>New Alp Project</h1>
          <button
            className={styles.closeBtn}
            title="Close"
            aria-label="Close wizard"
            onClick={() => postMessage({ type: "closePanel" })}
          >
            <Icon name="x" size={14} />
          </button>
        </header>

        <Stepper steps={stepper.steps} direction="horizontal" />

        <main className={styles.content}>
          {isLoading ? (
            <Skeleton lines={3} />
          ) : (
            <>
              {stepper.currentIndex === 0 && (
                <TemplateStep
                  templates={templates}
                  selected={selectedTemplate}
                  onSelect={setSelectedTemplate}
                />
              )}
              {stepper.currentIndex === 1 && (
                <HardwareStep
                  modules={modules}
                  selected={selectedModule}
                  onSelect={setSelectedModule}
                />
              )}
              {stepper.currentIndex === 2 && (
                <SdkStep
                  entries={sdkEntries}
                  activePath={activeSdkPath}
                  selected={selectedSdk}
                  onSelect={handleSelectSdk}
                />
              )}
              {stepper.currentIndex === 3 && (
                <NameStep
                  value={projectName}
                  onChange={handleNameChange}
                  error={nameError}
                  destination={destination}
                  onBrowse={browseLocation}
                />
              )}
              {stepper.currentIndex === 4 && (
                <ConfirmStep
                  templateId={selectedTemplate}
                  moduleId={selectedModule}
                  projectName={projectName}
                  sdkLabel={sdkLabel}
                  destination={destination}
                  templates={templates}
                  modules={modules}
                  openInThisWindow={openInThisWindow}
                  onToggleOpenInThisWindow={setOpenInThisWindow}
                />
              )}
            </>
          )}
        </main>

        <StepperNav
          isFirst={stepper.isFirst}
          isLast={stepper.isLast}
          disabled={isLoading || !canAdvance[stepper.currentIndex]}
          nextLabel="Next"
          finishLabel="Create Project"
          onBack={goBack}
          onNext={handleNext}
          onCancel={() => postMessage({ type: "closePanel" })}
        />
      </div>
    </div>
  );
}
