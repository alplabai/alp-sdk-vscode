// SPDX-License-Identifier: Apache-2.0

export type BootstrapHost = "linux" | "darwin" | "win32";
export type BootstrapOs = "zephyr" | "yocto" | "baremetal";
export type ToolchainFixId =
  | "python-deps"
  | "west"
  // west inside the WORKSPACE VENV (tan's `westResolved` check), which only a
  // bootstrap creates. Distinct from `west` because that one installs globally
  // with `pip --user` on win32, and a global west never satisfies this check.
  | "west-workspace"
  | "build-tools"
  | "zephyr-sdk"
  | "gdb";

export interface BootstrapStep {
  description: string;
  command: string;
}
export interface BootstrapPointer {
  name: string;
  url: string;
  /**
   * What still has to happen AFTER the page opens, when the page alone does not
   * finish the job. Optional: most pointers are self-contained.
   *
   * Shown to the customer (the dependency row's button tooltip). Deliberately
   * prose, not a `BootstrapStep`: a step is something this extension offers to
   * RUN, and none of these can be run from here.
   */
  note?: string;
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

/**
 * The Zephyr SDK pointer plus the two facts the docs page does not put in front
 * of a customer who got here from the dependency table, both mirrored from the
 * producer's own manual-install hint (alp-sdk `metadata/bootstrap.json`
 * `manualInstallHints.windows.note`, which tan renders only in
 * `tan bootstrap`'s text output — nothing this extension ever shows):
 *
 *  1. `west sdk install` needs an INITIALISED west workspace and must run from
 *     its top-level directory. Run anywhere else it fails with west's own
 *     "not in a west installation", which reads like a broken button.
 *  2. On native Windows a 7-Zip binary must ALREADY be on PATH: west delegates
 *     `.7z` extraction to `patoolib`, which shells out to an external
 *     `7z`/`7za`/`7zr`/`7zz`/`7zzs`/`unar` and has no pure-Python fallback.
 *
 * Deliberately carries NO `--version`: this repo tracks tan's version
 * (`SUPPORTED_CLI_VERSION`), not the Zephyr SDK's, so a pin written here would
 * be a number nothing keeps true. `-t arm-zephyr-eabi` is stable — every Alp
 * SoM family (Alif / Renesas / NXP) is Arm — and without it west fetches every
 * toolchain there is.
 */
function zephyrSdkPointer(host: BootstrapHost): BootstrapPointer {
  const runIt =
    "Then run `west sdk install -t arm-zephyr-eabi` from your west " +
    "workspace's top-level directory";
  return {
    ...ZEPHYR_SDK_INSTALLER,
    note:
      host === "win32"
        ? `${runIt} — on native Windows a 7-Zip binary (7z / 7za / 7zr / 7zz / 7zzs / unar) must be on PATH first, or the extraction step fails`
        : `${runIt}`,
  };
}

function pythonDepsStep(host: BootstrapHost): BootstrapStep {
  return host === "win32"
    ? {
        description: "Install loader Python deps (pip)",
        command: "python -m pip install --user pyyaml jsonschema",
      }
    : {
        description: "Install loader Python deps (pip3)",
        command: "pip3 install --user pyyaml jsonschema",
      };
}

function westStep(host: BootstrapHost): BootstrapStep {
  return host === "win32"
    ? {
        description: "Install `west`",
        command: "python -m pip install --user west",
      }
    : { description: "Install `west`", command: "pip3 install --user west" };
}

export function planForHost(
  host: BootstrapHost,
  os: BootstrapOs,
): BootstrapPlan {
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
        : {
            description:
              "Yocto host build is Linux-only.  Use a VM / Docker container.",
            command: "echo 'See pointers below'",
          };
    return {
      title: `Bootstrap Alp SDK (Yocto, ${host})`,
      steps: [pythonDepsStep(host), yoctoStep],
      pointers: [
        {
          name: "Yocto Project quick build",
          url: "https://docs.yoctoproject.org/brief-yoctoprojectqs/index.html",
        },
        {
          name: "Yocto host requirements",
          url: "https://docs.yoctoproject.org/ref-manual/system-requirements.html",
        },
      ],
    };
  }
  return {
    title: `Bootstrap Alp SDK (baremetal, ${host})`,
    steps: [pythonDepsStep(host)],
    pointers: [
      {
        name: "Alif Ensemble dev tools",
        url: "https://alifsemi.com/support/software-development-kit/",
      },
      {
        name: "Renesas RZ/V2N CMSIS-Driver pack",
        url: "https://www.renesas.com/us/en/software-tool/flexible-software-package-fsp",
      },
      {
        name: "NXP MCUXpresso for i.MX 93",
        url: "https://www.nxp.com/design/software/mcuxpresso-software-and-tools/",
      },
    ],
  };
}

