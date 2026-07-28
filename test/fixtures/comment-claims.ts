// SPDX-License-Identifier: Apache-2.0
//
// Compile-refusal fixture for test/comment-claims.guard.test.js.
//
// NOT part of the build: `tsconfig.json` includes only `src/**/*`, so neither
// `pnpm run compile` nor `pnpm run typecheck` sees this file. The guard test
// compiles it on demand through `comment-claims.tsconfig.json`, which EXTENDS
// the repo's real compilerOptions — so a code asserted here is a code the
// shipped build would emit, not one from a hand-tuned corner.
//
// Every `@expect` marker below is a claim some doc comment in `src/` makes
// about what the compiler does with the `verify` argument. `@expect none`
// means the line must COMPILE: those lines are the holes the same comments
// name, and a hole that quietly closes is drift too — the comment would then
// be under-claiming and the reviewer who trusts it writes a weaker test.
//
// The test attributes each diagnostic to the nearest preceding marker, so a
// statement may wrap across lines; the marker sits on its own line above it.

import { downloadFile } from "../../src/alpCli/download";
import type { ProxyConfig } from "../../src/alpCli/download";
import type { ResolveDeps } from "../../src/alpCli/adapterCore";
import type { ChecksumSpec } from "../../src/alpCli/models";

declare const url: string;
declare const dest: string;
declare const signal: AbortSignal;
declare const spec: ChecksumSpec;
declare const proxySettings: () => ProxyConfig;
declare const deps: ResolveDeps;

// src/alpCli/download.ts, on `downloadFile`'s `verify`:
//   "Omitting the argument is a `TS2554`"
// @expect TS2554
void downloadFile(url, dest);

// src/alpCli/download.ts (`downloadSeam`) and src/alpCli/vscodeAdapter.ts
// (`buildResolveDeps`), on the shape the omission used to take — an
// AbortSignal slid into the `verify` position:
//   "downloadFile(url, dest, signal, proxySettings())" does not compile
// @expect TS2739
void downloadFile(url, dest, signal, proxySettings());

// src/alpCli/download.ts and src/alpCli/vscodeAdapter.ts, on the hole the
// signature CANNOT close:
//   "`null` is the explicit opt-out" / "an arrow that says `null` … compiles,
//   and ships unverified bytes to `cachedBinaryPath`"
// Pinned as compiling on purpose: the moment this reds, both comments are
// over-claiming and test/alpCli.downloadSeamWiring.test.js is redundant.
// @expect none
void downloadFile(url, dest, null, { signal });

// The intended production call, for contrast: a real spec verifies.
// @expect none
void downloadFile(url, dest, spec, { signal });

// src/alpCli/adapterCore.ts, on `ResolveDeps.download`'s required `verify`:
//   "omitting the argument in `downloadCli` is a `TS2554`"
// @expect TS2554
void deps.download(url, dest, signal);

// src/alpCli/adapterCore.ts and src/alpCli/download.ts, on the other half:
//   "It does NOT constrain the PROVIDER: TypeScript's arity-tolerant function
//   assignability accepts a 3-parameter implementation for a 4-parameter type"
// Also pinned as compiling: this is why "the compiler refuses" was only ever
// half true, and why the provider is covered behaviourally instead.
// @expect none
export const threeParameterProvider: ResolveDeps["download"] = async (
  _url: string,
  _destFile: string,
  _signal: AbortSignal | undefined,
) => {};
