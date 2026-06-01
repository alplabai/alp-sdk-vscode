import { useEffect, useMemo, useState } from "react";
import type { BoardModel, PresetCatalogue } from "../../types";
import { onMessage, postMessage } from "../../vscode";

export type ConfiguratorSection =
  | "project"
  | "features"
  | "diagnostics"
  | "review"
  | "advanced";

export interface SectionDef {
  id: ConfiguratorSection;
  label: string;
  level: "basic" | "advanced";
}

export const CONFIGURATOR_SECTIONS: SectionDef[] = [
  { id: "project", label: "Project", level: "basic" },
  { id: "features", label: "Features", level: "basic" },
  { id: "diagnostics", label: "Diagnostics", level: "advanced" },
  { id: "review", label: "Review", level: "basic" },
  { id: "advanced", label: "Advanced", level: "advanced" },
];

export const CORE_OS_CHOICES = ["zephyr", "yocto", "baremetal", "off"] as const;

export type IotKey = "wifi" | "mqtt" | "ble" | "tls";

export interface ConfiguratorValidation {
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

type Mutator = (draft: BoardModel) => void;

function fingerprint(model: BoardModel | null): string {
  return JSON.stringify(model ?? {});
}

function validate(model: BoardModel | null): ConfiguratorValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const suggestions: string[] = [];

  if (!model || !model.som || !model.som.sku) {
    errors.push("SoM SKU is required.");
  }
  if (!model || !model.carrier || !model.carrier.name) {
    errors.push("Carrier name is required.");
  }

  const isV2 = !!model && model.schema_version >= 2;
  if (isV2) {
    const cores = model.cores ?? {};
    const activeCores = Object.values(cores).filter(
      (c) => c && c.os && c.os !== "off",
    );
    if (activeCores.length === 0) {
      errors.push("At least one core must be active (os != off) in schema v2.");
    }
  } else if (!model || !model.os) {
    errors.push("OS target is required.");
  }

  const arena = model?.inference?.default_arena_kib;
  if (arena !== undefined && (!Number.isFinite(arena) || arena < 16)) {
    warnings.push("Inference arena should be at least 16 KiB.");
  }

  if (model?.iot?.mqtt && !model.iot.wifi) {
    suggestions.push(
      "MQTT is enabled while Wi-Fi is disabled. Confirm your transport path.",
    );
  }
  if (!model?.libraries || model.libraries.length === 0) {
    suggestions.push(
      "No optional libraries selected. This is fine for minimal projects.",
    );
  }

  return { errors, warnings, suggestions };
}

export interface UseConfigurator {
  loaded: boolean;
  model: BoardModel | null;
  catalogue: PresetCatalogue | null;
  boardPath: string | null;
  dirty: boolean;
  status: string;
  isV2: boolean;
  validation: ConfiguratorValidation;
  setSku: (sku: string) => void;
  setCarrierName: (name: string) => void;
  setOs: (os: string) => void;
  setInferenceBackend: (backend: string) => void;
  setInferenceArena: (value: string) => void;
  setIot: (key: IotKey, checked: boolean) => void;
  setDiagLastError: (checked: boolean) => void;
  setLogLevel: (level: string) => void;
  toggleLibrary: (lib: string, checked: boolean) => void;
  mergedPopulated: () => Record<string, boolean>;
  populatedSource: (chip: string) => "carrier preset" | "custom";
  setPopulated: (chip: string, checked: boolean) => void;
  setCoreOs: (coreId: string, os: string) => void;
  setCoreApp: (coreId: string, app: string) => void;
  save: () => boolean;
  reload: () => void;
  preview: () => void;
}

