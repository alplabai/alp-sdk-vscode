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

// `modelFitData` payload shapes (board-mode `tan model check --board`
// results), narrowed here for the view only — see BackendFit/ModelFit above
// the fields they mirror in messages.ts's ModelFitDataMessage doc comment.
export interface BackendFit {
  backend: string;
  verdict: "fits" | "cpu-fallback" | "no-fit" | string;
  est_sram_kib?: number;
  budget_sram_kib?: number | null;
  est_latency_ms?: number | null;
  op_coverage_pct?: number;
  unsupported_ops?: string[];
  source?: string;
}
export interface ModelFit {
  name: string;
  source?: string;
  backends?: BackendFit[];
  suggestion?: string | null;
  error?: string;
}

// `modelPrepResult` payload shapes (`tan model prep`'s accuracy report),
// narrowed here for the view only — mirrors ModelPrepResultMessage in types.ts.
export interface PrepAccuracy {
  samples: number;
  top1_agreement_pct: number;
  mean_cosine: number;
  max_abs_err: number;
  verdict: string;
  guidance: string | null;
}
export interface PrepResult {
  ok: boolean;
  quantized?: string;
  accuracy?: PrepAccuracy;
  issues: ModelsDataMessage["issues"];
}

interface State {
  ok: boolean;
  models: ModelListEntry[];
  toolchains: ModelToolchain[];
  issues: ModelsDataMessage["issues"];
  buildLog: string[];
  building: boolean;
  fits: ModelFit[];
  fitOk: boolean;
  fitIssues: ModelsDataMessage["issues"];
  checkingFit: boolean;
  prepping: boolean;
  prep: PrepResult | null;
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
  | { type: "progress"; log: string; done: boolean }
  | { type: "fitStart" }
  | {
      type: "fitData";
      ok: boolean;
      models: ModelFit[];
      issues: ModelsDataMessage["issues"];
    }
  | { type: "prepStart" }
  | { type: "prepResult"; result: PrepResult };

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
    case "fitStart":
      return { ...state, checkingFit: true };
    case "fitData":
      return {
        ...state,
        checkingFit: false,
        fitOk: action.ok,
        fits: action.models,
        fitIssues: action.issues,
      };
    case "prepStart":
      return { ...state, prepping: true };
    case "prepResult":
      return { ...state, prepping: false, prep: action.result };
  }
}

const init: State = {
  ok: true,
  models: [],
  toolchains: [],
  issues: [],
  buildLog: [],
  building: false,
  fits: [],
  fitOk: true,
  fitIssues: [],
  checkingFit: false,
  prepping: false,
  prep: null,
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
      } else if (msg?.type === "modelFitData") {
        dispatch({
          type: "fitData",
          ok: msg.ok,
          models: (msg.models as ModelFit[]) ?? [],
          issues: msg.issues,
        });
      } else if (msg?.type === "modelPrepResult") {
        dispatch({
          type: "prepResult",
          result: {
            ok: msg.ok,
            quantized: msg.quantized,
            accuracy: msg.accuracy,
            issues: msg.issues,
          },
        });
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

  function checkFit() {
    dispatch({ type: "fitStart" });
    postMessage({ type: "checkModelFit" });
  }

  function prepModel() {
    dispatch({ type: "prepStart" });
    postMessage({ type: "prepModel" });
  }

  return { ...state, build, refresh, checkFit, prepModel };
}
