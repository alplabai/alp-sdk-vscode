// SPDX-License-Identifier: Apache-2.0

import { ToolchainFixId } from "./bootstrapPlan";

export interface ToolProbe {
  present: boolean;
  detail?: string;
}

export interface ToolchainInputs {
  tools: Record<string, ToolProbe>;
  pythonDeps: Record<string, boolean>;
  env: { zephyrSdkDir?: string; zephyrBase?: string };
  sdkConnected: boolean;
}

export type DoctorCheckStatus = "ok" | "missing" | "warn";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorCheckStatus;
  detail: string;
  required: boolean;
  fixId?: ToolchainFixId;
}

export interface ToolchainReport {
  checks: DoctorCheck[];
  ok: boolean;
  missingRequired: number;
}

function toolCheck(
  inputs: ToolchainInputs,
  id: string,
  label: string,
  required: boolean,
  fixId?: ToolchainFixId,
): DoctorCheck {
  const probe = inputs.tools[id];
  const present = Boolean(probe?.present);
  return {
    id,
    label,
    required,
    status: present ? "ok" : required ? "missing" : "warn",
    detail: present
      ? (probe?.detail ?? "found")
      : required
        ? "not found on PATH"
        : "not found (recommended)",
    fixId: present ? undefined : fixId,
  };
}

export function analyzeToolchain(inputs: ToolchainInputs): ToolchainReport {
  const checks: DoctorCheck[] = [];

  checks.push(toolCheck(inputs, "python", "Python", true));

  const missingDeps = Object.entries(inputs.pythonDeps)
    .filter(([, ok]) => !ok)
    .map(([name]) => name);
  checks.push({
    id: "python-deps",
    label: "Python deps (pyyaml, jsonschema)",
    required: true,
    status: missingDeps.length === 0 ? "ok" : "missing",
    detail:
      missingDeps.length === 0
        ? "importable"
        : `missing: ${missingDeps.join(", ")}`,
    fixId: missingDeps.length === 0 ? undefined : "python-deps",
  });

  checks.push(toolCheck(inputs, "west", "west", true, "west"));
  checks.push(toolCheck(inputs, "cmake", "CMake", true, "build-tools"));
  checks.push(toolCheck(inputs, "ninja", "Ninja", true, "build-tools"));
  checks.push(
    toolCheck(inputs, "dtc", "Device Tree Compiler (dtc)", true, "build-tools"),
  );
  checks.push(toolCheck(inputs, "gdb", "GDB", false, "gdb"));

  checks.push({
    id: "zephyr-sdk",
    label: "Zephyr SDK",
    required: true,
    status: inputs.env.zephyrSdkDir ? "ok" : "missing",
    detail: inputs.env.zephyrSdkDir ?? "ZEPHYR_SDK_INSTALL_DIR not set",
    fixId: inputs.env.zephyrSdkDir ? undefined : "zephyr-sdk",
  });
  checks.push({
    id: "zephyr-base",
    label: "ZEPHYR_BASE",
    required: false,
    status: inputs.env.zephyrBase ? "ok" : "warn",
    detail: inputs.env.zephyrBase ?? "not set (recommended)",
  });

  checks.push(toolCheck(inputs, "tan", "tan CLI", false));
  checks.push({
    id: "sdk-connected",
    label: "Alp SDK connected",
    required: false,
    status: inputs.sdkConnected ? "ok" : "warn",
    detail: inputs.sdkConnected
      ? "alpSdk.path resolves"
      : "run Alp: Connect SDK",
  });

  const missingRequired = checks.filter(
    (c) => c.required && c.status === "missing",
  ).length;
  return { checks, ok: missingRequired === 0, missingRequired };
}
