import { useEffect, useMemo, useState } from "react";
import { useAppContext } from "../../shared/AppContext";
import type { StepDef } from "../../shared/hooks/useStepper";
import { useStepper } from "../../shared/hooks/useStepper";
import {
  Button,
  Card,
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
          <div className={styles.templateGrid}>
            {examples.map((t) => (
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
}

function ConfirmStep({
  templateId,
  moduleId,
  projectName,
  sdkLabel,
  destination,
  templates,
  modules,
}: ConfirmStepProps) {
  const tpl = templates.find((t) => t.id === templateId);
  const mod = modules.find((m) => m.id === moduleId);
  const sep =
    destination.includes("\\") && !destination.includes("/") ? "\\" : "/";

  const rows = [
    { label: "Template", value: tpl ? `${tpl.icon} ${tpl.title}` : templateId },
    { label: "Module", value: mod?.displayName ?? moduleId },
    ...(mod?.cores && mod.cores.length >= 2
      ? [
          {
            label: "Cores",
            value: mod.cores.map((c) => `${c.id} (${c.os})`).join(", "),
          },
        ]
      : []),
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
      <p className={styles.stepDesc}>
        Click <strong>Create Project</strong> to scaffold{" "}
        <code>{projectName || "…"}</code> with <code>board.yaml</code>,{" "}
        <code>CMakeLists.txt</code>, and a starter <code>src/main.c</code>
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

  const canAdvance = useMemo(() => {
    return [
      selectedTemplate !== "",
      selectedModule !== "",
      true, // SDK step — default is always valid
      projectName !== "" && nameValid,
      true,
    ];
  }, [selectedTemplate, selectedModule, projectName, nameValid]);

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

  function handleNext() {
    if (stepper.isLast) {
      postMessage({
        type: "createNewProject",
        templateId: selectedTemplate,
        moduleId: selectedModule,
        projectName,
        sdkPath: selectedSdk || undefined,
        destination: destination || undefined,
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
                  onSelect={setSelectedSdk}
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
