// SPDX-License-Identifier: Apache-2.0
//
// Zephyr Kconfig-fragment (prj.conf) support: syntax linting + symbol
// completion + hover. PURE — no LSP types here; the server maps these plain
// results onto Diagnostic / CompletionItem / Hover.
//
// The symbol table has two layers:
//   1. CURATED_SYMBOLS below — hand-written, with real explanatory help text.
//   2. src/lsp/generated/kconfig-metadata.json — harvested by
//      scripts/vendor-kconfig-metadata.mjs from the schema-validated metadata/
//      the SDK already publishes (chips, libraries, and the peripheral /
//      silicon registries). Names there are a validated field, not a regex
//      guess over Kconfig text.
// Curated entries win on name collision: their prose is better.
//
// A full Kconfig database (all of Zephyr — ~26k symbols, only obtainable by
// running kconfiglib against a configured build) is still NOT bundled. So
// diagnostics remain SYNTAX-only: `lintPrjConf` never flags "unknown symbol",
// and it value-checks only symbols whose type we can PROVE. Harvested entries
// without a `type` are deliberately never value-linted — an unknown type must
// produce silence, never a guess.

import * as path from "path";

import generated from "./generated/kconfig-metadata.json";

export type KconfigType = "bool" | "int" | "hex" | "string";

export interface KconfigSymbol {
  /** Symbol name WITHOUT the `CONFIG_` prefix (e.g. "MAIN_STACK_SIZE"). */
  name: string;
  /**
   * Omitted when the harvest could not prove the type. Callers MUST treat
   * `undefined` as "do not value-check" rather than defaulting it — see
   * `lintPrjConf`.
   */
  type?: KconfigType;
  doc: string;
  /** Value inserted after `=` on completion (defaults to `y` for bool). */
  valueHint?: string;
  /** Provenance for harvested entries, e.g. `metadata/chips/bmi270.yaml`. */
  source?: string;
}

export interface KconfigDiagnostic {
  line: number; // 0-based
  startCol: number;
  endCol: number;
  message: string;
  /**
   * `information` is for telling the user WHY a check is unavailable. Silence
   * reads as "the feature is broken" — that misread has already happened twice
   * on this surface — so a suppressed check says so rather than saying nothing.
   */
  severity: "error" | "warning" | "information";
}

export interface KconfigCompletion {
  label: string; // full `CONFIG_<NAME>`
  detail: string; // the type
  doc: string;
  insertText: string; // `CONFIG_<NAME>=<value>`
}

/** Hand-curated, non-exhaustive. Common Zephyr knobs + representative Alp SDK
 *  enables. Every ALP_* name here is verified against the SDK's zephyr/Kconfig:
 *  only real symbols — completion must never insert an undefined-symbol line.
 *  Merged with the generated harvest below; on a name collision these win,
 *  because the hand-written `doc` explains the knob rather than restating it. */
