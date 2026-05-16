import type { AlpIdeState } from "../types";
import { postMessage } from "../vscode";
import styles from "./BuildBar.module.css";

interface Props {
  state: AlpIdeState | null;
}

export function BuildBar({ state }: Props) {
  const canBuild = state?.workspace.boardYamlExists === true;
  const tip = canBuild ? undefined : "Open a configured ALP project first";

  return (
    <div className={styles.buildBar}>
      <vscode-button
        appearance="primary"
        disabled={!canBuild}
        title={tip ?? "Build firmware (west build)"}
        onClick={() =>
          postMessage({ type: "runCommand", command: "alp.westBuild" })
        }
      >
        ▶ Build
      </vscode-button>
      <vscode-button
        appearance="secondary"
        disabled={!canBuild}
        title={tip ?? "Flash to target device (west flash)"}
        onClick={() =>
          postMessage({ type: "runCommand", command: "alp.westFlash" })
        }
      >
        ⚡ Flash
      </vscode-button>
      <vscode-button
        appearance="secondary"
        disabled={!canBuild}
        title={tip ?? "Run under native_sim"}
        onClick={() =>
          postMessage({ type: "runCommand", command: "alp.westRunNativeSim" })
        }
      >
        🖥 Sim
      </vscode-button>
    </div>
  );
}
