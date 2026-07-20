import { BuildPlanView } from "./features/build-plan";
import { ConfiguratorView } from "./features/configurator";
import { ExistingProjectFlowView } from "./features/existing-project-flow";
import { HardwareExplorerView } from "./features/hardware-explorer";
import { NewProjectFlowView } from "./features/new-project-flow";
import { OverviewView } from "./features/overview";
import { QuickstartView } from "./features/quickstart";
import { SdkView } from "./features/sdk";
import { SetupFlowView } from "./features/setup-flow";
import { ToolchainDoctorView } from "./features/toolchain-doctor";
import { AppProvider, useAppContext } from "./shared/AppContext";
import { Button } from "./shared/ui";
import layout from "./shared/ui/layout.module.css";
import { postMessage } from "./vscode";

// Resolved once at module load; never changes after the page is mounted.
// Each webview panel sets `data-alp-mode` to pick the view it hosts.
const ALP_MODE =
  typeof document !== "undefined"
    ? (document.body.dataset.alpMode ?? "overview")
    : "overview";

/** Shown when the extension and webview protocol versions diverge. */
function ProtocolMismatchNotice() {
  return (
    <div className={layout.section}>
      <p className={layout.sectionTitle}>Alp IDE</p>
      <p className={layout.setupRowDesc}>
        The extension was updated. Please reload the window to refresh this
        view.
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

/** Routes the active `ALP_MODE` to its panel view. */
function Router() {
  const { protocolMismatch } = useAppContext();
  if (protocolMismatch) return <ProtocolMismatchNotice />;

  switch (ALP_MODE) {
    case "quickstart":
      return <QuickstartView />;
    case "setup-flow":
      return <SetupFlowView />;
    case "new-project-flow":
      return <NewProjectFlowView />;
    case "existing-project-flow":
      return <ExistingProjectFlowView />;
    case "sdk-manager":
      return <SdkView />;
    case "configurator":
      return <ConfiguratorView />;
    case "toolchain-doctor":
      return <ToolchainDoctorView />;
    case "hardware-explorer":
      return <HardwareExplorerView />;
    case "build-plan":
      return <BuildPlanView />;
    case "overview":
    default:
      return <OverviewView />;
  }
}

export function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  );
}
