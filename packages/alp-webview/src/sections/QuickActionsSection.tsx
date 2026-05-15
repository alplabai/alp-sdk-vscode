import { postMessage } from "../vscode";

const ACTIONS: { label: string; command: string }[] = [
  { label: "Board Configurator", command: "alp.openConfigurator" },
  { label: "West Build", command: "alp.westBuild" },
  { label: "West Flash", command: "alp.westFlash" },
  { label: "New Project", command: "alp.newProjectWizard" },
  { label: "Bootstrap", command: "alp.bootstrap" },
  { label: "Debug Doctor", command: "alp.debugDoctor" },
];

export function QuickActionsSection() {
  return (
    <div className="section">
      <p className="section-title">Quick Actions</p>
      <div className="btn-row">
        {ACTIONS.map(({ label, command }) => (
          <vscode-button
            key={command}
            onClick={() => postMessage({ type: "runCommand", command })}
          >
            {label}
          </vscode-button>
        ))}
      </div>
    </div>
  );
}
