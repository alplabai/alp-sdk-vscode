// Single source of truth for the alp-sdk tag both vendored schemas are pinned to.
// The board and system-manifest schema copies MUST be vendored from the SAME tag;
// the two *.vendored.test.js drift gates import their sha256 (and the tag) from
// here, so the two copies can never green while disagreeing on tag. Bumping =
// re-vendor BOTH schemas from the new tag, then update VENDORED_SDK_TAG and both
// hashes below in this one place.
module.exports = {
  VENDORED_SDK_TAG: "v0.11.0",
  BOARD_SCHEMA_SHA256:
    "d9393ab0d1c3df5550a84acc30639eddabb90ce35a080d7a6ec122cac999b3b8",
  SYSTEM_MANIFEST_SCHEMA_SHA256:
    "0a7ce1393c530303e5a56939b7b2ffcaf4d9711873b3f7f62c25be7025563048",
};
