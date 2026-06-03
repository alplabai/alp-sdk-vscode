// SPDX-License-Identifier: Apache-2.0

import { useEffect, useReducer } from "react";
import type { ExplorerCore, HardwareExplorerSom } from "../../types";
import { postMessage } from "../../vscode";

interface State {
  som: HardwareExplorerSom | null;
  cores: ExplorerCore[];
  sdkConnected: boolean;
  loading: boolean;
}

type Action =
  | {
      type: "data";
      som: HardwareExplorerSom | null;
      cores: ExplorerCore[];
      sdkConnected: boolean;
    }
  | { type: "reload" };

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "data":
      return {
        som: action.som,
        cores: action.cores,
        sdkConnected: action.sdkConnected,
        loading: false,
      };
    case "reload":
      return { ...state, loading: true };
  }
}

const init: State = {
  som: null,
  cores: [],
  sdkConnected: false,
  loading: true,
};

export function useHardwareExplorer() {
  const [state, dispatch] = useReducer(reduce, init);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const msg = event.data;
      if (msg?.type === "hardwareExplorerData") {
        dispatch({
          type: "data",
          som: msg.som,
          cores: msg.cores,
          sdkConnected: msg.sdkConnected,
        });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function reload() {
    dispatch({ type: "reload" });
    postMessage({ type: "reloadHardwareExplorer" });
  }

  return { ...state, reload };
}
