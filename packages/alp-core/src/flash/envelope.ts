// SPDX-License-Identifier: Apache-2.0
//
// The slice of `tan flash --format json` this extension reads (#540). Pure: no
// `vscode`, no `fs`.
//
// ── WHERE THE SHAPE COMES FROM ─────────────────────────────────────────────
//
// `tan flash` has NO entry in the vendored envelope corpus, and the flash
// issue codes are `reserved` / consumer `none` in tan's frozen list at v0.7.0,
// so nothing upstream promises any of this. The shape below is therefore
// MEASURED, not declared: every field read here is present in the real tan
// 0.7.0 captures under `test/fixtures/tan-flash/` (provenance in the
// PROVENANCE.md beside them), and `test/tanContract.test.js` files each issue
// code this extension binds as `reserved` so a code that tan freezes or
// retires turns a test red instead of silently never matching. Freezing the
// flash envelope is an upstream ask, not something this file can assume.
//
// ── NORMALISATION IS THE POINT ─────────────────────────────────────────────
//
// Raw field names are read in `parseFlashEnvelope` and nowhere else. Everything
// downstream (`arming.ts`, `outcome.ts`) works on `FlashEnvelope`, so the day
// tan renames a field the edit is in one function and the fixtures say whether
// it worked.

/** The backend tan routes a slice to when `flash_args` names a J-Link part. */
export const FLOW_D_METHOD = "alif_mram_jlink";

/**
 * What a resolved backend does on a `tan flash` run, at tan 0.7.0:
 *
 * - `flow-d`      `alif_mram_jlink`. A preview unless `--confirm`; a confirmed
 *                 write also needs `--atoc-unqueryable`.
 * - `never-arm`   `yocto_wic*` (a real `bmaptool`/`dd` to a HOST block device
 *                 under `--confirm`) and `xspi_flashwriter` (a HARD refusal
 *                 under `--confirm`). The extension never arms either.
 * - `writes`      exactly `zephyr_west_flash` and `baremetal_cmake_flash`:
 *                 they write on a bare `tan flash`, and `--confirm` changes
 *                 nothing.
 * - `unknown`     anything else (a renamed or new method, a
 *                 missing one). Not assumed to behave like `writes`; the
 *                 gate refuses it.
 */
export type FlashBackendClass = "flow-d" | "never-arm" | "writes" | "unknown";

/** The backends VERIFIED to write on a bare `tan flash` and ignore
 *  `--confirm` at tan 0.7.0. An allow-list on purpose: a renamed, new or
 *  missing method must not be assumed to behave like these. */
const WRITES_UNASKED: ReadonlySet<string> = new Set([
  "zephyr_west_flash",
  "baremetal_cmake_flash",
]);

export function classifyBackend(method: string | null): FlashBackendClass {
  if (method === FLOW_D_METHOD) return "flow-d";
  if (method !== null && method.startsWith("yocto_wic")) return "never-arm";
  if (method === "xspi_flashwriter") return "never-arm";
  if (method !== null && WRITES_UNASKED.has(method)) return "writes";
  return "unknown";
}

/** One `data.entries[]` row, normalised. */
export interface FlashEnvelopeEntry {
  kind: string;
  id: string;
  /** The backend tan RESOLVED (`method`). Null for a skipped helper. */
  method: string | null;
  /** The manifest's own `flash_method`, present only when tan changed it. */
  methodDeclared: string | null;
  /** `ok` | `planned` | `failed` | `skipped` — verbatim. */
  status: string;
  rc: number;
  message: string;
  /** A J-Link write session left a transcript: bytes were attempted. */
  hasWriteTranscript: boolean;
  setools: {
    dir: string | null;
    source: string | null;
    signSkipped: boolean;
  } | null;
  /** Names of the ATOC entries this slice's signing named, `DEVICE` excluded. */
  atocNames: readonly string[] | null;
}

export interface FlashEnvelopeIssue {
  code: string;
  severity: string;
  message: string;
}

export interface FlashEnvelope {
  ok: boolean;
  exitCode: number;
  entries: readonly FlashEnvelopeEntry[];
  issues: readonly FlashEnvelopeIssue[];
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseEntry(value: unknown): FlashEnvelopeEntry | null {
  if (!isObject(value)) return null;
  const id = str(value.id);
  const status = str(value.status);
  if (id === null || status === null) return null;

  const jlink = isObject(value.jlink) ? value.jlink : null;
  const setools = isObject(value.setools) ? value.setools : null;
  const atoc = isObject(value.atoc) ? value.atoc : null;
  const atocEntries =
    atoc !== null && Array.isArray(atoc.entries) ? atoc.entries : null;

  return {
    kind: str(value.kind) ?? "slice",
    id,
    method: str(value.method),
    methodDeclared: str(value.methodDeclared),
    status,
    rc: typeof value.rc === "number" ? value.rc : -1,
    message: str(value.message) ?? "",
    hasWriteTranscript:
      jlink !== null &&
      (str(jlink.transcriptPath) !== null ||
        Array.isArray(jlink.transcriptTail)),
    setools:
      setools === null
        ? null
        : {
            dir: str(setools.dir),
            source: str(setools.source),
            signSkipped: setools.signSkipped === true,
          },
    atocNames:
      atocEntries === null
        ? null
        : atocEntries
            .map((e) => (isObject(e) ? str(e.name) : null))
            .filter(
              (name): name is string => name !== null && name !== "DEVICE",
            ),
  };
}

function parseIssue(value: unknown): FlashEnvelopeIssue | null {
  if (!isObject(value)) return null;
  const code = str(value.code);
  if (code === null) return null;
  return {
    code,
    severity: str(value.severity) ?? "error",
    message: str(value.message) ?? "",
  };
}

/**
 * Parse `tan flash --format json` stdout. Null for anything that is not a
 * `flash` envelope with an `entries` array — the caller treats null as "no
 * verdict" and says so rather than guessing.
 */
export function parseFlashEnvelope(text: string): FlashEnvelope | null {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    // A login profile that prints (a banner, `nvm use`) puts lines ahead of
    // tan's own output, which is a single JSON line. The LAST line that opens
    // an envelope is tan's: the shell `exec`s tan, so nothing follows it.
    const start = text.lastIndexOf('\n{"command":');
    if (start < 0) return null;
    try {
      doc = JSON.parse(text.slice(start + 1));
    } catch {
      return null;
    }
  }
  if (!isObject(doc) || doc.command !== "flash") return null;
  if (typeof doc.ok !== "boolean" || typeof doc.exitCode !== "number")
    return null;
  const data = isObject(doc.data) ? doc.data : null;
  if (data === null || !Array.isArray(data.entries)) return null;

  return {
    ok: doc.ok,
    exitCode: doc.exitCode,
    entries: data.entries
      .map(parseEntry)
      .filter((e): e is FlashEnvelopeEntry => e !== null),
    issues: (Array.isArray(doc.issues) ? doc.issues : [])
      .map(parseIssue)
      .filter((i): i is FlashEnvelopeIssue => i !== null),
  };
}
