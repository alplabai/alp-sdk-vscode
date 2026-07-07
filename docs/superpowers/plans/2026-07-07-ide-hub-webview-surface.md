# IDE Hub Webview Surface Plan

Issue: #75

## Goal

Decide whether the React IDE Hub becomes the primary ALP activity-bar surface or
is explicitly gated as experimental until it has a complete extension-host
controller.

The shipped extension should not include a polished-looking webview that cannot
receive state or execute its advertised actions.

## Current Gaps

- `packages/alp-webview` defines a rich message protocol and UI.
- The extension host does not currently provide an IDE Hub controller that:
  - creates the webview,
  - sends `stateUpdate`,
  - handles SDK manager messages,
  - handles new/existing project flow messages.
- The webview references command IDs that are not registered today, such as
  `alp.ideHub.refresh`, `alp.ideHub.focus`, and `alp.openSdkManager`.
- Webview and extension message types are manually mirrored and can drift.

## Decision Point

Choose one:

1. Finish and ship IDE Hub.
2. Gate the webview out of release packaging until it is complete.

The recommended path is to finish and ship it, because it can become the main
product differentiator for an embedded IDE: environment readiness, SDK manager,
workspace setup, build/flash/debug state, and board configuration in one place.

## Proposed PR Slices If Shipping

1. Host controller skeleton
   - Add `src/ideHub/` controller.
   - Register view/webview provider and commands.
   - Serve `packages/alp-webview/dist/main.js` and CSS from allowed roots.
   - Send initial `stateUpdate` when the webview posts `ready`.

2. Shared protocol contract
   - Move message types to a shared package/module or generate webview types
     from extension-owned definitions.
   - Add protocol-version checks on both sides.
   - Add tests for every message type.

3. State model integration
   - Populate SDK, setup, and workspace state from existing adapters:
     `project`, `toolchain`, `sdkCatalogue`, `sdkConnect`, and west context.
   - Refresh on relevant file/settings/workspace changes.

4. Command and action wiring
   - Register/contribute `alp.ideHub.refresh`, `alp.ideHub.focus`,
     `alp.openSdkManager`, and any remaining webview commands.
   - Handle `selectSdkPath`, `switchSdk`, `requestSdkReleases`,
     `requestSdkInstall`, `createNewProject`, and `openExistingProject`.

5. Product hardening
   - Add empty, loading, error, protocol mismatch, and retry states.
   - Add browser/webview smoke tests for initial render and message handshake.
   - Verify VSIX packaging includes only needed built webview assets.

## Proposed PR Slices If Gating

1. Exclude built IDE Hub assets from VSIX packaging.
2. Mark `packages/alp-webview` as experimental in docs.
3. Keep development scripts intact for future work.
4. Open a follow-up implementation epic for shipping the surface.

## Acceptance Criteria If Shipping

- Opening ALP IDE Hub renders real state without protocol mismatch.
- Every command referenced by the webview is registered or removed.
- SDK Manager actions call real extension-host handlers.
- New/existing project flows call real extension-host handlers.
- Webview protocol types cannot drift silently.

## Test Plan

- `CI=true pnpm test`
- Command inventory test for all webview-referenced command IDs.
- Protocol contract tests.
- Browser/webview smoke test for:
  - initial `ready` -> `stateUpdate`,
  - refresh command,
  - SDK browse action,
  - protocol mismatch screen.

## Risks

- Shipping the full IDE Hub before schema alignment may surface legacy board
  model drift more visibly. Ideally, #72 lands before the full IDE Hub.
- SDK installation can involve network and git operations; the UI must treat
  these as cancellable jobs once #74 lands.
