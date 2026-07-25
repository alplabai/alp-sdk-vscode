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

// A real bench-measured energy result (`tan model run --on-device`/`tan model
// ab`); undefined on a host-only run (the overwhelmingly common case) or a
// malformed energy object — mirrors ModelEnergyMeasurement in types.ts.
export interface EnergyView {
  source: string;
  scope: string;
  value_mj_per_inference: number;
  rails: string[];
  n_inferences: number;
  window_ms: number;
  sample_count: number;
  spread_mj: number | null;
}

// `modelRunResult`/`modelAbResult` payload shapes (`tan model run`/`tan model
// ab`'s host reference measurements), narrowed here for the view only —
// mirrors ModelRunResultMessage/ModelAbResultMessage in types.ts.
export interface RunResultView {
  backend: string;
  latency_ms: number;
  output_argmax: number | null;
  peak_sram_kib: number | null;
  power_mj: number | null;
  runs: number;
  random_input: boolean;
  note: string;
  accuracy?: { expected: number; match: boolean };
  energy?: EnergyView;
}
export interface AbResultView {
  a: {
    model: string;
    backend: string;
    latency_ms: number;
    energy?: EnergyView;
  };
  b: {
    model: string;
    backend: string;
    latency_ms: number;
    energy?: EnergyView;
  };
  comparison: {
    faster: string;
    latency_ratio: number | null;
    a_latency_ms: number;
    b_latency_ms: number;
    size_delta_bytes: number | null;
    energy_delta_mj_per_inference?: number;
  };
  note: string;
}

// `zooData` payload shapes (`tan model zoo --board`'s curated gallery),
// narrowed here for the view only — mirrors ZooEntry/ZooDataMessage in types.ts.
export interface ZooEntryView {
  id: string;
  task: string;
  description: string;
  license: string;
  validated_soms: string[];
  runs_here: boolean | null;
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
  measuring: boolean;
  runOk: boolean;
  runResult: RunResultView | null;
  runIssues: ModelsDataMessage["issues"];
  abOk: boolean;
  abResult: AbResultView | null;
  abIssues: ModelsDataMessage["issues"];
  zoo: ZooEntryView[];
  zooOk: boolean;
  zooIssues: ModelsDataMessage["issues"];
  adding: boolean;
  addOk: boolean;
  addIssues: ModelsDataMessage["issues"];
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
  | { type: "prepResult"; result: PrepResult }
  | { type: "measureStart" }
  | {
      type: "runResult";
      ok: boolean;
      run: RunResultView | null;
      issues: ModelsDataMessage["issues"];
    }
  | {
      type: "abResult";
      ok: boolean;
      ab: AbResultView | null;
      issues: ModelsDataMessage["issues"];
    }
  | {
      type: "zooData";
      ok: boolean;
      entries: ZooEntryView[];
      issues: ModelsDataMessage["issues"];
    }
  | { type: "addStart" }
  | {
      type: "addResult";
      ok: boolean;
      issues: ModelsDataMessage["issues"];
    };

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
    case "measureStart":
      return { ...state, measuring: true };
    case "runResult":
      return {
        ...state,
        measuring: false,
        runOk: action.ok,
        runResult: action.run,
        runIssues: action.issues,
      };
    case "abResult":
      return {
        ...state,
        measuring: false,
        abOk: action.ok,
        abResult: action.ab,
        abIssues: action.issues,
      };
    case "zooData":
      return {
        ...state,
        zoo: action.entries,
        zooOk: action.ok,
        zooIssues: action.issues,
      };
    case "addStart":
      return { ...state, adding: true };
    case "addResult":
      return {
        ...state,
        adding: false,
        addOk: action.ok,
        addIssues: action.issues,
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
  fits: [],
  fitOk: true,
  fitIssues: [],
  checkingFit: false,
  prepping: false,
  prep: null,
  measuring: false,
  runOk: true,
  runResult: null,
  runIssues: [],
  abOk: true,
  abResult: null,
  abIssues: [],
  zoo: [],
  zooOk: true,
  zooIssues: [],
  adding: false,
  addOk: true,
  addIssues: [],
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
      } else if (msg?.type === "modelPrepStarted") {
        dispatch({ type: "prepStart" });
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
      } else if (msg?.type === "modelMeasureStarted") {
        dispatch({ type: "measureStart" });
      } else if (msg?.type === "modelRunResult") {
        dispatch({
          type: "runResult",
          ok: msg.ok,
          run: (msg.run as RunResultView) ?? null,
          issues: msg.issues,
        });
      } else if (msg?.type === "modelAbResult") {
        dispatch({
          type: "abResult",
          ok: msg.ok,
          ab: (msg.ab as AbResultView) ?? null,
          issues: msg.issues,
        });
      } else if (msg?.type === "zooData") {
        dispatch({
          type: "zooData",
          ok: msg.ok,
          entries: msg.entries as ZooEntryView[],
          issues: msg.issues,
        });
      } else if (msg?.type === "zooAddStarted") {
        dispatch({ type: "addStart" });
      } else if (msg?.type === "zooAddResult") {
        // The panel already re-posts `zooData` (+ `modelsData`) after a
        // successful add — this clears the button's disabled state AND
        // carries `ok`/`issues` so a failed add (e.g. duplicate name) still
        // renders something (never silent, mirrors PrepReport's failure path).
        dispatch({ type: "addResult", ok: msg.ok, issues: msg.issues });
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
    postMessage({ type: "prepModel" });
  }

  // No optimistic `measuring:true` here — the extension posts
  // `modelMeasureStarted` only after its file dialog(s) confirm, so a
  // cancelled dialog never sticks the button (see panel.ts's runModel/abModels).
  function runModel() {
    postMessage({ type: "runModel" });
  }

  function abModels() {
    postMessage({ type: "abModels" });
  }

  function requestZoo() {
    postMessage({ type: "requestZoo" });
  }

  // No optimistic `adding:true` here — the extension posts `zooAddStarted`
  // only after it actually starts the add, mirroring prepModel/runModel so a
  // failure-to-start never sticks the button (the 3c lesson).
  function addFromZoo(id: string) {
    postMessage({ type: "addFromZoo", id });
  }

  return {
    ...state,
    build,
    refresh,
    checkFit,
    prepModel,
    runModel,
    abModels,
    requestZoo,
    addFromZoo,
  };
}
