import { useEffect, useMemo, useRef, useState } from "react";
import { useAppContext } from "../../shared/AppContext";
import type { StepDef } from "../../shared/hooks/useStepper";
import { useStepper } from "../../shared/hooks/useStepper";
import { coresSummary, runtimeOptions } from "../../shared/coreRuntime";
import { isSafeAppDir, normaliseAppDir } from "../../shared/appDir";
import { reconcileTemplateSelection } from "../../shared/templateSelection";
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
import type { IconName } from "../../shared/ui";
import type {
  E1mModule,
  LocalSdkEntry,
  NewProjectFileChange,
  ProjectTemplate,
} from "../../types";
import { onMessage, postMessage } from "../../vscode";
import styles from "./NewProjectFlowView.module.css";

const STEPS: StepDef[] = [
  { id: "template", title: "Template" },
  { id: "hardware", title: "Hardware" },
  { id: "cores", title: "Cores" },
  { id: "sdk", title: "SDK" },
  { id: "name", title: "Name" },
  { id: "confirm", title: "Confirm" },
];

/** Where to send someone whose template stopped existing. Derived from STEPS by
 *  id rather than hardcoded: the host already addresses steps by id and never by
 *  index, for the same reason (#530). */
const TEMPLATE_STEP_INDEX = STEPS.findIndex((step) => step.id === "template");

/** Where the preview request fires from — same derive-by-id rule as
 *  TEMPLATE_STEP_INDEX, for the same reason (#616). */
const CONFIRM_STEP_INDEX = STEPS.findIndex((step) => step.id === "confirm");

/**
 * `tan init --preview`'s file list, or why there isn't one yet (#616).
 *
 * FOUR states, not a bare `NewProjectFileChange[] | null`, because "no
 * destination yet" and "the preview failed" read as the SAME thing to a
 * customer if both render as nothing — the first is expected (the row above
 * already says "Chosen when you click Create"), the second is worth a note.
 * `"loading"` is its own state for the same reason `TemplateStep`'s `loading`
 * is: rendering the PREVIOUS visit's file list while a new one is in flight
 * would show stale files for whatever the customer just changed.
 */
type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; files: NewProjectFileChange[] }
  | { status: "unavailable" };

