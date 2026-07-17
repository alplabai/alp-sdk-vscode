// SPDX-License-Identifier: Apache-2.0

/**
 * Injectable adapter interfaces for the SDK management service.
 *
 * The service layer never imports concrete I/O implementations; callers
 * (CLI entry points, VS Code adapters) pass these as function parameters.
 * This keeps every service function unit-testable without network or disk
 * access.
 *
 * Dependency direction rule:
 *   surface -> adapter -> service -> models   (allowed)
 *   service -> adapter                        (forbidden)
 */

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * Fetch a URL and return the parsed JSON body.
 * The caller is responsible for setting appropriate headers (Accept, UA).
 *
 * Node concrete: use `https.get` with JSON.parse.
 * Test double:   return a pre-built object.
 */
export type SdkHttpFetch = (
  url: string,
  headers?: Record<string, string>,
) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Filesystem (sync — matches existing project/service.ts style)
// ---------------------------------------------------------------------------

/** Check whether a path exists on the filesystem. */
export type PathExists = (filePath: string) => boolean;

/** Read the full text content of a file. Throws if file does not exist. */
export type ReadFile = (filePath: string) => string;

/**
 * Write text content to a file.
 * The caller must ensure parent directories exist or the adapter must
 * create them.
 */
export type WriteFile = (filePath: string, content: string) => void;

/** Create a directory and all missing ancestors (equivalent to `mkdir -p`). */
export type MkdirP = (dirPath: string) => void;

/** List the names (not full paths) of entries in a directory. */
export type Readdir = (dirPath: string) => string[];
