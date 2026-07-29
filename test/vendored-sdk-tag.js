// Single source of truth for the alp-sdk tag both vendored schemas are pinned to.
// The board and system-manifest schema copies MUST be vendored from the SAME tag;
// the two *.vendored.test.js drift gates import their sha256 (and the tag) from
// here, so the two copies can never green while disagreeing on tag. Bumping =
// re-vendor BOTH schemas from the new tag, then update VENDORED_SDK_TAG and both
// hashes below in this one place.
module.exports = {
  VENDORED_SDK_TAG: "v0.14.0",
  // board.schema.json moves for real at this bump: the `peripherals` enum
  // gains `dac` and `i3c` (18 entries, was 16).
  BOARD_SCHEMA_SHA256:
    "0cc502abbaf52a7d5a56836392423371c23faf4f1fb68137987f93d138afe0cd",
  // Unchanged from v0.11.0 -- system-manifest-v1.schema.json is byte-identical
  // at v0.13.0 and v0.14.0, so this bump moves the label, not the file.
  SYSTEM_MANIFEST_SCHEMA_SHA256:
    "ea7383b56c69faa94679e311a6b8be5e99513a462ffaaafa778d281b1967aba6",
};