/** Last path segment (cross-platform); the cache dir is named after the tag. */
function pathTail(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

// ---------------------------------------------------------------------------
// Step components
// ---------------------------------------------------------------------------

/** Says why a choice the customer already made is no longer on screen.
 *  `role="status"` rather than `alert`: nothing is broken and nothing is
 *  blocked — the wizard has already put them back on the step that fixes it. */
function TemplateNotice({ text }: { text: string }) {
  return (
    <p className={styles.templateNotice} role="status">
      <span className={styles.templateNoticeIcon} aria-hidden="true">
        <Icon name="warning" size={14} />
      </span>
      {text}
    </p>
  );
}

/** How many placeholder cards a loading group draws. Not a guess at the real
 *  count — it is about one grid row at a typical panel width, enough to say
 *  "cards are coming, here" without pretending to know how many. */
const SKELETON_CARD_COUNT = 3;

/** A heading plus a row of card-shaped placeholders. They reuse `.templateCard`
 *  so the real cards land on exactly the same geometry and the layout does not
 *  jump when the catalogue arrives. */
function TemplateSkeletonGroup({ label }: { label: string }) {
  return (
    <>
      <p className={styles.groupLabel}>{label}</p>
      <div
        className={styles.templateGrid}
        role="status"
        aria-label={`Loading ${label.toLowerCase()}`}
      >
        {Array.from({ length: SKELETON_CARD_COUNT }).map((_, index) => (
          <div
            key={index}
            className={styles.templateCard}
            data-skeleton=""
            aria-hidden="true"
          >
            <Skeleton width={20} height={20} />
            <Skeleton width="60%" />
            <Skeleton lines={2} />
          </div>
        ))}
      </div>
    </>
  );
}

interface TemplateStepProps {
  templates: ProjectTemplate[];
  selected: string;
  onSelect: (id: string) => void;
  /** tan's own words for why there are no examples, when it gave a reason. */
  examplesUnavailableReason: string | null;
  /** The catalogue has not arrived yet — distinct from "it arrived empty".
   *  Starters and examples travel in ONE `projectTemplatesData` message, so
   *  until it lands the whole step is blank, not just the Examples half. */
  loading: boolean;
  /** Why the previous selection is gone, when a catalogue reload dropped it.
   *  Null the rest of the time. */
  notice: string | null;
}

function TemplateStep({
  templates,
  selected,
  onSelect,
  examplesUnavailableReason,
  loading,
  notice,
}: TemplateStepProps) {
  const starters = templates.filter((t) => t.category === "starter");
  const examples = templates.filter((t) => t.category === "example");

  // Search + domain filter are purely presentational — they only decide which
  // example cards render, so the state stays local to this step.
  const [query, setQuery] = useState("");
  const [domain, setDomain] = useState(""); // "" = all domains

  // The domain is `t.group`, decided HOST-side (#482 §1/§2). It used to be
  // re-split out of `sourceDir` here, which was a second copy of a rule the
  // host also applies — and the copy could not defer to tan. `exampleCategory`
  // (@alp-sdk/core/examples/category) prefers tan's own `category` the day its
  // envelope carries one; this view just renders what it is given.
  const domains = useMemo(() => {
    const set = new Set<string>();
    for (const t of examples) if (t.group) set.add(t.group);
    return Array.from(set).sort();
  }, [examples]);

  const filteredExamples = useMemo(() => {
    const q = query.trim().toLowerCase();
    return examples.filter((t) => {
      if (domain && t.group !== domain) return false;
      if (!q) return true;
      return [t.title, t.description, t.sourceDir ?? "", t.id]
        .join("\n")
        .toLowerCase()
        .includes(q);
    });
  }, [examples, query, domain]);

  /**
   * The filtered examples under their headings, in the order the chips use
   * (#482 §2). Filtering alone left "All" as 100 undifferentiated cards, which
   * is the state #482 was filed about; the chips narrow, the headings make the
   * unnarrowed list readable.
   *
   * An example with NO group goes in a trailing unnamed bucket rather than
   * under an invented "Other" — a heading naming something the SDK does not
   * have is worse than no heading. That bucket is also the whole list on an
   * older tan whose examples carry no directory, which is how this degrades.
   */
  const groupedExamples = useMemo(() => {
    const byGroup = new Map<string, ProjectTemplate[]>();
    const ungrouped: ProjectTemplate[] = [];
    for (const t of filteredExamples) {
      if (!t.group) {
        ungrouped.push(t);
        continue;
      }
      const bucket = byGroup.get(t.group);
      if (bucket) bucket.push(t);
      else byGroup.set(t.group, [t]);
    }
    const sections: { name: string | null; items: ProjectTemplate[] }[] = [
      ...byGroup.entries(),
    ]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, items]) => ({ name, items }));
    if (ungrouped.length > 0) sections.push({ name: null, items: ungrouped });
    return sections;
  }, [filteredExamples]);

  // Both groups are placeholdered, not just Examples: they arrive together, so
  // an empty Starters row during the wait would claim this SDK ships none.
  if (loading) {
    return (
      <>
        <p className={styles.stepHeading}>Choose a project type</p>
        {notice && <TemplateNotice text={notice} />}
        <TemplateSkeletonGroup label="Starters" />
        <TemplateSkeletonGroup label="Examples" />
      </>
    );
  }

  return (
    <>
      <p className={styles.stepHeading}>Choose a project type</p>
      {notice && <TemplateNotice text={notice} />}

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

      {/* An empty catalogue used to render as no Examples section at all, which
          is indistinguishable from "this SDK ships none". tan reports an
          unresolved SDK as a SUCCESS with an empty list, so when it gave a
          reason, say it here rather than silently dropping the section. */}
      {examples.length === 0 && examplesUnavailableReason && (
        <>
          <p className={styles.groupLabel}>Examples</p>
          <EmptyState
            title="No examples available"
            description={examplesUnavailableReason}
          />
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
            groupedExamples.map((section) => (
              <div key={section.name ?? "\u0000ungrouped"}>
                {/* One heading is no heading: with a chip selected there is a
                    single section, and repeating its name under the pressed
                    chip is noise. */}
                {section.name && groupedExamples.length > 1 && (
                  <p className={styles.exampleGroupLabel}>{section.name}</p>
                )}
                <div className={styles.templateGrid}>
                  {section.items.map((t) => (
                    <TemplateCard
                      key={t.id}
                      template={t}
                      selected={selected === t.id}
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              </div>
            ))
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

/**
 * Which icon a template card shows, derived from its KIND.
 *
 * The host used to send the glyph itself, as an untyped `string` that was an
 * emoji — banned by DESIGN.md's No-Emoji Rule — and that fixtures had already
 * drifted to codicon names the webview's icon set does not contain. Deriving
 * here makes the value typed (`IconName`), so an unknown name is a compile
 * error rather than literal text rendered into the card.
 *
 * `package` is deliberately NOT used for a template: in this product it already
 * means the SDK (statusBar, activeSdk), and reusing it would collide.
 */
const TEMPLATE_ICON: Record<ProjectTemplate["category"], IconName> = {
  starter: "filePlus",
  example: "book",
  library: "layers",
};

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
      <span className={styles.templateIcon}>
        <Icon name={TEMPLATE_ICON[template.category]} size={20} />
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

// `CoreChoice` and its two helpers live in `shared/coreChoices.ts`, which has
// no JSX and no imports, so they can be exercised as data rather than through a
// render. Re-exported here because this module is their public face.
export {
  defaultCoreChoices,
  reconcileCoreChoices,
  type CoreChoice,
} from "../../shared/coreChoices";
import {
  reconcileCoreChoices,
  type CoreChoice,
} from "../../shared/coreChoices";

/** Why a core has no app directory to type into. Said out loud rather than
 *  leaving an inert box: a disabled control with no reason reads as broken. */
function appDirPlaceholder(os: string): string {
  // Yocto's placeholder describes the DEFAULT, not a prohibition (#624): a
  // Linux core builds the SoM's stock image unless the customer names both a
  // source directory and the recipe that packages it.
  if (os === "yocto") return "stock image — or a source dir, with a recipe";
  if (os === "baremetal") return "bare-metal: create the app yourself";
  if (os === "off") return "core is off";
  return "./src";
}

/** Does this row let the customer type an application directory? */
function acceptsAppDir(os: string): boolean {
  return os === "zephyr" || os === "yocto";
}

interface CoresStepProps {
  choices: CoreChoice[];
  onChange: (next: CoreChoice[]) => void;
  isExample: boolean;
}

/**
 * Assign every core the SoM declares (#534).
 *
 * Until this existed the wizard had no core step at all: `tan init --cores`
 * splices companions in APP-LESS, so a dual-M55 SoM — the Alif Ensemble line's
 * defining topology — came out as a single-core project with the second M55
 * absent from `board.yaml` entirely.
 *
 * An EXAMPLE brings its own `board.yaml`, complete with the core layout its
 * source tree matches, so the step says so and changes nothing rather than
 * offering edits that would be overwritten.
 */
export function CoresStep({ choices, onChange, isExample }: CoresStepProps) {
  if (isExample) {
    return (
      <>
        <p className={styles.stepHeading}>Cores</p>
        <p className={styles.stepDesc}>
          This example ships its own board.yaml and source layout, so its cores
          are already assigned.
        </p>
      </>
    );
  }
  if (choices.length === 0) {
    return (
      <>
        <p className={styles.stepHeading}>Cores</p>
        <p className={styles.stepDesc}>
          Select a module first — its cores appear here.
        </p>
      </>
    );
  }

  const update = (id: string, patch: Partial<CoreChoice>) =>
    onChange(
      choices.map((choice) =>
        choice.id === id ? { ...choice, ...patch } : choice,
      ),
    );

  return (
    <>
      <p className={styles.stepHeading}>Assign the cores</p>
      <p className={styles.stepDesc}>
        Each core that runs an application gets its own directory, built as its
        own image. Set a core to Off to leave it out. A Linux core builds the
        SoM's stock image unless you give it both a source directory and the
        bitbake recipe that packages it.
      </p>
      {choices.map((choice) => (
        <div key={choice.id} className={styles.coreRow}>
          <span className={styles.coreRowId}>{choice.id}</span>
          <select
            className={styles.coreRowSelect}
            aria-label={`Runtime for ${choice.id}`}
            value={choice.os}
            onChange={(e) => update(choice.id, { os: e.target.value })}
          >
            {runtimeOptions(choice.id).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            className={styles.coreRowInput}
            type="text"
            aria-label={`App directory for ${choice.id}`}
            placeholder={appDirPlaceholder(choice.os)}
            value={acceptsAppDir(choice.os) ? choice.app : ""}
            disabled={!acceptsAppDir(choice.os)}
            onChange={(e) => update(choice.id, { app: e.target.value })}
          />
          {/* The app-only Yocto slice (#624). Shown ONLY once the customer has
              typed a source directory, because the recipe is meaningless
              without one — and REQUIRED from that moment, because an `app:`
              with no `recipe:` is what the SDK refuses to build
              (`_slice_command` returns None, and the slice is carried as
              `skipped` / `no-command`). The host writes the pair or neither. */}
          {choice.os === "yocto" && choice.app.trim() !== "" && (
            <input
              className={styles.coreRowInput}
              type="text"
              aria-label={`Bitbake recipe for ${choice.id}`}
              placeholder="bitbake recipe (required)"
              value={choice.recipe}
              onChange={(e) => update(choice.id, { recipe: e.target.value })}
            />
          )}
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
  /** The customer's OWN answers from the Cores step — never `modules`'
   *  topology. A summary that shows what the PART has rather than what was
   *  ASKED FOR cannot be checked against anything (#582). */
  coreChoices: CoreChoice[];
  /** `tan init --preview`'s own file list, so Create no longer writes a
   *  project the customer has never seen a file list for (#616). */
  preview: PreviewState;
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
  coreChoices,
  preview,
}: ConfirmStepProps) {
  const tpl = templates.find((t) => t.id === templateId);
  const mod = modules.find((m) => m.id === moduleId);
  const sep =
    destination.includes("\\") && !destination.includes("/") ? "\\" : "/";

  // An example ships its own board.yaml, so `alp init --from-example` ignores the
  // chosen SoM/cores — don't summarize hardware config that won't be applied.
  const isExample = !!tpl?.sourceDir;

  const rows = [
    { label: "Template", value: tpl ? tpl.title : templateId },
    ...(isExample
      ? []
      : [
          { label: "Module", value: mod?.displayName ?? moduleId },
          // THE CUSTOMER'S ANSWERS, not the SoM's topology (#582). This row
          // used to render `mod.cores` — what `tan presets` says the part HAS —
          // so a core set to "Off (skip core)" was listed here as enabled, on
          // the one screen whose whole job is to be checked before Create.
          //
          // Runtimes are named with the SAME labels the Cores step offered
          // (`runtimeOptions`), so the confirmation reads back what was picked
          // rather than the wire value.
          //
          // NO APP DIRECTORY IS SHOWN, deliberately. tan chooses the app core's
          // directory itself and its choice wins (`applyCoreAssignments`);
          // measured on the pinned 0.6.0, `minimal-app` scaffolds `app: .`
          // while this wizard's default for that core is `./src`. A directory
          // printed here would therefore be wrong on essentially every project
          // — a promise broken at Create, which is the failure this row exists
          // to prevent. The directories are editable on the Cores step, and the
          // one tan overrode is reported by name afterwards.
          ...(coreChoices.length >= 2
            ? [{ label: "Cores", value: coresSummary(coreChoices) }]
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
      <PreviewFiles preview={preview} />
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
          {openInThisWindow && <Icon name="check" size={14} />}Open in this
          window
        </Button>
        <Button
          appearance={!openInThisWindow ? "accent" : "secondary"}
          onClick={() => onToggleOpenInThisWindow(false)}
        >
          {!openInThisWindow && <Icon name="check" size={14} />}Open in new
          window
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

/**
 * `tan init --preview`'s file list (#616) — a SEPARATE section from the
 * summary Card above it, not a row inside it: this can run to eight-plus
 * entries on its own (measured: `minimal-app`), and folding it into
 * `.summaryRow`'s one-line-per-field layout would wrap badly or need its own
 * scroll either way.
 *
 * `"idle"` renders NOTHING — that state is "no destination chosen yet", and
 * the Location row above already says "Chosen when you click Create" for the
 * same reason; a second, empty-looking section here would repeat that without
 * adding anything. Every OTHER state renders something, on purpose: `null`
 * files (`"unavailable"`) must never look like the same nothing `"idle"`
 * shows, or a preview failure would read as "this creates nothing" — the
 * `written ?? []` failure this whole feature exists not to repeat.
 */
function PreviewFiles({ preview }: { preview: PreviewState }) {
  if (preview.status === "idle") return null;

  if (preview.status === "loading") {
    return (
      <>
        <p className={styles.groupLabel}>Files</p>
        <div role="status" aria-label="Loading the file preview">
          <Skeleton lines={3} />
        </div>
      </>
    );
  }

  if (preview.status === "unavailable") {
    return (
      <>
        <p className={styles.groupLabel}>Files</p>
        <p className={styles.templateNotice} role="status">
          <span className={styles.templateNoticeIcon} aria-hidden="true">
            <Icon name="warning" size={14} />
          </span>
          Couldn&apos;t preview the files tan will create. Create will still
          work — see the &quot;Alp SDK&quot; output channel for why.
        </p>
      </>
    );
  }

  // `status === "ready"`. An empty list is a genuine answer from tan
  // (`narrowInitPreview` never fabricates entries — see
  // `NewProjectPreviewDataMessage`), distinct from `"unavailable"`, and said
  // plainly rather than rendered as no section at all.
  if (preview.files.length === 0) {
    return (
      <>
        <p className={styles.groupLabel}>Files</p>
        <p className={styles.stepDesc}>tan reported no files to create.</p>
      </>
    );
  }

  return (
    <>
      <p className={styles.groupLabel}>Files ({preview.files.length})</p>
      <Card padding="sm" className={styles.previewFileList}>
        {preview.files.map((file) => (
          <div key={file.relativePath} className={styles.previewFileRow}>
            <span className={styles.previewFilePath}>{file.relativePath}</span>
            {/* `kind` is display-only and deliberately not narrowed to a closed
                set (see NewProjectFileChange) — an unseen word is still shown,
                never dropped. */}
            <span className={styles.previewFileKind}>{file.kind}</span>
          </div>
        ))}
      </Card>
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
  const {
    state,
    projectTemplates,
    e1mModules,
    examplesUnavailableReason,
    beginTemplateReload,
  } = useAppContext();
  const { state: stepper, goNext, goBack, goTo } = useStepper(STEPS);

  const [selectedTemplate, setSelectedTemplate] = useState("");
  /** The dropped template's TITLE, when a reload removed it — kept so the
   *  notice can name what the customer picked rather than echo a raw id. */
  const [droppedTemplate, setDroppedTemplate] = useState<string | null>(null);
  /** The title of whatever is selected right now. Read at drop time, when the
   *  template is already gone from the catalogue and cannot be looked up. */
  const selectedTitleRef = useRef("");
  const [selectedModule, setSelectedModule] = useState("");
  const [selectedSdk, setSelectedSdk] = useState(""); // "" = default SDK
  const [coreChoices, setCoreChoices] = useState<CoreChoice[]>([]);
  const [projectName, setProjectName] = useState("");
  const [nameError, setNameError] = useState("");
  const [destination, setDestination] = useState("");
  // Open the created project in the current window (replace) vs a new window.
  const [openInThisWindow, setOpenInThisWindow] = useState(true);
  // `tan init --preview`'s file list for the Confirm step (#616). See
  // `PreviewState`'s doc for why this is four states, not a bare array.
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });

  // Receive the parent folder chosen via the native picker (or the default).
  useEffect(() => {
    return onMessage((msg) => {
      if (msg.type === "projectLocationPicked") setDestination(msg.path);
      // The host asks for a step by ID, never by index (#530): a pair the
      // customer picked cannot be scaffolded, and pressing the notification's
      // button has to land them back on the picker rather than leave them on a
      // Confirm step whose Create will fail again. An unknown id is ignored —
      // a host that names a step this build does not have must not reset the
      // wizard to some other screen.
      if (msg.type === "newProjectFlowGoToStep") {
        const index = STEPS.findIndex((step) => step.id === msg.stepId);
        if (index >= 0) goTo(index);
      }
      // `files: null` means the preview COULD NOT BE READ, and must render as
      // "unavailable" — NEVER as `{status: "ready", files: []}`, which would
      // read as "this creates nothing" (see NewProjectPreviewDataMessage).
      if (msg.type === "newProjectPreviewData") {
        setPreview(
          msg.files === null
            ? { status: "unavailable" }
            : { status: "ready", files: msg.files },
        );
      }
    });
  }, [goTo]);

  // The chosen module's topology drives the Cores step. A layout carried over
  // from another SoM would name cores this one does not have — but a layout the
  // CUSTOMER has edited must survive anything that is not that.
  //
  // This effect also runs whenever the catalog ARRAY changes identity, and the
  // SDK step (which comes AFTER Cores) makes that happen: picking any SDK posts
  // `reloadProjectTemplates` and the host answers with a fresh list. Rebuilding
  // the defaults unconditionally therefore threw away every answer the customer
  // had just given, on the way to the screen that asks them to confirm those
  // answers (#582). `reconcileCoreChoices` replaces them only when the core IDS
  // differ, and returns the previous array by reference otherwise so React
  // bails out.
  useEffect(() => {
    const mod = (e1mModules ?? []).find((m) => m.id === selectedModule);
    setCoreChoices((previous) =>
      reconcileCoreChoices(previous, mod?.cores ?? []),
    );
  }, [selectedModule, e1mModules]);

  // Reconcile the template selection against an arriving catalogue, the same
  // rule `reconcileCoreChoices` uses for cores (#582): KEEP the customer's
  // answer when the id still exists — most SDK switches ship the same template
  // and losing the answer for nothing is its own defect — and drop it only when
  // the id is genuinely gone.
  //
  // Without this the selection survived a catalogue it is not in: `canAdvance`
  // only checks the id is non-empty, ConfirmStep's `templates.find` misses and
  // renders the RAW ID, and Create posts it anyway — `alp init --from-example`
  // then fails with "was not found" (#591).
  useEffect(() => {
    const kept = reconcileTemplateSelection(selectedTemplate, projectTemplates);
    if (kept === selectedTemplate) return;
    setDroppedTemplate(selectedTitleRef.current || selectedTemplate);
    setSelectedTemplate(kept);
    goTo(TEMPLATE_STEP_INDEX);
  }, [projectTemplates, selectedTemplate, goTo]);

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

  // The customer's Cores-step answers, on the wire shape both `createNewProject`
  // AND `requestNewProjectPreview` send (#616) — ONE place, so a change to that
  // shape cannot drift between the preview request and the real Create. Omitted
  // for an example: it ships its own board.yaml, and a layout written over it
  // (or previewed against it) would contradict the source tree it arrived with.
  const coresPayload = useMemo(
    () =>
      selectedIsExample
        ? undefined
        : coreChoices.map((choice) => ({
            id: choice.id,
            os: choice.os,
            app: choice.os === "zephyr" ? choice.app.trim() : undefined,
          })),
    [selectedIsExample, coreChoices],
  );

  // Ask for `tan init --preview`'s file list whenever the Confirm step is
  // REACHED (#616) — never on every keystroke of an earlier step, which
  // Confirm's own fields do not change anyway (its only control,
  // "open in this window", is not part of this payload).
  //
  // Narrow deps ON PURPOSE: this must re-fire on returning to Confirm after
  // changing an earlier answer (index goes 5 -> something else -> 5, which IS
  // a dependency change), but must NOT re-fire on every render while sitting
  // on it — the values it closes over do not change without leaving the step.
  useEffect(() => {
    if (stepper.currentIndex !== CONFIRM_STEP_INDEX) return;
    if (!destination) {
      // Nothing to preview INTO yet — `tan init --preview` still needs a
      // `--destination`, and the Location row already explains why for the
      // same reason. Not a failure: `"idle"` renders nothing, same as before
      // this feature existed.
      setPreview({ status: "idle" });
      return;
    }
    setPreview({ status: "loading" });
    postMessage({
      type: "requestNewProjectPreview",
      templateId: selectedTemplate,
      moduleId: selectedModule,
      projectName,
      sdkPath: selectedSdk || undefined,
      destination,
      cores: coresPayload,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepper.currentIndex]);

  const coresValid = useMemo(() => {
    // Only a Zephyr core carries a directory (#538), and each one must be a
    // real place inside the project. Compared NORMALISED: `./src`, `src` and
    // `./a/../src` are one directory, and two cores sharing a tree would have
    // `tan build` build the same source under two slice configs.
    const dirs = coreChoices
      .filter((choice) => choice.os === "zephyr")
      .map((choice) => choice.app);
    if (!dirs.every((dir) => isSafeAppDir(dir))) return false;
    const normalised = dirs.map((dir) => normaliseAppDir(dir));
    return new Set(normalised).size === normalised.length;
  }, [coreChoices]);

  const canAdvance = useMemo(() => {
    return [
      selectedTemplate !== "",
      selectedModule !== "" || selectedIsExample,
      // Cores step: every core that runs an app needs a directory, and two
      // cores may not share one — `tan build` would build the same source
      // twice under two different slice configs.
      coresValid,
      true, // SDK step — default is always valid
      projectName !== "" && nameValid,
      true,
    ];
  }, [
    selectedTemplate,
    selectedModule,
    selectedIsExample,
    coresValid,
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
  function handleSelectTemplate(id: string) {
    setSelectedTemplate(id);
    selectedTitleRef.current = templates.find((t) => t.id === id)?.title ?? id;
    // Picking again answers the notice; leaving it up would keep explaining a
    // choice the customer has now replaced.
    setDroppedTemplate(null);
  }

  function handleSelectSdk(path: string) {
    setSelectedSdk(path);
    // Put the catalogue back to "not arrived" BEFORE asking for the new one.
    // Otherwise the previous SDK's templates keep rendering as final for the
    // whole of a slow serial re-fetch, and stepping Back offers cards this SDK
    // does not ship — `alp init --from-example` then fails with "was not
    // found". The skeleton is what makes the wait legible instead.
    beginTemplateReload();
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
        cores: coresPayload,
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
                  loading={projectTemplates === null}
                  selected={selectedTemplate}
                  onSelect={handleSelectTemplate}
                  notice={
                    droppedTemplate &&
                    `SDK ${sdkLabel} does not ship "${droppedTemplate}". Pick another project type.`
                  }
                  examplesUnavailableReason={examplesUnavailableReason}
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
                <CoresStep
                  choices={coreChoices}
                  onChange={setCoreChoices}
                  isExample={selectedIsExample}
                />
              )}
              {stepper.currentIndex === 3 && (
                <SdkStep
                  entries={sdkEntries}
                  activePath={activeSdkPath}
                  selected={selectedSdk}
                  onSelect={handleSelectSdk}
                />
              )}
              {stepper.currentIndex === 4 && (
                <NameStep
                  value={projectName}
                  onChange={handleNameChange}
                  error={nameError}
                  destination={destination}
                  onBrowse={browseLocation}
                />
              )}
              {stepper.currentIndex === 5 && (
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
                  coreChoices={coreChoices}
                  preview={preview}
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
