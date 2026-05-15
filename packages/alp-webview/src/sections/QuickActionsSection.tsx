import { postMessage } from "../vscode";

interface ActionCard {
  id: string;
  label: string;
  description: string;
  command: string;
  buttonLabel: string;
}

const ACTIONS: ActionCard[] = [
  {
    id: "configurator",
    label: "Board Configurator",
    description: "Open the visual board pin and peripheral configurator",
    command: "alp.openConfigurator",
    buttonLabel: "Open",
  },
  {
    id: "bootstrap",
    label: "Host Tools",
    description: "Install Python, west CLI, and required host dependencies",
    command: "alp.installDependencies",
    buttonLabel: "Bootstrap",
  },
  {
    id: "sdk-manager",
    label: "SDK Manager",
    description: "Browse, install, and switch ALP firmware SDK versions",
    command: "alp.ideHub.focus",
    buttonLabel: "Open",
  },
  {
    id: "west-build",
    label: "West Build",
    description: "Build firmware for the active board and application",
    command: "alp.westBuild",
    buttonLabel: "Build",
  },
  {
    id: "west-flash",
    label: "West Flash",
    description: "Flash the last built firmware image to the target device",
    command: "alp.westFlash",
    buttonLabel: "Flash",
  },
  {
    id: "new-project",
    label: "New Project",
    description: "Create a new ALP SDK project from a board template",
    command: "alp.newProjectWizard",
    buttonLabel: "Create",
  },
  {
    id: "debug-doctor",
    label: "Debug Doctor",
    description: "Diagnose common build, flash, and debugger issues",
    command: "alp.debugDoctor",
    buttonLabel: "Run",
  },
];

export function QuickActionsSection() {
  return (
    <div className="section">
      <p className="section-title">Quick Actions</p>
      <div className="action-cards">
        {ACTIONS.map(({ id, label, description, command, buttonLabel }) => (
          <div key={id} className="action-card">
            <div className="action-card-header">
              <span className="action-card-label">{label}</span>
              <vscode-button
                appearance="secondary"
                onClick={() => postMessage({ type: "runCommand", command })}
              >
                {buttonLabel}
              </vscode-button>
            </div>
            <p className="action-card-desc">{description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
