import { useEffect, useMemo, useState } from "react";
import type { ToolchainFixId, ToolchainReport } from "../../types";
import { onMessage, postMessage } from "../../vscode";

export interface UseToolchainDoctor {
  report: ToolchainReport | null;
  loading: boolean;
  reload(): void;
  runFix(fixId: ToolchainFixId): void;
}

export function useToolchainDoctor(): UseToolchainDoctor {
  const [report, setReport] = useState<ToolchainReport | null>(null);

  useEffect(() => {
    const off = onMessage((msg) => {
      if (msg.type === "toolchainReport") {
        setReport(msg.report);
      }
    });
    postMessage({ type: "ready" });
    return off;
  }, []);

  return useMemo<UseToolchainDoctor>(
    () => ({
      report,
      loading: report === null,
      reload() {
        setReport(null);
        postMessage({ type: "reloadToolchain" });
      },
      runFix(fixId) {
        postMessage({ type: "runToolchainFix", fixId });
      },
    }),
    [report],
  );
}
