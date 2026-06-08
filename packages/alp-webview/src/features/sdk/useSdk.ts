import { useAppContext } from "../../shared/AppContext";
import { postMessage } from "../../vscode";

export function useSdk() {
  const { state, sdkReleases, sdkInstallLog, sdkInstallActive } =
    useAppContext();

  return {
    sdk: state?.sdk ?? null,
    releases: sdkReleases,
    installLog: sdkInstallLog,
    installActive: sdkInstallActive,
    loadReleases: () => postMessage({ type: "requestSdkReleases" }),
    install: (version: string) =>
      postMessage({ type: "requestSdkInstall", version }),
    switchSdk: (sdkPath: string) => postMessage({ type: "switchSdk", sdkPath }),
    uninstall: (sdkPath: string) =>
      postMessage({ type: "uninstallSdk", sdkPath }),
    browseSdk: () => postMessage({ type: "selectSdkPath" }),
  };
}
