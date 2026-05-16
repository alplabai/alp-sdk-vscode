import { postMessage } from "../vscode";

interface Tool {
  id: string;
  icon: string;
  label: string;
  description: string;
  command: string;
}

const TOOLS: Tool[] = [
  {
    id: "configurator",
    icon: "⚙",
    label: "Configurator",
    description: "Visual board pin & peripheral configurator",
    command: "alp.openConfigurator",
  },
  {
    id: "new-project",
    icon: "✦",
    label: "New Project",
    description: "Create project from a board template",
    command: "alp.newProjectWizard",
  },
  {
    id: "scaffold",
    icon: "⬡",
    label: "Scaffold",
    description: "Add a firmware module to the project",
    command: "alp.scaffoldModule",
  },
  {
    id: "bootstrap",
    icon: "↓",
    label: "Bootstrap",
    description: "Install Python, west, and host dependencies",
    command: "alp.installDependencies",
  },
  {
    id: "west-update",
    icon: "⟳",
    label: "West Update",
    description: "Fetch and update all west modules",
    command: "alp.westUpdate",
  },
  {
    id: "install-sdk",
    icon: "⬇",
    label: "Install SDK",
    description: "Download or switch the active ALP SDK",
    command: "alp.ideHub.focus",
  },
  {
    id: "debug-doctor",
    icon: "⚕",
    label: "Debug Doctor",
    description: "Diagnose build, flash, and debugger issues",
    command: "alp.debugDoctor",
  },
  {
    id: "preview",
    icon: "◉",
    label: "Preview Config",
    description: "Preview effective configuration (LSP)",
    command: "alp.previewEffectiveConfig",
  },
  {
    id: "settings",
    icon: "⊞",
    label: "Settings",
    description: "Open ALP IDE extension settings",
    command: "alp.openSettings",
  },
];

export function QuickActionsSection() {
  return (
    <div className="section">
      <p className="section-title">Tools</p>
      <div className="tool-grid">
        {TOOLS.map(({ id, icon, label, description, command }) => (
          <button
            key={id}
            className="tool-btn"
            title={description}
            onClick={() => postMessage({ type: "runCommand", command })}
          >
            <span className="tool-btn-icon" aria-hidden="true">
              {icon}
            </span>
            <span className="tool-btn-label">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
