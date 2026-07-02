const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isSettingsFilePath,
  selectSettingsFilesToSave,
} = require("../out/sdk/settingsFiles.js");

const USER = "/Users/x/Library/Application Support/Code/User/settings.json";
const FOLDER = "/work/proj/.vscode/settings.json";
const WORKSPACE = "/work/proj/proj.code-workspace";
const NOT_SETTINGS = "/work/proj/src/index.ts";

test("isSettingsFilePath matches settings.json and .code-workspace only", () => {
  assert.equal(isSettingsFilePath(USER), true);
  assert.equal(isSettingsFilePath(FOLDER), true);
  assert.equal(isSettingsFilePath(WORKSPACE), true);
  assert.equal(isSettingsFilePath(NOT_SETTINGS), false);
});

test("folder scope prefers .vscode/settings.json, excludes the user file", () => {
  const chosen = selectSettingsFilesToSave([USER, FOLDER, NOT_SETTINGS], true);
  assert.deepEqual(chosen, [FOLDER]);
});

test("folder scope also accepts a .code-workspace file", () => {
  const chosen = selectSettingsFilesToSave([USER, WORKSPACE], true);
  assert.deepEqual(chosen, [WORKSPACE]);
});

test("user (global) scope picks the bare settings.json, not folder/workspace files", () => {
  const chosen = selectSettingsFilesToSave([USER, FOLDER, WORKSPACE], false);
  assert.deepEqual(chosen, [USER]);
});

test("falls back to every dirty settings file when none match the scope", () => {
  // Global write, but only a folder-scoped file is dirty → still offer to save
  // it (the offending file must be among the dirty settings files).
  const chosen = selectSettingsFilesToSave([FOLDER, NOT_SETTINGS], false);
  assert.deepEqual(chosen, [FOLDER]);
});

test("returns empty when no dirty settings files are present", () => {
  assert.deepEqual(selectSettingsFilesToSave([NOT_SETTINGS], true), []);
  assert.deepEqual(selectSettingsFilesToSave([], false), []);
});

test("non-settings dirty files are never selected", () => {
  const chosen = selectSettingsFilesToSave(
    [NOT_SETTINGS, "/tmp/notes.md", USER],
    false,
  );
  assert.deepEqual(chosen, [USER]);
});