/** One platform's install command, for the per-OS install guide menu. */
export interface InstallOption {
  os: BootstrapHost;
  label: string;
  command: string;
}

/** A cross-platform install guide shown as an info menu (no single command). */
export interface InstallGuide {
  title: string;
  docUrl: string;
  options: InstallOption[];
}

/**
 * GDB install guidance. Host GDB is recommended (e.g. for native_sim debugging);
 * embedded targets use the cross GDB shipped with the Zephyr SDK. Install differs
 * per OS — and carries caveats on macOS — so we surface a menu, not one command.
 */
export const GDB_INSTALL_GUIDE: InstallGuide = {
  title: "Install GDB",
  docUrl: "https://docs.zephyrproject.org/latest/develop/debug/index.html",
  options: [
    {
      os: "linux",
      label: "Linux · Debian/Ubuntu (apt)",
      command: "sudo apt-get update && sudo apt-get install -y gdb",
    },
    {
      os: "linux",
      label: "Linux · Fedora/RHEL (dnf)",
      command: "sudo dnf install -y gdb",
    },
    {
      os: "darwin",
      label: "macOS · Homebrew (host gdb; or use the Zephyr SDK's gdb)",
      command: "brew install gdb",
    },
    {
      os: "win32",
      label: "Windows · Scoop",
      command: "scoop install gdb",
    },
    {
      os: "win32",
      label: "Windows · MSYS2",
      command: "pacman -S --needed mingw-w64-x86_64-gdb",
    },
  ],
};

export type FixResult =
  | { kind: "command"; step: BootstrapStep }
  | { kind: "pointer"; pointer: BootstrapPointer }
  | { kind: "guide"; guide: InstallGuide }
  // Delegate to `alp bootstrap` (installs west + Zephyr's Python deps into a
  // venv). Used for python-deps/west on non-win32 hosts, where a global
  // `pip install --user` aborts under PEP 668 (externally-managed-environment).
  | { kind: "bootstrap" };

// A per-tool install hint (tool -> command) for a missing prerequisite
// belongs upstream as structured data — alp-sdk's `metadata/bootstrap.json`
// `prerequisites.install.{windows,posix,macos}`, delivered through the
// envelope's `data`, not parsed from tan's prose message (see alp-sdk
// docs/adr/0021-toolchain-provisioning.md, Lane 1 P0b).

export function fixCommand(
  fixId: ToolchainFixId,
  host: BootstrapHost,
): FixResult {
  switch (fixId) {
    // A global `pip install --user` aborts on PEP 668 hosts (Ubuntu 23.04+/
    // Debian 12+), so route these to `alp bootstrap` (venv install) off win32.
    case "python-deps":
      return host === "win32"
        ? { kind: "command", step: pythonDepsStep(host) }
        : { kind: "bootstrap" };
    case "west":
      return host === "win32"
        ? { kind: "command", step: westStep(host) }
        : { kind: "bootstrap" };
    // The venv west, on EVERY host: `tan bootstrap` is the only thing that
    // creates the workspace venv the `westResolved` check looks in.
    case "west-workspace":
      return { kind: "bootstrap" };
    case "build-tools":
      return { kind: "pointer", pointer: ZEPHYR_GETTING_STARTED };
    case "zephyr-sdk":
      return { kind: "pointer", pointer: zephyrSdkPointer(host) };
    case "gdb":
      return { kind: "guide", guide: GDB_INSTALL_GUIDE };
  }
}
