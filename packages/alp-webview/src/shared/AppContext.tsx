import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
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
  /** tan's own words for why the example catalogue is empty, or null when it is
   *  legitimately empty. See ProjectTemplatesDataMessage. */
  examplesUnavailableReason: string | null;
  /**
   * Put the catalogue back to "not arrived" before asking the host to re-fetch
   * it, so `projectTemplates === null` keeps meaning what it says.
   *
   * Without this the null is true exactly ONCE per panel: the only other
   * setter is the `projectTemplatesData` arm, so after the first message the
   * flag can never go back. A wizard that re-fetches on every SDK change would
   * then render the PREVIOUS SDK's catalogue as final and selectable while the
   * new one is still being fetched — and that fetch is slow (the host runs
   * `explain`, then one `explain --template <id>` per template, then
   * `examples`, serially).
   *
   * It deliberately does NOT clear `e1mModules`, which arrives in the same
   * message: the Cores step rebuilds its defaults whenever the module list
   * changes identity, and clearing it would hand `reconcileCoreChoices` an
   * empty core list and wipe answers the customer already gave — the data loss
   * #582 exists to prevent.
   */
  beginTemplateReload: () => void;
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
  const [examplesUnavailableReason, setExamplesUnavailableReason] = useState<
    string | null
  >(null);

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
        setExamplesUnavailableReason(msg.examplesUnavailableReason ?? null);
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

  const beginTemplateReload = useCallback(() => setProjectTemplates(null), []);

  const value = useMemo(
    () => ({
      state,
      sdkReleases,
      sdkInstallLog,
      sdkInstallActive,
      protocolMismatch,
      projectTemplates,
      e1mModules,
      examplesUnavailableReason,
      beginTemplateReload,
    }),
    [
      state,
      sdkReleases,
      sdkInstallLog,
      sdkInstallActive,
      protocolMismatch,
      projectTemplates,
      e1mModules,
      examplesUnavailableReason,
      beginTemplateReload,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useAppContext must be used inside <AppProvider>");
  return ctx;
}
