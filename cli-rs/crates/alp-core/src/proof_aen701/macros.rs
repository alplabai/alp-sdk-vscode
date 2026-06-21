// SPDX-License-Identifier: Apache-2.0
//! Small declarative macros for the PARSER layer. Keeping the per-layer version
//! gate in ONE macro means every layer (bundle / metadata / policy / template)
//! enforces it identically — the load-time contract the versioning architecture
//! is built on (RFC #235). This is the idiomatic place for a macro: a mechanical,
//! repeated, schema-anchored check. The *writer* generators + the compat
//! messages stay plain functions (readable, greppable) — macros earn their place
//! in the parser, not the writer.

/// Reject a layer whose `schemaVersion` the engine does not understand. Use in
/// any `fn -> Result<_, String>`. Accepts one or more supported versions (so a
/// schema migration can keep accepting N and N-1 during the sunset window):
///
/// ```ignore
/// check_schema_version!("policy", p.schema_version, SUPPORTED_POLICY_SCHEMA);
/// check_schema_version!("bundle", m.schema_version, 1, 2); // N and N-1
/// ```
macro_rules! check_schema_version {
    ($layer:expr, $got:expr, $($ok:expr),+ $(,)?) => {{
        let got = $got;
        let supported = [$($ok),+];
        if !supported.contains(&got) {
            return Err(format!(
                "unsupported {} schemaVersion {} (engine understands {})",
                $layer,
                got,
                supported
                    .iter()
                    .map(|v| v.to_string())
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }};
}

pub(crate) use check_schema_version;