const CURATED_SYMBOLS: readonly KconfigSymbol[] = [
  // ── Alp SDK (from alp-sdk zephyr/Kconfig) ─────────────────────────────────
  {
    name: "ALP_SDK",
    type: "bool",
    doc: "Enable the Alp SDK on Zephyr — compiles the Zephyr backend and adds <alp/…> headers to the include path.",
    valueHint: "y",
  },
  {
    name: "ALP_SDK_RPC",
    type: "bool",
    doc: "Framed RPC over OpenAMP/RPMsg for <alp/rpc.h> (cross-core calls).",
    valueHint: "y",
  },
  {
    name: "ALP_SDK_MPROC",
    type: "bool",
    doc: "Real multi-processor IPC for <alp/mproc.h> (shmem/mailbox/hwsem).",
    valueHint: "y",
  },
  {
    name: "ALP_SDK_SECURITY",
    type: "bool",
    doc: "Real MbedTLS PSA Crypto backend for <alp/security.h>.",
    valueHint: "y",
  },
  {
    name: "ALP_SDK_IOT_WIFI",
    type: "bool",
    doc: "Real Wi-Fi station via Zephyr wifi_mgmt for <alp/iot.h>.",
    valueHint: "y",
  },
  {
    name: "ALP_SDK_IOT_MQTT",
    type: "bool",
    doc: "Real MQTT client via Zephyr mqtt_client for <alp/iot.h>.",
    valueHint: "y",
  },
  {
    name: "ALP_SDK_BLE",
    type: "bool",
    doc: "Real Bluetooth host stack via Zephyr bt for <alp/ble.h>.",
    valueHint: "y",
  },
  {
    name: "ALP_SDK_INFERENCE_BACKEND_TFLM",
    type: "bool",
    doc: "TensorFlow Lite Micro inference backend (portable, runs on any core).",
    valueHint: "y",
  },
  {
    name: "ALP_SDK_DSP",
    type: "bool",
    doc: "Enable the <alp/dsp.h> standalone DSP-chain API.",
    valueHint: "y",
  },
  {
    name: "ALP_SDK_PERIPH_ADC",
    type: "bool",
    doc: "Enable the <alp/adc.h> wrapper.",
    valueHint: "y",
  },
  {
    name: "ALP_SDK_PERIPH_PWM",
    type: "bool",
    doc: "Enable the <alp/pwm.h> wrapper.",
    valueHint: "y",
  },
  {
    name: "ALP_SDK_PERIPH_I2S",
    type: "bool",
    doc: "Enable the <alp/i2s.h> wrapper.",
    valueHint: "y",
  },
  {
    name: "ALP_SDK_PERIPH_CAN",
    type: "bool",
    doc: "Enable the <alp/can.h> wrapper (classic CAN + CAN-FD).",
    valueHint: "y",
  },
  {
    name: "ALP_SDK_PERIPH_RTC",
    type: "bool",
    doc: "Enable the <alp/rtc.h> wrapper.",
    valueHint: "y",
  },
  {
    name: "ALP_SDK_PERIPH_WDT",
    type: "bool",
    doc: "Enable the <alp/wdt.h> wrapper.",
    valueHint: "y",
  },
  {
    name: "ALP_SDK_PERIPH_TMU",
    type: "bool",
    doc: "Enable the <alp/tmu.h> wrapper (CORDIC math accelerator surface).",
    valueHint: "y",
  },

  // ── Zephyr: kernel / memory ──────────────────────────────────────────────
  {
    name: "MAIN_STACK_SIZE",
    type: "int",
    doc: "Stack size (bytes) of the main thread.",
    valueHint: "2048",
  },
  {
    name: "HEAP_MEM_POOL_SIZE",
    type: "int",
    doc: "Size (bytes) of the k_malloc/k_free system heap.",
    valueHint: "4096",
  },
  {
    name: "SYSTEM_WORKQUEUE_STACK_SIZE",
    type: "int",
    doc: "Stack size of the system work queue.",
    valueHint: "1024",
  },
  {
    name: "ISR_STACK_SIZE",
    type: "int",
    doc: "Interrupt stack size (bytes).",
    valueHint: "2048",
  },
  {
    name: "THREAD_NAME",
    type: "bool",
    doc: "Store thread names (useful for debugging).",
    valueHint: "y",
  },

  // ── Zephyr: logging / console ────────────────────────────────────────────
  {
    name: "LOG",
    type: "bool",
    doc: "Enable the Zephyr logging subsystem.",
    valueHint: "y",
  },
  {
    name: "LOG_DEFAULT_LEVEL",
    type: "int",
    doc: "Default log level (0=off,1=err,2=wrn,3=inf,4=dbg).",
    valueHint: "3",
  },
  {
    name: "PRINTK",
    type: "bool",
    doc: "Enable printk() output.",
    valueHint: "y",
  },
  {
    name: "CONSOLE",
    type: "bool",
    doc: "Enable the console subsystem.",
    valueHint: "y",
  },
  {
    name: "SERIAL",
    type: "bool",
    doc: "Enable serial (UART) driver support.",
    valueHint: "y",
  },
  {
    name: "UART_CONSOLE",
    type: "bool",
    doc: "Route the console over UART.",
    valueHint: "y",
  },
  {
    name: "BOOT_BANNER",
    type: "bool",
    doc: "Print the Zephyr boot banner.",
    valueHint: "y",
  },

  // ── Zephyr: peripherals / subsystems ─────────────────────────────────────
  {
    name: "GPIO",
    type: "bool",
    doc: "Enable GPIO driver support.",
    valueHint: "y",
  },
  {
    name: "I2C",
    type: "bool",
    doc: "Enable I2C driver support.",
    valueHint: "y",
  },
  {
    name: "SPI",
    type: "bool",
    doc: "Enable SPI driver support.",
    valueHint: "y",
  },
  {
    name: "ADC",
    type: "bool",
    doc: "Enable ADC driver support.",
    valueHint: "y",
  },
  {
    name: "PWM",
    type: "bool",
    doc: "Enable PWM driver support.",
    valueHint: "y",
  },
  {
    name: "SENSOR",
    type: "bool",
    doc: "Enable the sensor subsystem.",
    valueHint: "y",
  },
  {
    name: "WATCHDOG",
    type: "bool",
    doc: "Enable watchdog driver support.",
    valueHint: "y",
  },
  {
    name: "FLASH",
    type: "bool",
    doc: "Enable flash driver support.",
    valueHint: "y",
  },
  {
    name: "NETWORKING",
    type: "bool",
    doc: "Enable the networking subsystem.",
    valueHint: "y",
  },

  // ── Zephyr: build / debug ────────────────────────────────────────────────
  {
    name: "DEBUG",
    type: "bool",
    doc: "Enable general debug support.",
    valueHint: "y",
  },
  {
    name: "DEBUG_OPTIMIZATIONS",
    type: "bool",
    doc: "Compile -Og for debuggability.",
    valueHint: "y",
  },
  {
    name: "NO_OPTIMIZATIONS",
    type: "bool",
    doc: "Compile -O0 (heaviest debug, largest).",
    valueHint: "y",
  },
  {
    name: "ASSERT",
    type: "bool",
    doc: "Enable __ASSERT() runtime checks.",
    valueHint: "y",
  },
  {
    name: "CPLUSPLUS",
    type: "bool",
    doc: "Enable C++ support in the build.",
    valueHint: "y",
  },
];

