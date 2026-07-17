import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BoardConfig,
  ConfiguratorViewModel,
  ValidationResult,
} from "../../types";
import { onMessage, postMessage } from "../../vscode";

export type ConfiguratorSection =
  | "project"
  | "cores"
  | "chips"
  | "diagnostics"
  | "advanced"
  | "review";

export interface SectionDef {
  id: ConfiguratorSection;
  label: string;
}

export const CONFIGURATOR_SECTIONS: SectionDef[] = [
  { id: "project", label: "Project & Hardware" },
  { id: "cores", label: "Cores" },
  { id: "chips", label: "Chips" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "advanced", label: "Advanced" },
  { id: "review", label: "Review" },
];

const EMPTY_BOARD: BoardConfig = { som: { sku: "" }, cores: {} };
const EMPTY_VALIDATION: ValidationResult = { errors: [], warnings: [] };

function fingerprint(board: BoardConfig | null): string {
  return JSON.stringify(board ?? {});
}

export type BoardMutator = (draft: BoardConfig) => void;

export interface UseConfigurator {
  loaded: boolean;
  board: BoardConfig;
  vm: ConfiguratorViewModel | null;
  boardPath: string | null;
  sdkConnected: boolean;
  /** Non-null when the open document is unparseable YAML (issue #127). */
  parseError: string | null;
  dirty: boolean;
  status: string;
  validation: ValidationResult;
  /** Mutate the board and push the change to the host (debounced for scalars). */
  mutate: (fn: BoardMutator, opts?: { debounce?: boolean }) => void;
  save: () => void;
  reload: () => void;
  preview: () => void;
}

export function useConfigurator(): UseConfigurator {
  const [board, setBoard] = useState<BoardConfig>(EMPTY_BOARD);
  const [vm, setVm] = useState<ConfiguratorViewModel | null>(null);
  const [boardPath, setBoardPath] = useState<string | null>(null);
  const [sdkConnected, setSdkConnected] = useState(false);
  const [baseline, setBaseline] = useState<string>(fingerprint(EMPTY_BOARD));
  const [status, setStatus] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);

  const boardRef = useRef<BoardConfig>(board);
  boardRef.current = board;
  // True when the next render echo is the response to a local edit (keep our
  // local board to preserve input focus; only refresh the view-model).
  const expectEcho = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = onMessage((msg) => {
      if (msg.type === "configuratorRender") {
        setVm(msg.viewModel);
        setBoardPath(msg.boardPath);
        setSdkConnected(msg.sdkConnected);
        setParseError(msg.parseError ?? null);
        if (expectEcho.current) {
          expectEcho.current = false;
        } else if (msg.parseError) {
          setStatus("board.yaml could not be parsed.");
        } else {
          setBoard(msg.board);
          setBaseline(fingerprint(msg.board));
          setStatus("Loaded from disk.");
        }
      } else if (msg.type === "configuratorSaved") {
        setBaseline(fingerprint(boardRef.current));
        setStatus("Saved ✓");
      }
    });
    postMessage({ type: "ready" });
    return () => {
      unsubscribe();
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  const push = useCallback((next: BoardConfig, debounce: boolean) => {
    expectEcho.current = true;
    const send = () => postMessage({ type: "configuratorUpdate", board: next });
    if (debounce) {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(send, 200);
    } else {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      send();
    }
  }, []);

  const mutate = useCallback(
    (fn: BoardMutator, opts?: { debounce?: boolean }) => {
      const next = structuredClone(boardRef.current) as BoardConfig;
      fn(next);
      boardRef.current = next;
      setBoard(next);
      push(next, opts?.debounce ?? false);
    },
    [push],
  );

  const dirty = useMemo(
    () => fingerprint(board) !== baseline,
    [board, baseline],
  );

  const validation = vm?.validation ?? EMPTY_VALIDATION;

  const save = useCallback(() => {
    if (validation.errors.length > 0) {
      setStatus("Resolve validation errors before saving.");
      return;
    }
    postMessage({ type: "saveBoardConfig" });
  }, [validation.errors.length]);

  const reload = useCallback(() => {
    expectEcho.current = false;
    postMessage({ type: "reloadConfigurator" });
  }, []);

  const preview = useCallback(
    () => postMessage({ type: "previewEffectiveConfig" }),
    [],
  );

  return {
    loaded: vm !== null,
    board,
    vm,
    boardPath,
    sdkConnected,
    parseError,
    dirty,
    status,
    validation,
    mutate,
    save,
    reload,
    preview,
  };
}
