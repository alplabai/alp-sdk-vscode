import { useAppContext } from "../../shared/AppContext";
import { postMessage } from "../../vscode";

export function useSdk() {
  const { state, sdkReleases, sdkInstallLog, sdkInstallActive } =
    useAppContext();

  return {
    sdk: state?.sdk ?? null,
    // The bootstrap half of this view reads `setup`, not `sdk`: whether the
    // environment is built is a TOOL fact (`westAvailable`, and the
    // `bootstrapRunning` flag that stays true for the whole terminal run), not
    // a property of the SDK checkout.
    setup: state?.setup ?? null,
    releases: sdkReleases,
    installLog: sdkInstallLog,
    installActive: sdkInstallActive,
    loadReleases: () => postMessage({ type: "requestSdkReleases" }),
    install: (version: string) =>
      postMessage({ type: "requestSdkInstall", version }),
    switchSdk: (sdkPath: string) => postMessage({ type: "switchSdk", sdkPath }),
    uninstall: (sdkPath: string) =>
      postMessage({ type: "uninstallSdk", sdkPath }),
    deactivate: () => postMessage({ type: "deactivateSdk" }),
    browseSdk: () => postMessage({ type: "selectSdkPath" }),
    // Bootstrap is a plain command dispatch, not an SDK-manager message: the
    // host already allowlists `alp.installDependencies`, and its panels stamp
    // `lastBootstrapAt` + refresh for it via `isBootstrapCommand`, so posting
    // the command reuses that wiring instead of adding a parallel path. It runs
    // in a TERMINAL (it can prompt for sudo/pip), which is why there is no
    // progress state here to mirror `sdkInstallActive`.
    bootstrap: () =>
      postMessage({ type: "runCommand", command: "alp.installDependencies" }),
  };
}
