// SPDX-License-Identifier: Apache-2.0
//
// Downloads the platform-specific `alp` binary from the GitHub release that
// matches this package's version (tag `cli-rs-v<version>`) and unpacks it into
// ./binary. Runs as the package's `postinstall` step.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const pkg = require("./package.json");

const REPO = "alplabai/alp-sdk-vscode";
const TAG = `cli-rs-v${pkg.version}`;
const BINARY_DIR = path.join(__dirname, "binary");

/** Map the host platform/arch to the release target triple. */
function resolveTarget() {
  const key = `${process.platform}/${process.arch}`;
  // Note: darwin/x64 (Intel mac) has no prebuilt archive — GitHub's Intel
  // macOS runners stall the release build. Intel-mac users build from source:
  // `cargo build --release --manifest-path cli-rs/Cargo.toml`.
  const targets = {
    "linux/x64": "x86_64-unknown-linux-gnu",
    "linux/arm64": "aarch64-unknown-linux-musl", // static — runs on glibc hosts too
    "darwin/arm64": "aarch64-apple-darwin",
    "win32/x64": "x86_64-pc-windows-msvc",
  };
  const target = targets[key];
  if (!target) {
    throw new Error(
      `alp-sdk: no prebuilt binary for ${key}. Supported: ${Object.keys(targets).join(", ")}. ` +
        `Build from source: cargo build --release --manifest-path cli-rs/Cargo.toml`,
    );
  }
  return target;
}

async function main() {
  const target = resolveTarget();
  const asset = `alp-${target}.tar.gz`;
  const url = `https://github.com/${REPO}/releases/download/${TAG}/${asset}`;

  fs.mkdirSync(BINARY_DIR, { recursive: true });
  const archivePath = path.join(BINARY_DIR, asset);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `alp-sdk: failed to download ${asset} (HTTP ${response.status}) from ${url}`,
    );
  }
  fs.writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));

  // `tar` ships on Linux, macOS, and Windows 10+ (bsdtar) and reads .tar.gz.
  execFileSync("tar", ["-xzf", archivePath, "-C", BINARY_DIR], {
    stdio: "inherit",
  });
  fs.rmSync(archivePath, { force: true });

  const binName = process.platform === "win32" ? "alp.exe" : "alp";
  const binPath = path.join(BINARY_DIR, binName);
  if (!fs.existsSync(binPath)) {
    throw new Error(`alp-sdk: ${binName} missing after extracting ${asset}.`);
  }
  if (process.platform !== "win32") {
    fs.chmodSync(binPath, 0o755);
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
