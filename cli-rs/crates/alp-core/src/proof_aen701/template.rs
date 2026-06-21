// SPDX-License-Identifier: Apache-2.0
//! **WRITER layer (engine core)** — a tiny, domain-free template renderer. The
//! TEMPLATE layer is DATA (a `.tmpl` in the SoM bundle), not engine code. It
//! supports `{{var}}` substitution, `{{#if key}} … {{/if}}` (kept when the var is
//! non-empty), and `{{#each list}} … {{/each}}` (the inner block emitted once per
//! row, with the row's `{{key}}`s substituted — so per-row `{{#if}}` works). No
//! domain deps: this is the pure island the writer generators fill.

use std::collections::BTreeMap;

/// One `{{#each}}` row: a map of row-local `{{key}}` → value.
pub(crate) type Row = BTreeMap<&'static str, String>;

/// Render a bundle template: the engine computes the vars/lists from policy +
/// metadata; the template owns the output *shape*.
pub(crate) fn render_template(
    tmpl: &str,
    vars: &BTreeMap<&str, String>,
    lists: &BTreeMap<&str, Vec<Row>>,
) -> String {
    let mut s = tmpl.to_string();
    // {{#each name}} … {{/each}} — expand once per row; each row's block is
    // resolved with the ROW's own vars, so `{{#if rowKey}}` works per row.
    while let Some(start) = s.find("{{#each ") {
        let hdr_end = s[start..]
            .find("}}")
            .map(|i| start + i + 2)
            .expect("unterminated {{#each");
        let name = s[start + 8..hdr_end - 2].trim().to_string();
        let close = "{{/each}}";
        let end = s[hdr_end..]
            .find(close)
            .map(|i| hdr_end + i)
            .expect("missing {{/each}}");
        let inner = s[hdr_end..end].to_string();
        let mut out = String::new();
        for row in lists.get(name.as_str()).map(Vec::as_slice).unwrap_or(&[]) {
            out.push_str(&apply_vars(&inner, row));
        }
        s = format!("{}{}{}", &s[..start], out, &s[end + close.len()..]);
    }
    // Top-level `{{#if}}` + `{{var}}` with the global vars.
    let out = apply_vars(&s, vars);
    // Drift guard: a surviving `{{…}}` means the engine forgot to supply a var
    // the template references (or a malformed tag). Debug-only — zero release cost.
    debug_assert!(
        !out.contains("{{"),
        "template left an unresolved placeholder (engine/template drift): {:?}",
        out.split("{{").nth(1).and_then(|r| r.split("}}").next())
    );
    out
}

/// Resolve `{{#if key}} … {{/if}}` (kept when the var is non-empty) then `{{key}}`
/// for a single var map. Used both at the top level and per `{{#each}}` row.
pub(crate) fn apply_vars(tmpl: &str, vars: &BTreeMap<&str, String>) -> String {
    let mut s = tmpl.to_string();
    while let Some(start) = s.find("{{#if ") {
        let hdr_end = s[start..]
            .find("}}")
            .map(|i| start + i + 2)
            .expect("unterminated {{#if");
        let key = s[start + 6..hdr_end - 2].trim().to_string();
        let close = "{{/if}}";
        let end = s[hdr_end..]
            .find(close)
            .map(|i| hdr_end + i)
            .expect("missing {{/if}}");
        let keep = vars.get(key.as_str()).is_some_and(|v| !v.is_empty());
        let inner = if keep {
            s[hdr_end..end].to_string()
        } else {
            String::new()
        };
        s = format!("{}{}{}", &s[..start], inner, &s[end + close.len()..]);
    }
    for (k, v) in vars {
        s = s.replace(&format!("{{{{{k}}}}}"), v);
    }
    s
}

/// No `{{#each}}` lists (a convenience for templates that only use vars/ifs).
pub(crate) fn no_lists() -> BTreeMap<&'static str, Vec<Row>> {
    BTreeMap::new()
}
