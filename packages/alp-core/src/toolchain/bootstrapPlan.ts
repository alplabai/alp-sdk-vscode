// SPDX-License-Identifier: Apache-2.0

export type BootstrapHost = "linux" | "darwin" | "win32";
export type BootstrapOs = "zephyr" | "yocto" | "baremetal";
export type ToolchainFixId = "python-deps" | "west" | "build-tools" | "zephyr-sdk";

export interface BootstrapStep {
  description: string;
  command: string;
}
export interface BootstrapPointer {
  name: string;
  url: string;
}
export interface BootstrapPlan {
  title: string;
  steps: BootstrapStep[];
  pointers: BootstrapPointer[];
}

const ZEPHYR_GETTING_STARTED: BootstrapPointer = {
  name: "Zephyr getting started guide",
  url: "https://docs.zephyrproject.org/latest/develop/getting_started/index.html",
};
const ZEPHYR_SDK_INSTALLER: BootstrapPointer = {
  name: "Zephyr SDK installer",
  url: "https://docs.zephyrproject.org/latest/develop/toolchains/zephyr_sdk.html",
};

function pythonDepsStep(host: BootstrapHost): BootstrapStep {
  return host === "win32"
    ? { description: "Install loader Python deps (pip)", command: "python -m pip install --user pyyaml jsonschema" }
    : { description: "Install loader Python deps (pip3)", command: "pip3 install --user pyyaml jsonschema" };
}

function westStep(host: BootstrapHost): BootstrapStep {
  return host === "win32"
    ? { description: "Install `west`", command: "python -m pip install --user west" }
    : { description: "Install `west`", command: "pip3 install --user west" };
}

export function planForHost(host: BootstrapHost, os: BootstrapOs): BootstrapPlan {
  if (os === "zephyr") {
    return {
      title: `Bootstrap Alp SDK (Zephyr, ${host})`,
      steps: [pythonDepsStep(host), westStep(host)],
      pointers: [ZEPHYR_SDK_INSTALLER, ZEPHYR_GETTING_STARTED],
    };
  }
  if (os === "yocto") {
    const yoctoStep: BootstrapStep =
      host === "linux"
        ? {
            description: "Install Yocto host packages (Ubuntu / Debian apt)",
            command:
              "sudo apt-get update && sudo apt-get install -y " +
              "gawk wget git diffstat unzip texinfo gcc build-essential " +
              "chrpath socat cpio python3 python3-pip python3-pexpect " +
              "xz-utils debianutils iputils-ping python3-git python3-jinja2 " +
              "libegl1-mesa libsdl1.2-dev pylint xterm python3-subunit " +
              "mesa-common-dev zstd liblz4-tool file locales",
          }
        : { description: "Yocto host build is Linux-only.  Use a VM / Docker container.", command: "echo 'See pointers below'" };
    return {
      title: `Bootstrap Alp SDK (Yocto, ${host})`,
      steps: [pythonDepsStep(host), yoctoStep],
      pointers: [
        { name: "Yocto Project quick build", url: "https://docs.yoctoproject.org/brief-yoctoprojectqs/index.html" },
        { name: "Yocto host requirements", url: "https://docs.yoctoproject.org/ref-manual/system-requirements.html" },
      ],
    };
  }
  return {
    title: `Bootstrap Alp SDK (baremetal, ${host})`,
    steps: [pythonDepsStep(host)],
    pointers: [
      { name: "Alif Ensemble dev tools", url: "https://alifsemi.com/support/software-development-kit/" },
      { name: "Renesas RZ/V2N CMSIS-Driver pack", url: "https://www.renesas.com/us/en/software-tool/flexible-software-package-fsp" },
      { name: "NXP MCUXpresso for i.MX 93", url: "https://www.nxp.com/design/software/mcuxpresso-software-and-tools/" },
    ],
  };
}

export type FixResult =
  | { kind: "command"; step: BootstrapStep }
  | { kind: "pointer"; pointer: BootstrapPointer };

export function fixCommand(fixId: ToolchainFixId, host: BootstrapHost): FixResult {
  switch (fixId) {
    case "python-deps":
      return { kind: "command", step: pythonDepsStep(host) };
    case "west":
      return { kind: "command", step: westStep(host) };
    case "build-tools":
      return { kind: "pointer", pointer: ZEPHYR_GETTING_STARTED };
    case "zephyr-sdk":
      return { kind: "pointer", pointer: ZEPHYR_SDK_INSTALLER };
  }
}
