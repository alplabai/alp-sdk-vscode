# Bootstrap your toolchain

Open or create your project first (previous step) — with no folder open there is
nothing for bootstrap to work on.

Bootstrap creates the Zephyr workspace beside your checkout and installs `west`
plus Zephyr's Python requirements into a workspace virtual environment. It does
**not** install host prerequisites such as CMake and Ninja — run
**Alp: Dependencies** to see the status `tan` reported for each of them.

`tan` emits no Python check of its own, so nothing in that table speaks for your
Python install; check it with `python3 --version` (`py -3 --version` on Windows).

It runs in a terminal so you can watch progress. When it finishes, the status
bar and the **Setup** section of the **Alp IDE** panel reflect the newly
available tools.
