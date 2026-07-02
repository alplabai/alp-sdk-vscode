const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isSettingsUnsavedChangesError,
} = require("../out/sdk/settingsErrors.js");

test("recognises the user-settings unsaved-changes error", () => {
  const err = new Error(
    "Unable to write into user settings because the file has unsaved changes. " +
      "Please save the user settings file first and then try again.",
  );
  assert.equal(isSettingsUnsavedChangesError(err), true);
});

test("recognises the workspace-settings variant", () => {
  const err = new Error(
    "Unable to write into workspace settings because the file has unsaved " +
      "changes. Please save the workspace settings file first and then try again.",
  );
  assert.equal(isSettingsUnsavedChangesError(err), true);
});

test("recognises the folder-settings variant", () => {
  const err = new Error(
    "Unable to write into folder settings because the file has unsaved changes.",
  );
  assert.equal(isSettingsUnsavedChangesError(err), true);
});

test("accepts a bare string message", () => {
  assert.equal(
    isSettingsUnsavedChangesError(
      "Unable to write into user settings because the file has unsaved changes.",
    ),
    true,
  );
});

test("accepts an error-like object carrying a string message", () => {
  assert.equal(
    isSettingsUnsavedChangesError({
      message:
        "Unable to write into user settings because the file has unsaved changes.",
    }),
    true,
  );
});

test("does NOT match the invalid-file settings error (must not auto-retry)", () => {
  const err = new Error(
    "Unable to write into user settings because the file is invalid. Please " +
      "open the user settings file to correct errors/warnings in it and try again.",
  );
  assert.equal(isSettingsUnsavedChangesError(err), false);
});

test("does NOT match unrelated or empty errors", () => {
  assert.equal(
    isSettingsUnsavedChangesError(new Error("ENOENT: no such file")),
    false,
  );
  assert.equal(isSettingsUnsavedChangesError(undefined), false);
  assert.equal(isSettingsUnsavedChangesError(null), false);
  assert.equal(isSettingsUnsavedChangesError(42), false);
  assert.equal(isSettingsUnsavedChangesError({}), false);
});
