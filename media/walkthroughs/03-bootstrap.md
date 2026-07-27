# Bootstrap your toolchain

Open or create your project first (previous step) — with no folder open there is
nothing for bootstrap to work on.

Bootstrap creates the Zephyr workspace beside your checkout and installs `west`
plus Zephyr's Python requirements into a workspace virtual environment. It does
**not** install host prerequisites (Python, CMake, Ninja) — run **Alp: Toolchain
doctor** to check those and get per-OS install hints.

It runs in a terminal so you can watch progress. When it finishes, the status
bar and the **Setup** section of the **Alp IDE** panel reflect the newly
available tools.
