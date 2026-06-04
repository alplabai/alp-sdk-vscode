import { useAppContext } from "../../../shared/AppContext";
import { postMessage } from "../../../vscode";
import { Button } from "../Button";
import { Icon } from "../Icon";
import styles from "./BuildBar.module.css";

export function BuildBar() {
  const { state } = useAppContext();
  const canBuild = state?.workspace.boardYamlExists === true;
  const tip = canBuild ? undefined : "Open a configured ALP project first";

  return (
    <div className={styles.buildBar}>
      <Button
        appearance="primary"
        disabled={!canBuild}
        title={tip ?? "Build firmware (west build)"}
        onClick={() =>
          postMessage({ type: "runCommand", command: "alp.westBuild" })
        }
      >
        <Icon name="play" size={14} /> Build
      </Button>
      <Button
        appearance="secondary"
        disabled={!canBuild}
        title={tip ?? "Flash to target device (west flash)"}
        onClick={() =>
          postMessage({ type: "runCommand", command: "alp.westFlash" })
        }
      >
        <Icon name="bolt" size={14} /> Flash
      </Button>
      <Button
        appearance="secondary"
        disabled={!canBuild}
        title={tip ?? "Run under native_sim"}
        onClick={() =>
          postMessage({ type: "runCommand", command: "alp.westRunNativeSim" })
        }
      >
        <Icon name="monitor" size={14} /> Sim
      </Button>
    </div>
  );
}
