# Install the Alp SDK

The **SDK Manager** lists tagged Alp SDK releases and installs the one you pick
into a local cache. The active SDK supplies the board schemas, presets, and the
build-plan emitter the extension consumes.

- Browse available releases and click **Install** on one.
- Then click **Use** on the installed release to make it active — installing and
  activating are two separate clicks, and nothing is active until you click
  **Use**.
- Or point the extension at an SDK you already have on disk, which activates it
  in one step.

Once you have made an SDK active, `board.yaml` validation, code generation, and
the build plan all light up — and this step ticks green.
