import { useAppContext } from "../../shared/AppContext";
import { Skeleton } from "../../shared/ui";
import layout from "../../shared/ui/layout.module.css";

// Placeholder only — the full four-step ladder UI lands in a follow-up change.
// This proves the sidebar webview view is wired and the shared state pipe
// (StateManager -> QuickstartViewProvider -> AppContext) flows end to end.
const STEPS = ["Environment", "Project", "Board", "Build & Flash"];

export function QuickstartView() {
  const { state } = useAppContext();

  return (
    <div className={layout.section}>
      <p className={layout.sectionTitle}>Quickstart</p>

      {!state ? (
        <div className={layout.loadingRow}>
          <Skeleton lines={4} />
        </div>
      ) : (
        <>
          {STEPS.map((step) => (
            <p key={step} className={layout.setupRowDesc}>
              {step}
            </p>
          ))}
          <p className={layout.setupRowDesc}>
            board.yaml:{" "}
            {state.workspace.boardYamlExists
              ? state.workspace.boardYamlValid
                ? "valid"
                : "invalid"
              : "none"}
          </p>
        </>
      )}
    </div>
  );
}
