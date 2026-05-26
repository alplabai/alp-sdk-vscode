// SPDX-License-Identifier: Apache-2.0

import * as path from "path";

/**
 * Relative marker that identifies an Alp SDK checkout. Must match the marker
 * used by resolveSdkRoot() in ../project/service.ts — that resolver is the gate
 * that turns a configured alpSdk.path into a live sdkRoot, so detecting on a
 * different marker could "connect" to a path the resolver then rejects.
 */
export const SDK_MARKER = path.join("scripts", "alp_project.py");

/**
 * Ordered list of absolute paths to probe for an SDK checkout. The first that
 * passes isSdkRoot() wins. De-duplicated, order preserved.
 */
export function candidateSdkPaths(
  workspaceRoot: string | null,
  homeDir: string,
): string[] {
  const out: string[] = [];
  if (workspaceRoot) {
    out.push(workspaceRoot);
    const parent = path.resolve(workspaceRoot, "..");
    out.push(path.join(parent, "alp-sdk"));
    out.push(path.join(parent, "alp_sdk"));
  }
  out.push(path.join(homeDir, "Documents", "GitHub", "alp-sdk"));
  out.push(path.join(homeDir, "GitHub", "alp-sdk"));
  out.push(path.join(homeDir, "src", "alp-sdk"));
  return [...new Set(out)];
}

/** True when `root` contains the SDK marker file. */
export function isSdkRoot(
  root: string,
  pathExists: (candidate: string) => boolean,
): boolean {
  return pathExists(path.join(root, SDK_MARKER));
}

/** Filters `candidates` down to those that are valid SDK roots, in order. */
export function detectSdkRoots(
  candidates: string[],
  pathExists: (candidate: string) => boolean,
): string[] {
  return candidates.filter((root) => isSdkRoot(root, pathExists));
}
