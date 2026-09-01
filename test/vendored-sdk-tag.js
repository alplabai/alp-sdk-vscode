// Single source of truth for the alp-sdk tag both vendored schemas are pinned
// to. The constants themselves now live in
// `packages/alp-core/src/validation/vendoredSchemas.ts`, together with the
// long-form notes on what each bump changed -- read them there.
//
// They moved out of this file because the EXTENSION needs them at runtime: a
// customer's resolved SDK ships its own copies at `<sdkRoot>/metadata/schemas/`,
// and the editor has to be able to say which schema it is actually validating
// against (#493). This module stays as the drift gates' import point so both
// `*.vendored.test.js` gates keep reading one source and the two vendored
// copies can never green while disagreeing on tag.
//
// To bump: re-vendor BOTH schemas from the new tag, then edit
// `vendoredSchemas.ts` -- not this file. `README.md` carries the procedure.
const {
  VENDORED_SDK_TAG,
  BOARD_SCHEMA_SHA256,
  SYSTEM_MANIFEST_SCHEMA_SHA256,
} = require("@alp-sdk/core/validation/vendoredSchemas");

module.exports = {
  VENDORED_SDK_TAG,
  BOARD_SCHEMA_SHA256,
  SYSTEM_MANIFEST_SCHEMA_SHA256,
};
