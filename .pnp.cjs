#!/usr/bin/env node
/* eslint-disable */
"use strict";

// ---------------------------------------------------------------------------
// Workspace-level Yarn PnP shadow stub.
//
// ~/.pnp.cjs is an orphaned Yarn PnP manifest that intercepts esbuild's
// module resolution when bundling from any sub-directory of $HOME.
// By placing this file at the workspace root, esbuild finds it first
// (directory walk-up stops here before reaching $HOME) and uses the
// registry below instead of the home-level one.
//
// RAW_RUNTIME_STATE carries enableTopLevelFallback:true with an empty
// registry, so every module esbuild asks about falls back immediately
// to standard node_modules resolution.
// ---------------------------------------------------------------------------

const RAW_RUNTIME_STATE =
  '{\
  "enableTopLevelFallback": true,\
  "ignorePatternData": null,\
  "fallbackExclusionList": [],\
  "fallbackPool": [],\
  "packageRegistryData": [\
    [null, [\
      [null, {\
        "packageLocation": "./",\
        "packageDependencies": [],\
        "linkType": "SOFT"\
      }]\
    ]]\
  ]\
}';

// Provide the minimal PnP API surface that esbuild and other tooling may call.
exports.VERSIONS = { std: 3 };
exports.setup = () => {};
exports.getPackageInformation = () => null;
exports.resolveRequest = () => null;
exports.resolveVirtual = () => null;
exports.resolveUnqualified = () => null;
exports.getAllLocators = () => [];
