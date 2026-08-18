// SPDX-License-Identifier: Apache-2.0
// SoM module catalog for the New Project "Hardware" step. Project scaffolding
// itself is delegated to the CLI (`alp init`); only this hardware list is local.

import type { E1mModule } from "./messages";

// ---------------------------------------------------------------------------
// Static catalog (mirrors alp-sdk-upstream/metadata/e1m_modules/*.yaml).
// `test/ideHub.projectScaffold.test.js` asserts SET-EQUALITY of ids + per-entry
// `family` against those YAMLs — a SKU dropped here is a wrong-silicon scaffold
// on the first-run path (no SDK resolved), so keep them in lockstep.
// PURE DATA: no runtime imports. `src/lsp/service.ts` (bundled into the LSP
// server) imports this list, so adding a `vscode`/`fs` import here breaks that
// bundle.
// ---------------------------------------------------------------------------

export const E1M_MODULES: E1mModule[] = [
  {
    id: "E1M-AEN801",
    displayName: "E1M-AEN801 (Alif Ensemble E8)",
    family: "alif-ensemble",
  },
  {
    id: "E1M-AEN301",
    displayName: "E1M-AEN301 (Alif Ensemble E3)",
    family: "alif-ensemble",
  },
  {
    id: "E1M-AEN401",
    displayName: "E1M-AEN401 (Alif Ensemble E4)",
    family: "alif-ensemble",
  },
  {
    id: "E1M-AEN501",
    displayName: "E1M-AEN501 (Alif Ensemble E5)",
    family: "alif-ensemble",
  },
  {
    id: "E1M-AEN601",
    displayName: "E1M-AEN601 (Alif Ensemble E6)",
    family: "alif-ensemble",
  },
  {
    id: "E1M-AEN701",
    displayName: "E1M-AEN701 (Alif Ensemble E7)",
    family: "alif-ensemble",
  },
  {
    id: "E1M-V2N101",
    displayName: "E1M-V2N101 (Renesas RZ/V2N)",
    family: "renesas-rzv2n",
  },
  {
    id: "E1M-V2N102",
    displayName: "E1M-V2N102 (Renesas RZ/V2N, larger memory)",
    family: "renesas-rzv2n",
  },
  {
    id: "E1M-V2M101",
    displayName: "E1M-V2M101 (Renesas RZ/V2N + DEEPX DX-M1)",
    family: "renesas-rzv2n-deepx",
  },
  {
    id: "E1M-V2M102",
    displayName: "E1M-V2M102 (Renesas RZ/V2N + DEEPX DX-M1, larger memory)",
    family: "renesas-rzv2n-deepx",
  },
  {
    id: "E1M-NX9101",
    displayName: "E1M-NX9101 (NXP i.MX 93)",
    family: "nxp-imx9",
  },
];
