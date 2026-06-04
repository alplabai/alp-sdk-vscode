import { useState } from "react";
import { BuildPlanView } from "./features/build-plan";
import { ConfiguratorView } from "./features/configurator";
import { ExistingProjectFlowView } from "./features/existing-project-flow";
import { FooterView } from "./features/footer";
import { HardwareExplorerView } from "./features/hardware-explorer";
import { NewProjectFlowView } from "./features/new-project-flow";
import { OverviewView } from "./features/overview";
import { ProjectView } from "./features/project";
import { QuickActionsView } from "./features/quick-actions";
import { SdkView } from "./features/sdk";
import { SetupView } from "./features/setup";
import { SetupFlowView } from "./features/setup-flow";
import { ToolchainDoctorView } from "./features/toolchain-doctor";
import { WestWorkspacesView } from "./features/west-workspaces";
import { AppProvider, useAppContext } from "./shared/AppContext";
import type { TabItem } from "./shared/ui";
import { Button, Icon, TabBar } from "./shared/ui";
import { BuildBar } from "./shared/ui/BuildBar";
import layout from "./shared/ui/layout.module.css";
import { postMessage } from "./vscode";

// Resolved once at module load; never changes after the page is mounted.
const ALP_MODE =
  typeof document !== "undefined"
    ? (document.body.dataset.alpMode ?? "sidebar")
    : "sidebar";

type SidebarTab = "env" | "project" | "build" | "sdk" | "tools";

const ICON_SIZE = 16;
const SIDEBAR_TABS: TabItem<SidebarTab>[] = [
  { id: "env", label: "Env", icon: <Icon name="terminal" size={ICON_SIZE} /> },
  {
    id: "project",
    label: "Project",
    icon: <Icon name="folder" size={ICON_SIZE} />,
  },
  { id: "build", label: "Build", icon: <Icon name="cpu" size={ICON_SIZE} /> },
  { id: "sdk", label: "SDK", icon: <Icon name="package" size={ICON_SIZE} /> },
  { id: "tools", label: "Tools", icon: <Icon name="bolt" size={ICON_SIZE} /> },
];

function AppShell() {
  const { protocolMismatch } = useAppContext();
  const [activeTab, setActiveTab] = useState<SidebarTab>("env");

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
      <TabBar
        tabs={SIDEBAR_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <div
        key={activeTab}
        className="alp-animate-in"
        role="tabpanel"
        id={`tabpanel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
      >
        {activeTab === "env" && <SetupView />}

        {activeTab === "project" && (
          <>
            <WestWorkspacesView />
            <ProjectView />
          </>
        )}

        {activeTab === "build" && <BuildPlanView />}

        {activeTab === "sdk" && <SdkView />}

        {activeTab === "tools" && <QuickActionsView />}
      </div>

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
      ) : ALP_MODE === "sdk-manager" ? (
        <SdkView />
      ) : ALP_MODE === "configurator" ? (
        <ConfiguratorView />
      ) : ALP_MODE === "toolchain-doctor" ? (
        <ToolchainDoctorView />
      ) : ALP_MODE === "hardware-explorer" ? (
        <HardwareExplorerView />
      ) : (
        <AppShell />
      )}
    </AppProvider>
  );
}