export function useConfigurator(): UseConfigurator {
  const [model, setModel] = useState<BoardModel | null>(null);
  const [catalogue, setCatalogue] = useState<PresetCatalogue | null>(null);
  const [boardPath, setBoardPath] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    const unsubscribe = onMessage((msg) => {
      if (msg.type === "configuratorInit") {
        setModel(msg.model);
        setCatalogue(msg.catalogue);
        setBoardPath(msg.boardPath);
        setBaseline(fingerprint(msg.model));
        setStatus("Loaded from disk.");
      } else if (msg.type === "configuratorSaved") {
        setModel((current) => {
          setBaseline(fingerprint(current));
          return current;
        });
        setStatus(`Saved ${msg.boardPath}`);
      }
    });
    postMessage({ type: "ready" });
    return unsubscribe;
  }, []);

  function update(mutator: Mutator): void {
    setModel((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev) as BoardModel;
      mutator(next);
      return next;
    });
  }

  const validation = useMemo(() => validate(model), [model]);
  const dirty = useMemo(
    () => model !== null && fingerprint(model) !== baseline,
    [model, baseline],
  );
  const isV2 = !!model && model.schema_version >= 2;

  function carrierPreset(name: string) {
    return catalogue?.carriers.find((c) => c.name === name) ?? null;
  }

  function mergedPopulated(): Record<string, boolean> {
    if (!model) return {};
    const name = model.carrier?.name ?? "";
    const preset = carrierPreset(name);
    return {
      ...(preset ? preset.populated : {}),
      ...(model.carrier?.populated ?? {}),
    };
  }

  function populatedSource(chip: string): "carrier preset" | "custom" {
    const preset = carrierPreset(model?.carrier?.name ?? "");
    return preset && chip in preset.populated ? "carrier preset" : "custom";
  }

  return {
    loaded: model !== null && catalogue !== null,
    model,
    catalogue,
    boardPath,
    dirty,
    status,
    isV2,
    validation,
    setSku: (sku) =>
      update((m) => {
        m.som = m.som ?? { sku: "" };
        m.som.sku = sku;
      }),
    setCarrierName: (name) =>
      update((m) => {
        m.carrier = { name };
      }),
    setOs: (os) =>
      update((m) => {
        m.os = os;
      }),
    setInferenceBackend: (backend) =>
      update((m) => {
        if (backend === "") {
          if (m.inference) delete m.inference.backend;
        } else {
          m.inference = m.inference ?? {};
          m.inference.backend = backend;
        }
      }),
    setInferenceArena: (value) =>
      update((m) => {
        const val = parseInt(value, 10);
        if (Number.isFinite(val) && val >= 16) {
          m.inference = m.inference ?? {};
          m.inference.default_arena_kib = val;
        } else if (m.inference) {
          delete m.inference.default_arena_kib;
        }
      }),
    setIot: (key, checked) =>
      update((m) => {
        m.iot = m.iot ?? {};
        m.iot[key] = checked;
      }),
    setDiagLastError: (checked) =>
      update((m) => {
        m.diagnostics = m.diagnostics ?? {};
        m.diagnostics.last_error = checked;
      }),
    setLogLevel: (level) =>
      update((m) => {
        m.diagnostics = m.diagnostics ?? {};
        m.diagnostics.log_level = level;
      }),
    toggleLibrary: (lib, checked) =>
      update((m) => {
        const selected = new Set(m.libraries ?? []);
        if (checked) selected.add(lib);
        else selected.delete(lib);
        m.libraries = Array.from(selected.values()).sort();
      }),
    mergedPopulated,
    populatedSource,
    setPopulated: (chip, checked) =>
      update((m) => {
        const name = m.carrier?.name ?? "";
        m.carrier = m.carrier ?? { name };
        m.carrier.populated = m.carrier.populated ?? {};
        const preset = carrierPreset(name);
        const presetDefault = preset ? preset.populated[chip] : undefined;
        if (presetDefault === checked) {
          delete m.carrier.populated[chip];
        } else {
          m.carrier.populated[chip] = checked;
        }
      }),
    setCoreOs: (coreId, os) =>
      update((m) => {
        m.cores = m.cores ?? {};
        m.cores[coreId] = m.cores[coreId] ?? { os: "off" };
        m.cores[coreId].os = os as never;
      }),
    setCoreApp: (coreId, app) =>
      update((m) => {
        m.cores = m.cores ?? {};
        m.cores[coreId] = m.cores[coreId] ?? { os: "off" };
        const trimmed = app.trim();
        if (trimmed) m.cores[coreId].app = trimmed;
        else delete m.cores[coreId].app;
      }),
    save: () => {
      if (!model) return false;
      if (validation.errors.length > 0) {
        setStatus("Resolve validation errors before saving.");
        return false;
      }
      if (!dirty) {
        setStatus("No changes to save.");
        return false;
      }
      postMessage({ type: "saveBoardModel", model });
      return true;
    },
    reload: () => postMessage({ type: "reloadConfigurator" }),
    preview: () => postMessage({ type: "previewEffectiveConfig" }),
  };
}
