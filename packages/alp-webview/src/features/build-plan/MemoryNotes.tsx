// SPDX-License-Identifier: Apache-2.0
//
// Everything the memory map would otherwise have to explain in place (#484).
//
// The map is a reading surface: a customer opens it to see where things land,
// not to read three paragraphs about what is missing from a schema. That
// context is real and worth keeping — from an alp-sdk that carries
// alp-sdk#1365's `memory[]` pane (not yet in a tagged release,
// alp-sdk#2047) the picture is no longer half-absent, but eligibility is
// still never claimed and nothing on it is ever editable — so it lives
// here, one tab away, instead of above the chart.

import styles from "./MemoryNotes.module.css";

export function MemoryNotes() {
  return (
    <div className={styles.root}>
      <section className={styles.note}>
        <h3 className={styles.title}>What the map can show</h3>
        <p>
          What <code>build/system-manifest.yaml</code> pins: the load address of
          each Zephyr slice, the resolved IPC carve-outs, and the resolved
          storage partitions — the customer-owned half, declared in{" "}
          <code>board.yaml</code>. From an alp-sdk that carries{" "}
          <code>alp-sdk#1365</code>&rsquo;s <code>memory[]</code> pane (not yet
          in a tagged release, alp-sdk#2047) it also shows the SoM&rsquo;s own
          region table when the manifest carries one — bootloader, image slots,
          the writable window, the Secure-Enclave band — drawn behind the
          customer-owned extents and listed below them.
        </p>
        <p>
          A <strong>band</strong> is an extent. A <strong>line</strong> is a
          base with no size — the slice&rsquo;s own load address never carries
          one, and an invented height would put a wall where there is a point. A
          slot&rsquo;s extent comes from <code>tan size</code>, which resolves
          the budget from SoM metadata; the row list names that measurement
          separately from the address. When the manifest also resolves that same
          slot as a region, the table below lists its extent too — separately,
          never joined to this line.
        </p>
      </section>

      <section className={styles.note}>
        <h3 className={styles.title}>What it cannot show, and why</h3>
        <p>
          The SoM&rsquo;s own region table — bootloader, image slots, the
          writable window and the Secure-Enclave band — reaches this view only
          from a manifest new enough to carry it (<code>alp-sdk#1365</code>; not
          yet in a tagged alp-sdk release, alp-sdk#2047). On an older manifest,
          or a SoM whose region layout is still pending, the region table is
          simply not in <code>system-manifest-v1</code> at all, and this view
          shows no table rather than an empty one.
        </p>
        <p>
          A bundled schema older than the producer that wrote your manifest may
          still underline <code>memory:</code> in the editor. That squiggle
          names a schema this extension has not caught up to yet, not a bad
          manifest.
        </p>
        <p>
          Even when the table is shown, it claims no eligibility: a region here
          is a fact about the SoM, not a verdict on whether a carve-out or a
          mount may land on it. That verdict is the allocator&rsquo;s, and it
          already reaches this panel as <code>ipc[].status</code> /{" "}
          <code>ipc[].reason</code>.
        </p>
        <p>
          Nothing here is editable either way: <code>write_authority</code> is
          optional in both the SoM preset and the manifest, so this view cannot
          yet always tell a customer-sized band from a Secure-Enclave-owned one,
          and writing the wrong one can leave the part unbootable.
        </p>
      </section>

      <section className={styles.note}>
        <h3 className={styles.title}>Apertures</h3>
        <p>
          A region or flash device is named by the manifest but not always
          described by it: <code>carve_out_region</code> /{" "}
          <code>flash_device</code> say which aperture the resolver allocated
          out of, and its own base and size are a separate, optional fact — the
          SoM region table above — that this bar never merges in. So an aperture
          bar still spans the hull of what landed inside it — &ldquo;at least
          this much is in use&rdquo; — never the aperture&rsquo;s own extent,
          EVEN WHEN a same-named row in the region table resolves one: the two
          are shown side by side, joined only by name, never combined into one
          shape.
        </p>
      </section>

      <section className={styles.note}>
        <h3 className={styles.title}>Overlaps</h3>
        <p>
          Reported here, not by the build. The allocator compares a carve-out
          only against carve-outs already placed in the same region, so a pinned{" "}
          <code>ipc[].address:</code>, a partition offset and a slice&rsquo;s
          load address are compared nowhere upstream.
        </p>
      </section>
    </div>
  );
}
