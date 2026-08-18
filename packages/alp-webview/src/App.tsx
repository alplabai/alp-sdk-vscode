import { BuildPlanView } from "./features/build-plan";
import { ConfiguratorView } from "./features/configurator";
import { DependenciesView } from "./features/dependencies";
import { ExistingProjectFlowView } from "./features/existing-project-flow";
import { HardwareExplorerView } from "./features/hardware-explorer";
import { ModelsView } from "./features/models";
import { NewProjectFlowView } from "./features/new-project-flow";
import { OverviewView } from "./features/overview";
import { SdkView } from "./features/sdk";
import { SidebarHubView } from "./features/sidebar-hub";
import { SetupFlowView } from "./features/setup-flow";
import { AppProvider, useAppContext } from "./shared/AppContext";
import { Button, ErrorBoundary } from "./shared/ui";
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
    case "sidebar-hub":
      return <SidebarHubView />;
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
    // Replaces the Toolchain Doctor: its "one-click fixes" promise was dead on
    // every machine where tan resolved (the CLI path set no `fixId`, and the
    // Fix button was gated on exactly that), and its "recommended" badge
    // labelled hard build blockers as optional.
    case "dependencies":
      return <DependenciesView />;
    case "hardware-explorer":
      return <HardwareExplorerView />;
    case "build-plan":
      return <BuildPlanView />;
    case "models":
      return <ModelsView />;
    case "overview":
    default:
      return <OverviewView />;
  }
}

export function App() {
  // The boundary sits INSIDE the provider so a throwing view still has context
  // torn down cleanly, and OUTSIDE the router so it covers every mode rather
  // than a list of views someone has to remember to extend (#517).
  return (
    <AppProvider>
      <ErrorBoundary>
        <Router />
      </ErrorBoundary>
    </AppProvider>
  );
}
