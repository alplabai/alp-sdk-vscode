// SPDX-License-Identifier: Apache-2.0
//
// Everything the memory map would otherwise have to explain in place (#484).
//
// The map is a reading surface: a customer opens it to see where things land,
// not to read three paragraphs about what is missing from a schema. That
// context is real and worth keeping — it is why half the picture is absent and
// why nothing on it is editable — so it lives here, one tab away, instead of
// above the chart.

import styles from "./MemoryNotes.module.css";

export function MemoryNotes() {
  return (
    <div className={styles.root}>
      <section className={styles.note}>
        <h4 className={styles.title}>What the map can show</h4>
        <p>
          Only what <code>build/system-manifest.yaml</code> pins: the load
          address of each Zephyr slice, the resolved IPC carve-outs, and the
          resolved storage partitions — the customer-owned half, declared in{" "}
          <code>board.yaml</code>.
        </p>
        <p>
          A <strong>band</strong> is an extent. A <strong>line</strong> is a
          base with no size — the manifest pins where an image loads and says
          nothing about how much room it has, and an invented height would put a
          wall where there is a point. A slot&rsquo;s extent comes from{" "}
          <code>tan size</code>, which resolves the budget from SoM metadata;
          the row list names that measurement separately from the address.
        </p>
      </section>

      <section className={styles.note}>
        <h4 className={styles.title}>What it cannot show, and why</h4>
        <p>
          The SoM&rsquo;s own region table — bootloader, image slots, the
          writable window and the Secure-Enclave band — is not in{" "}
          <code>system-manifest-v1</code>. Its eight root keys carry no region,
          no base and no size. Reading{" "}
          <code>metadata/e1m_modules/&lt;SKU&gt;.yaml</code> instead is what the
          manifest&rsquo;s own description forbids, so the backdrop is absent
          rather than guessed. <code>alp-sdk#1365</code> is the request that
          would add it.
        </p>
        <p>
          Nothing here is editable, for the same reason. Until that data lands,
          nothing distinguishes a customer-sized band from a
          Secure-Enclave-owned one, and writing the wrong one can leave the part
          unbootable.
        </p>
      </section>

      <section className={styles.note}>
        <h4 className={styles.title}>Apertures</h4>
        <p>
          A region or flash device is named by the manifest but never described
          by it. So an aperture bar spans the hull of what landed inside it —
          &ldquo;at least this much is in use&rdquo; — never the
          aperture&rsquo;s own extent, which would claim to say how much is
          left.
        </p>
      </section>

      <section className={styles.note}>
        <h4 className={styles.title}>Overlaps</h4>
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
