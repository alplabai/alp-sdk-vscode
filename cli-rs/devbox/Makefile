# SPDX-License-Identifier: Apache-2.0
# alp devbox — hardware-free build / debug-sim verification (Podman).
#
#   make build          # gating image: native_sim build + handoff + gdb-sim
#   make verify         # run the gating suite against the checked-out SDK SHA
#   make build-renode   # + arm toolchain + Renode (advisory generic-Cortex leg)
#   make verify-renode  # run the full suite incl. the advisory Renode boot
#   make shell          # interactive shell in the devbox (SDK mounted)
#
# The SDK is bind-mounted read-only from the repo's submodule, so the proof
# reflects the exact checked-out SHA. The alp binary is cargo-built INSIDE the
# image (the host binary is a macOS mach-o and cannot run in linux).

REPO    := $(shell git -C $(CURDIR) rev-parse --show-toplevel)
SDK     := $(REPO)/alp-sdk-upstream
CONTEXT := $(REPO)/cli-rs
FILE    := $(REPO)/cli-rs/devbox/Containerfile
IMAGE   := alp-devbox
ENGINE  ?= podman
# The submodule's .git is a file (points into the parent repo), invisible inside
# a bind-mount — so stamp the SHA host-side and pass it in.
SDK_SHA := $(shell git -C $(SDK) describe --tags --always --dirty 2>/dev/null || echo unknown)
# Optional single-value overrides, forwarded only when set (CI pins the SDK to a
# release tag and points these at a release example — the in-image defaults
# target the dev-layout examples).
override_env := $(if $(DEVBOX_EXAMPLES),-e DEVBOX_EXAMPLES=$(DEVBOX_EXAMPLES)) $(if $(DEVBOX_HANDOFF_EXAMPLE),-e DEVBOX_HANDOFF_EXAMPLE=$(DEVBOX_HANDOFF_EXAMPLE))
MOUNT   := -v $(SDK):/work/alp-sdk:ro -e DEVBOX_SDK_SHA=$(SDK_SHA) $(override_env)

.PHONY: build build-renode verify verify-renode shell clean help

help:
	@grep -E '^#   make' $(FILE:Containerfile=Makefile) | sed 's/^#   /  /'

build:                ## gating image (native_sim + handoff + gdb-sim)
	$(ENGINE) build --target devbox -f $(FILE) -t $(IMAGE) $(CONTEXT)

build-renode:         ## + arm-zephyr-eabi + Renode (advisory leg)
	$(ENGINE) build --target devbox-renode -f $(FILE) -t $(IMAGE):renode $(CONTEXT)

verify: build         ## run the gating suite vs the checked-out SDK SHA
	$(ENGINE) run --rm $(MOUNT) $(IMAGE)

verify-renode: build-renode  ## run the full suite incl. advisory Renode boot
	$(ENGINE) run --rm $(MOUNT) $(IMAGE):renode

shell:                ## interactive shell (SDK mounted at /work/alp-sdk)
	$(ENGINE) run --rm -it $(MOUNT) --entrypoint bash $(IMAGE)

clean:                ## remove the devbox images
	-$(ENGINE) rmi $(IMAGE) $(IMAGE):renode 2>/dev/null || true
