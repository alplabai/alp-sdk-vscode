import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  PROTOCOL_VERSION,
  type AlpIdeState,
  type E1mModule,
  type ProjectTemplate,
  type SdkRelease,
} from "../types";
import { onMessage, postMessage } from "../vscode";

export interface AppContextValue {
  state: AlpIdeState | null;
  sdkReleases: SdkRelease[] | null;
  sdkInstallLog: string | null;
  sdkInstallActive: boolean;
  protocolMismatch: boolean;
  projectTemplates: ProjectTemplate[] | null;
  e1mModules: E1mModule[] | null;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AlpIdeState | null>(null);
  const [sdkReleases, setSdkReleases] = useState<SdkRelease[] | null>(null);
  const [sdkInstallLog, setSdkInstallLog] = useState<string | null>(null);
  const [sdkInstallActive, setSdkInstallActive] = useState(false);
  const [protocolMismatch, setProtocolMismatch] = useState(false);
  const [projectTemplates, setProjectTemplates] = useState<
    ProjectTemplate[] | null
  >(null);
  const [e1mModules, setE1mModules] = useState<E1mModule[] | null>(null);

  useEffect(() => {
    const unsubscribe = onMessage((msg) => {
      if (msg.type === "stateUpdate") {
        if (msg._v !== PROTOCOL_VERSION) {
          setProtocolMismatch(true);
          return;
        }
        setState(msg.state);
      } else if (msg.type === "sdkReleasesLoaded") {
        setSdkReleases(msg.releases);
      } else if (msg.type === "sdkInstallProgress") {
        setSdkInstallLog(msg.log);
        if (msg.done) {
          setSdkInstallActive(false);
          if (msg.success) {
            setTimeout(() => setSdkInstallLog(null), 4000);
          }
        } else {
          setSdkInstallActive(true);
        }
      } else if (msg.type === "projectTemplatesData") {
        setProjectTemplates(msg.templates);
        setE1mModules(msg.modules);
      } else if (msg.type === "focusSection") {
        // Best-effort scroll to a named Hub section (e.g. opening the SDK
        // Manager, now a Hub section). The element only exists on the Hub, so
        // this is a no-op on other views. Deferred a tick so a freshly-opened
        // panel has mounted the section before we scroll.
        const id = `${msg.section}-section`;
        setTimeout(() => {
          document
            .getElementById(id)
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 0);
      }
    });
    postMessage({ type: "ready" });
    return unsubscribe;
  }, []);

  const value = useMemo(
    () => ({
      state,
      sdkReleases,
      sdkInstallLog,
      sdkInstallActive,
      protocolMismatch,
      projectTemplates,
      e1mModules,
    }),
    [
      state,
      sdkReleases,
      sdkInstallLog,
      sdkInstallActive,
      protocolMismatch,
      projectTemplates,
      e1mModules,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used inside <AppProvider>");
  return ctx;
}
