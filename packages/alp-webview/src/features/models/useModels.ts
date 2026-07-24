// SPDX-License-Identifier: Apache-2.0

import { useEffect, useReducer } from "react";
import type { ModelsDataMessage } from "../../types";
import { postMessage } from "../../vscode";

// `modelsData` keeps `models`/`toolchains` as `unknown[]` at the protocol
// boundary (see types.ts) — these are the Plan-A shapes narrowed locally for
// this view only; not re-declared from the tan-owned schema.
export interface ModelArtifact {
  exists: boolean;
  bytes?: number;
  stale?: boolean;
}
export interface ModelListEntry {
  name: string;
  source: string;
  artifact?: ModelArtifact;
}
export interface ModelToolchain {
  backend: string;
  tool: string;
  available: boolean;
  version?: string;
  reason?: string;
}

interface State {
  ok: boolean;
  models: ModelListEntry[];
  toolchains: ModelToolchain[];
  issues: ModelsDataMessage["issues"];
  buildLog: string[];
  building: boolean;
}

type Action =
  | {
      type: "data";
      ok: boolean;
      models: ModelListEntry[];
      toolchains: ModelToolchain[];
      issues: ModelsDataMessage["issues"];
    }
  | { type: "buildStart" }
  | { type: "progress"; log: string; done: boolean };

function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "data":
      return {
        ...state,
        ok: action.ok,
        models: action.models,
        toolchains: action.toolchains,
        issues: action.issues,
      };
    case "buildStart":
      return { ...state, building: true, buildLog: [] };
    case "progress":
      return {
        ...state,
        building: !action.done,
        buildLog: [...state.buildLog, action.log],
      };
  }
}

const init: State = {
  ok: true,
  models: [],
  toolchains: [],
  issues: [],
  buildLog: [],
  building: false,
};

export function useModels() {
  const [state, dispatch] = useReducer(reduce, init);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const msg = event.data;
      if (msg?.type === "modelsData") {
        dispatch({
          type: "data",
          ok: msg.ok,
          models: msg.models as ModelListEntry[],
          toolchains: msg.toolchains as ModelToolchain[],
          issues: msg.issues,
        });
      } else if (msg?.type === "modelBuildProgress") {
        dispatch({ type: "progress", log: msg.log, done: msg.done });
        // Build finished (success or failure) — re-request so the artifact
        // badges / doctor state reflect what just happened.
        if (msg.done) {
          postMessage({ type: "requestModels" });
        }
      }
    }
    window.addEventListener("message", onMessage);
    postMessage({ type: "requestModels" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function build(name?: string) {
    dispatch({ type: "buildStart" });
    postMessage({ type: "buildModel", name });
  }

  function refresh() {
    postMessage({ type: "requestModels" });
  }

  return { ...state, build, refresh };
}
