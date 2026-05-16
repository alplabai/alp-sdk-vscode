import { ExistingProjectFlowView } from "./features/existing-project-flow";
import { FooterView } from "./features/footer";
import { NewProjectFlowView } from "./features/new-project-flow";
import { OverviewView } from "./features/overview";
import { ProjectView } from "./features/project";
import { QuickActionsView } from "./features/quick-actions";
import { SdkView } from "./features/sdk";
import { SetupView } from "./features/setup";
import { SetupFlowView } from "./features/setup-flow";
import { WestWorkspacesView } from "./features/west-workspaces";
import { AppProvider, useAppContext } from "./shared/AppContext";
import { Button, Divider } from "./shared/ui";
import { BuildBar } from "./shared/ui/BuildBar";
import layout from "./shared/ui/layout.module.css";
import { postMessage } from "./vscode";

// Resolved once at module load; never changes after the page is mounted.
const ALP_MODE =
  typeof document !== "undefined"
    ? (document.body.dataset.alpMode ?? "sidebar")
    : "sidebar";

function AppShell() {
  const { protocolMismatch } = useAppContext();

  if (protocolMismatch) {
    return (
      <div className={layout.section}>
        <p className={layout.sectionTitle}>ALP IDE</p>
        <p className={layout.setupRowDesc}>
          The extension was updated. Please reload the window to refresh the
          panel.
        </p>
        <div className={layout.setupRowAction}>
          <Button
            onClick={() =>
              postMessage({
                type: "runCommand",
                command: "workbench.action.reloadWindow",
              })
            }
          >
            Reload Window
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <BuildBar />
      <SetupView />
      <Divider />
      <WestWorkspacesView />
      <Divider />
      <ProjectView />
      <Divider />
      <SdkView />
      <Divider />
      <QuickActionsView />
      <FooterView />
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      {ALP_MODE === "setup-flow" ? (
        <SetupFlowView />
      ) : ALP_MODE === "overview" ? (
        <OverviewView />
      ) : ALP_MODE === "new-project-flow" ? (
        <NewProjectFlowView />
      ) : ALP_MODE === "existing-project-flow" ? (
        <ExistingProjectFlowView />
      ) : (
        <AppShell />
      )}
    </AppProvider>
  );
}
