# Bootstrap your toolchain

Bootstrap creates the Zephyr workspace beside your checkout and installs `west`
plus Zephyr's Python requirements into a workspace virtual environment. It does
**not** install host prerequisites (Python, CMake, Ninja) — run **Alp: Toolchain
doctor** to check those and get per-OS install hints.

It runs in a terminal so you can watch progress. When it finishes, the status
bar and the **Setup** tree reflect the newly available tools.
