// SPDX-License-Identifier: Apache-2.0

import {
    checkSdkReadiness,
    installSdkRelease,
    listRemoteSdkReleases,
    resolveActiveSdk,
    switchActiveSdk,
} from "@alp-sdk/core/sdk/service";
import * as os from "os";
import * as path from "path";
import {
    CLI_EXIT_CODE,
    CliExecutionInput,
    CliExecutionResult,
    CliGlobalFlags,
    SdkCommandData,
    SdkCurrentData,
    SdkInstallData,
    SdkListData,
    SdkSwitchData,
} from "../../models";
import { createEnvelope, createFailureResult } from "../envelope";

/** Default local cache root for installed SDK versions. */
function defaultCacheRoot(): string {
  return path.join(os.homedir(), ".alp", "sdk-cache");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Dispatch `alp sdk <subcommand>` to the appropriate handler.
 *
 * @param subcommand  - first positional arg after "sdk" (e.g. "list")
 * @param subArgs     - remaining positional args (e.g. ["v1.5.0"])
 * @param flags       - parsed global CLI flags
 * @param input       - execution context (injected adapters live here)
 */
export async function runSdkCommand(
  subcommand: string | undefined,
  subArgs: string[],
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): Promise<CliExecutionResult<SdkCommandData>> {
  switch (subcommand) {
    case "list":
      return runSdkList(flags, input);
    case "install":
      return runSdkInstall(subArgs[0], flags, input);
    case "current":
      return runSdkCurrent(flags, input);
    case "switch":
      return runSdkSwitch(subArgs[0], flags, input);
    default: {
      const sub = subcommand ?? "(none)";
      return createFailureResult(
        "sdk",
        flags.format,
        CLI_EXIT_CODE.runtimeFailure,
        [
          `sdk: unknown subcommand '${sub}'.`,
          "Available subcommands: list, install <version>, current, switch <version>",
        ],
        [
          {
            code: "sdk.unknown-subcommand",
            severity: "error",
            message: `Unknown sdk subcommand: ${sub}`,
          },
        ],
        { subcommand: "list", releases: [] },
      );
    }
  }
}

// ---------------------------------------------------------------------------
// alp sdk list
// ---------------------------------------------------------------------------

async function runSdkList(
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): Promise<CliExecutionResult<SdkListData>> {
  if (!input.httpFetch) {
    return createFailureResult(
      "sdk",
      flags.format,
      CLI_EXIT_CODE.internalFailure,
      ["sdk list: HTTP adapter not available."],
      [
        {
          code: "sdk.no-http-adapter",
          severity: "error",
          message: "HTTP adapter not wired.",
        },
      ],
      { subcommand: "list", releases: [] },
    );
  }

  let releases;
  try {
    releases = await listRemoteSdkReleases(input.httpFetch);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createFailureResult(
      "sdk",
      flags.format,
      CLI_EXIT_CODE.runtimeFailure,
      [`sdk list: failed to fetch releases.`, message],
      [{ code: "sdk.fetch-failed", severity: "error", message }],
      { subcommand: "list", releases: [] },
    );
  }

  const data: SdkListData = { subcommand: "list", releases };

  const textLines = formatReleaseTable(releases);

  return {
    format: flags.format,
    exitCode: CLI_EXIT_CODE.success,
    textLines: flags.format === "json" ? [] : textLines,
    envelope: createEnvelope(
      "sdk",
      { root: null, boardYaml: null },
      data,
      [],
      CLI_EXIT_CODE.success,
    ),
  };
}

function formatReleaseTable(releases: SdkListData["releases"]): string[] {
  if (releases.length === 0) {
    return ["No SDK releases found."];
  }

  const lines: string[] = [`ALP SDK releases (${releases.length})`];
  for (const rel of releases) {
    const date = rel.publishedAt.slice(0, 10);
    const notes = rel.releaseNotesSummary
      ? `   ${rel.releaseNotesSummary.slice(0, 60)}`
      : "";
    lines.push(`  ${rel.tag.padEnd(12)} ${date}${notes}`);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// alp sdk install <version>
// ---------------------------------------------------------------------------

async function runSdkInstall(
  version: string | undefined,
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): Promise<CliExecutionResult<SdkInstallData>> {
  if (!version) {
    return createFailureResult(
      "sdk",
      flags.format,
      CLI_EXIT_CODE.runtimeFailure,
      [
        "sdk install: version argument is required.",
        "Usage: alp sdk install <version>",
      ],
      [
        {
          code: "sdk.missing-version",
          severity: "error",
          message: "Version argument is required.",
        },
      ],
      {
        subcommand: "install",
        version: "",
        sdkPath: "",
        readiness: emptyReadiness(""),
      },
    );
  }

  if (!input.sdkInstall) {
    return createFailureResult(
      "sdk",
      flags.format,
      CLI_EXIT_CODE.internalFailure,
      ["sdk install: install adapter not available."],
      [
        {
          code: "sdk.no-install-adapter",
          severity: "error",
          message: "Install adapter not wired.",
        },
      ],
      {
        subcommand: "install",
        version,
        sdkPath: "",
        readiness: emptyReadiness(""),
      },
    );
  }

  const cacheRoot = flags.destination ?? defaultCacheRoot();
  const destPath = path.join(cacheRoot, version);

  const readFile =
    input.readFile ??
    (() => {
      throw new Error("readFile not available");
    });

  let readiness;
  try {
    readiness = await installSdkRelease(
      version,
      cacheRoot,
      input.sdkInstall,
      input.pathExists,
      readFile,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createFailureResult(
      "sdk",
      flags.format,
      CLI_EXIT_CODE.runtimeFailure,
      [`sdk install: installation failed.`, message],
      [{ code: "sdk.install-failed", severity: "error", message }],
      {
        subcommand: "install",
        version,
        sdkPath: destPath,
        readiness: emptyReadiness(destPath),
      },
    );
  }

  const data: SdkInstallData = {
    subcommand: "install",
    version,
    sdkPath: destPath,
    readiness,
  };
  const textLines = formatReadinessBlock(`SDK ${version} installed`, readiness);

  return {
    format: flags.format,
    exitCode:
      readiness.state === "missing"
        ? CLI_EXIT_CODE.runtimeFailure
        : CLI_EXIT_CODE.success,
    textLines: flags.format === "json" ? [] : textLines,
    envelope: createEnvelope(
      "sdk",
      { root: null, boardYaml: null },
      data,
      [],
      CLI_EXIT_CODE.success,
    ),
  };
}

// ---------------------------------------------------------------------------
// alp sdk current
// ---------------------------------------------------------------------------

async function runSdkCurrent(
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): Promise<CliExecutionResult<SdkCurrentData>> {
  const readFile =
    input.readFile ??
    (() => {
      throw new Error("readFile not available");
    });

  const sdkPath = resolveActiveSdk(input.cwd, input.pathExists, readFile);

  let readiness: SdkCurrentData["readiness"] = null;
  if (sdkPath) {
    readiness = checkSdkReadiness(sdkPath, input.pathExists, readFile);
  }

  const data: SdkCurrentData = { subcommand: "current", sdkPath, readiness };

  const textLines: string[] = sdkPath
    ? formatReadinessBlock("Active SDK", readiness!)
    : [
        "No active SDK configured for this workspace.",
        "Run 'alp sdk install <version>' to get started.",
      ];

  return {
    format: flags.format,
    exitCode: CLI_EXIT_CODE.success,
    textLines: flags.format === "json" ? [] : textLines,
    envelope: createEnvelope(
      "sdk",
      { root: null, boardYaml: null },
      data,
      [],
      CLI_EXIT_CODE.success,
    ),
  };
}

// ---------------------------------------------------------------------------
// alp sdk switch <version>
// ---------------------------------------------------------------------------

async function runSdkSwitch(
  versionOrPath: string | undefined,
  flags: CliGlobalFlags,
  input: Omit<CliExecutionInput, "argv">,
): Promise<CliExecutionResult<SdkSwitchData>> {
  if (!versionOrPath) {
    return createFailureResult(
      "sdk",
      flags.format,
      CLI_EXIT_CODE.runtimeFailure,
      [
        "sdk switch: version or path argument is required.",
        "Usage: alp sdk switch <version|path>",
      ],
      [
        {
          code: "sdk.missing-version",
          severity: "error",
          message: "Version or path argument is required.",
        },
      ],
      { subcommand: "switch", sdkPath: "", version: null },
    );
  }

  if (!input.writeFile || !input.mkdirP) {
    return createFailureResult(
      "sdk",
      flags.format,
      CLI_EXIT_CODE.internalFailure,
      ["sdk switch: filesystem write adapters not available."],
      [
        {
          code: "sdk.no-write-adapter",
          severity: "error",
          message: "Write adapters not wired.",
        },
      ],
      { subcommand: "switch", sdkPath: "", version: null },
    );
  }

  // Resolve the SDK path: absolute path or version tag → cache dir.
  const sdkPath = path.isAbsolute(versionOrPath)
    ? versionOrPath
    : (flags.sdkRoot ?? path.join(defaultCacheRoot(), versionOrPath));

  if (!input.pathExists(sdkPath)) {
    return createFailureResult(
      "sdk",
      flags.format,
      CLI_EXIT_CODE.runtimeFailure,
      [
        `sdk switch: SDK path does not exist: ${sdkPath}`,
        "Run 'alp sdk install <version>' first.",
      ],
      [
        {
          code: "sdk.path-not-found",
          severity: "error",
          message: `SDK path not found: ${sdkPath}`,
        },
      ],
      { subcommand: "switch", sdkPath, version: null },
    );
  }

  try {
    switchActiveSdk(input.cwd, sdkPath, input.writeFile, input.mkdirP);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createFailureResult(
      "sdk",
      flags.format,
      CLI_EXIT_CODE.runtimeFailure,
      [`sdk switch: failed to update active SDK pointer.`, message],
      [{ code: "sdk.switch-failed", severity: "error", message }],
      { subcommand: "switch", sdkPath, version: null },
    );
  }

  // Read version from the switched SDK for display.
  const readFile =
    input.readFile ??
    (() => {
      throw new Error("readFile not available");
    });
  const readiness = checkSdkReadiness(sdkPath, input.pathExists, readFile);
  const data: SdkSwitchData = {
    subcommand: "switch",
    sdkPath,
    version: readiness.version,
  };

  const textLines = [
    `Switched active SDK to ${readiness.version ?? sdkPath}.`,
    `  path    ${sdkPath}`,
    `  state   ${readiness.state}`,
  ];

  return {
    format: flags.format,
    exitCode: CLI_EXIT_CODE.success,
    textLines: flags.format === "json" ? [] : textLines,
    envelope: createEnvelope(
      "sdk",
      { root: null, boardYaml: null },
      data,
      [],
      CLI_EXIT_CODE.success,
    ),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatReadinessBlock(
  header: string,
  report: ReturnType<typeof checkSdkReadiness>,
): string[] {
  const lines = [
    header,
    `  path    ${report.sdkPath}`,
    `  version ${report.version ?? "(unknown)"}`,
    `  state   ${report.state}`,
  ];
  if (report.issues.length > 0) {
    lines.push("  issues:");
    for (const issue of report.issues) {
      lines.push(`    - ${issue}`);
    }
  }
  return lines;
}

function emptyReadiness(sdkPath: string): ReturnType<typeof checkSdkReadiness> {
  return {
    sdkPath,
    version: null,
    loaderScriptPresent: false,
    metadataPresent: false,
    state: "missing",
    issues: [],
  };
}
