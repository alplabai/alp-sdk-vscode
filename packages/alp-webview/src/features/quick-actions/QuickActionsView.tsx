import { Icon } from "../../shared/ui";
import type { IconName } from "../../shared/ui";
import layout from "../../shared/ui/layout.module.css";
import { postMessage } from "../../vscode";
import styles from "./QuickActionsView.module.css";

interface Tool {
  id: string;
  icon: IconName;
  label: string;
  description: string;
  command: string;
}

const TOOLS: Tool[] = [
  {
    id: "configurator",
    icon: "sliders",
    label: "Configurator",
    description: "Visual board pin & peripheral configurator",
    command: "alp.openConfigurator",
  },
  {
    id: "new-project",
    icon: "filePlus",
    label: "New Project",
    description: "Create project from a board template",
    command: "alp.newProjectWizard",
  },
  {
    id: "scaffold",
    icon: "package",
    label: "Scaffold",
    description: "Add a firmware module to the project",
    command: "alp.scaffoldModule",
  },
  {
    id: "bootstrap",
    icon: "terminal",
    label: "Bootstrap",
    description: "Install Python, west, and host dependencies",
    command: "alp.installDependencies",
  },
  {
    id: "west-update",
    icon: "refresh",
    label: "West Update",
    description: "Fetch and update all west modules",
    command: "alp.westUpdate",
  },
  {
    id: "install-sdk",
    icon: "download",
    label: "Install SDK",
    description: "Download or switch the active ALP SDK",
    command: "alp.ideHub.focus",
  },
  {
    id: "debug-doctor",
    icon: "activity",
    label: "Debug Doctor",
    description: "Diagnose build, flash, and debugger issues",
    command: "alp.debugDoctor",
  },
  {
    id: "preview",
    icon: "eye",
    label: "Preview Config",
    description: "Preview effective configuration (LSP)",
    command: "alp.previewEffectiveConfig",
  },
  {
    id: "settings",
    icon: "settings",
    label: "Settings",
    description: "Open ALP IDE extension settings",
    command: "alp.openSettings",
  },
];

export function QuickActionsView() {
  return (
    <div className={layout.section}>
      <p className={layout.sectionTitle}>Tools</p>
      <div className={styles.grid}>
        {TOOLS.map(({ id, icon, label, description, command }) => (
          <button
            key={id}
            className={styles.btn}
            title={description}
            onClick={() => postMessage({ type: "runCommand", command })}
          >
            <span className={styles.btnIcon} aria-hidden="true">
              <Icon name={icon} size={20} />
            </span>
            <span className={styles.btnLabel}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