/**
 * Symbols harvested from the SDK's schema-validated metadata. Typed as
 * `KconfigSymbol[]` rather than trusting the JSON's inferred literal types:
 * the generator only ever writes `type` values from `KconfigType`, and the
 * fixture gate in test/lsp.kconfig.test.js proves the names are real.
 */
const GENERATED_SYMBOLS = generated.symbols as readonly KconfigSymbol[];

/** Curated ∪ generated, curated winning on collision, sorted by name. */
export const KCONFIG_SYMBOLS: readonly KconfigSymbol[] = (() => {
  const byName = new Map<string, KconfigSymbol>();
  for (const s of GENERATED_SYMBOLS) byName.set(s.name, s);
  for (const s of CURATED_SYMBOLS) byName.set(s.name, s);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
})();

/** Submodule commit the generated layer was harvested from (hover provenance). */
export const KCONFIG_METADATA_REV: string = generated.submoduleRev;

const SYMBOL_BY_NAME = new Map(KCONFIG_SYMBOLS.map((s) => [s.name, s]));

/** prj.conf and variants (prj_debug.conf, prj-release.conf, …). */
export function isPrjConfPath(filePath: string): boolean {
  return /^prj.*\.conf$/i.test(path.basename(filePath));
}

/** Syntax-only lint of a Kconfig fragment. Never flags "unknown symbol". */
export function lintPrjConf(text: string): KconfigDiagnostic[] {
  const out: KconfigDiagnostic[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return; // blank / comment / "is not set"

    const assignment = /^(\s*)(CONFIG_[A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!assignment) {
      const indent = line.length - line.trimStart().length;
      const lowerCase = /^\s*config_/.test(line); // typed lower-case
      out.push({
        line: i,
        startCol: indent,
        endCol: line.length,
        message: lowerCase
          ? "Kconfig symbols are upper-case — write `CONFIG_…`."
          : "Expected `CONFIG_<NAME>=<value>` (or a `#` comment).",
        severity: "warning",
      });
      return;
    }

    const [, indent, name, rawValue] = assignment;
    const value = rawValue.trim();
    if (value === "") {
      out.push({
        line: i,
        startCol: indent.length,
        endCol: line.length,
        message: `\`${name}\` has no value — use \`=y\`, \`=n\`, a number, or \`="string"\`.`,
        severity: "warning",
      });
      return;
    }
    const sym = SYMBOL_BY_NAME.get(name.slice("CONFIG_".length));
    if (sym && sym.type === "bool" && !/^[ynm]$/.test(value)) {
      out.push({
        line: i,
        // Value start: group 3 is anchored to end-of-line, so its offset is
        // line.length - rawValue.length (correct even with spaces around `=`).
        startCol: line.length - rawValue.length,
        endCol: line.length,
        message: `\`${name}\` is a boolean — expected \`y\`, \`n\`, or \`m\`.`,
        severity: "warning",
      });
    }
  });
  return out;
}

/** Completions when the cursor is in the symbol-name position (before any `=`). */
export function completePrjConf(linePrefix: string): KconfigCompletion[] {
  if (linePrefix.includes("=")) return [];
  return KCONFIG_SYMBOLS.map((s) => ({
    label: `CONFIG_${s.name}`,
    // Harvested entries have no proven type; say so rather than inventing one.
    detail: s.type ?? "Kconfig symbol",
    doc: s.doc,
    insertText: `CONFIG_${s.name}=${s.valueHint ?? (s.type === "bool" ? "y" : "")}`,
  }));
}

/** Hover markdown for a known symbol, else null. `word` may include CONFIG_. */
export function hoverPrjConf(word: string): string | null {
  const name = word.startsWith("CONFIG_") ? word.slice("CONFIG_".length) : word;
  const sym = SYMBOL_BY_NAME.get(name);
  if (!sym) return null;
  // No type is shown when none was proven — an unproven `(bool)` in a hover
  // reads as authoritative and would be a lie.
  const heading = sym.type
    ? `**CONFIG_${sym.name}** _(${sym.type})_`
    : `**CONFIG_${sym.name}**`;
  const provenance = sym.source ? `\n\n_Declared in \`${sym.source}\`._` : "";
  return `${heading}\n\n${sym.doc}${provenance}`;
}
