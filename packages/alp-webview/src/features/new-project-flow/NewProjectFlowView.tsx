import { useMemo, useState } from "react";
import { useAppContext } from "../../shared/AppContext";
import type { StepDef } from "../../shared/hooks/useStepper";
import { useStepper } from "../../shared/hooks/useStepper";
import {
  Card,
  Field,
  Icon,
  Skeleton,
  StatusChip,
  Stepper,
  StepperNav,
} from "../../shared/ui";
import type { E1mModule, ProjectTemplate } from "../../types";
import { postMessage } from "../../vscode";
import styles from "./NewProjectFlowView.module.css";

const STEPS: StepDef[] = [
  { id: "template", title: "Template" },
  { id: "hardware", title: "Hardware" },
  { id: "name", title: "Name" },
  { id: "confirm", title: "Confirm" },
];

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
}

function NameStep({ value, onChange, error }: NameStepProps) {
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
      <p className={styles.stepDesc}>
        A new folder with this name will be created inside the directory you
        choose in the next step.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------

interface ConfirmStepProps {
  templateId: string;
  moduleId: string;
  projectName: string;
  templates: ProjectTemplate[];
  modules: E1mModule[];
}

function ConfirmStep({
  templateId,
  moduleId,
  projectName,
  templates,
  modules,
}: ConfirmStepProps) {
  const tpl = templates.find((t) => t.id === templateId);
  const mod = modules.find((m) => m.id === moduleId);

  const rows = [
    { label: "Template", value: tpl ? `${tpl.icon} ${tpl.title}` : templateId },
    { label: "Module", value: mod?.displayName ?? moduleId },
    { label: "Project name", value: projectName || "—" },
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
        Click <strong>Create Project</strong> to choose an output directory. A
        folder named <code>{projectName || "…"}</code> will be created there
        with <code>board.yaml</code>, <code>CMakeLists.txt</code>, and a starter{" "}
        <code>src/main.c</code>.
      </p>
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
  const [projectName, setProjectName] = useState("");
  const [nameError, setNameError] = useState("");

  const templates = projectTemplates ?? [];
  const modules = e1mModules ?? [];
  const isLoading = !state;

  const nameValid = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(projectName);

  const canAdvance = useMemo(() => {
    return [
      selectedTemplate !== "",
      selectedModule !== "",
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

  function handleNext() {
    if (stepper.isLast) {
      postMessage({
        type: "createNewProject",
        templateId: selectedTemplate,
        moduleId: selectedModule,
        projectName,
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
                <NameStep
                  value={projectName}
                  onChange={handleNameChange}
                  error={nameError}
                />
              )}
              {stepper.currentIndex === 3 && (
                <ConfirmStep
                  templateId={selectedTemplate}
                  moduleId={selectedModule}
                  projectName={projectName}
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
