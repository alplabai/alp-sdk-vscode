// SPDX-License-Identifier: Apache-2.0
//! Structural diff between two JSON values — a port of the TS `diff` command's
//! `collectDiffEntries` / `collectRecursiveDiff`. Used to surface what
//! `normalize_board_model` changed relative to the parsed board.yaml.
//!
//! Rust serializes `Option::None` fields as `null`, whereas the TS model is
//! sparse (absent keys are `undefined`). [`prune_nulls`] drops null-valued
//! object entries so both sides diff the same shape the TS CLI does.

use serde::Serialize;
use serde_json::{Map, Value};

/// Classifies a single `DiffEntry`. Serializes lowercase (`added`/`removed`/`changed`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DiffKind {
    /// Key/element present only in `after`.
    Added,
    /// Key/element present only in `before`.
    Removed,
    /// Leaf value present in both but unequal.
    Changed,
}

/// One difference at a given path. `before`/`after` are omitted from JSON when `None`.
#[derive(Debug, Clone, Serialize)]
pub struct DiffEntry {
    /// Dotted/bracketed location, e.g. `models.foo` or `cores[0].name`; `<root>` for a top-level scalar change.
    pub path: String,
    /// Whether the entry was added, removed, or changed.
    pub kind: DiffKind,
    /// Value at `path` in `before`; `None` for `Added`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<Value>,
    /// Value at `path` in `after`; `None` for `Removed`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<Value>,
}

/// Recursively remove `null`-valued object entries (object keys only; array
/// elements are preserved so indices stay stable), mirroring how JS omits
/// `undefined` object properties.
pub fn prune_nulls(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut pruned = Map::new();
            for (key, val) in map {
                if val.is_null() {
                    continue;
                }
                pruned.insert(key, prune_nulls(val));
            }
            Value::Object(pruned)
        }
        Value::Array(items) => Value::Array(items.into_iter().map(prune_nulls).collect()),
        other => other,
    }
}

/// Collect every difference between `before` and `after`, sorted by path.
pub fn collect_diff_entries(before: &Value, after: &Value) -> Vec<DiffEntry> {
    let mut output = Vec::new();
    collect_recursive(before, after, "", &mut output);
    output.sort_by(|a, b| a.path.cmp(&b.path));
    output
}

fn collect_recursive(
    before: &Value,
    after: &Value,
    current_path: &str,
    output: &mut Vec<DiffEntry>,
) {
    if before == after {
        return;
    }

    if let (Value::Object(before_map), Value::Object(after_map)) = (before, after) {
        let mut keys: Vec<&String> = before_map.keys().chain(after_map.keys()).collect();
        keys.sort();
        keys.dedup();

        for key in keys {
            let next_path = if current_path.is_empty() {
                key.clone()
            } else {
                format!("{current_path}.{key}")
            };
            match (before_map.get(key), after_map.get(key)) {
                (None, Some(after_val)) => output.push(DiffEntry {
                    path: next_path,
                    kind: DiffKind::Added,
                    before: None,
                    after: Some(after_val.clone()),
                }),
                (Some(before_val), None) => output.push(DiffEntry {
                    path: next_path,
                    kind: DiffKind::Removed,
                    before: Some(before_val.clone()),
                    after: None,
                }),
                (Some(before_val), Some(after_val)) => {
                    collect_recursive(before_val, after_val, &next_path, output)
                }
                (None, None) => {}
            }
        }
        return;
    }

    if let (Value::Array(before_arr), Value::Array(after_arr)) = (before, after) {
        let max_len = before_arr.len().max(after_arr.len());
        for index in 0..max_len {
            let next_path = format!("{current_path}[{index}]");
            match (before_arr.get(index), after_arr.get(index)) {
                (Some(before_val), Some(after_val)) => {
                    collect_recursive(before_val, after_val, &next_path, output)
                }
                (None, Some(after_val)) => output.push(DiffEntry {
                    path: next_path,
                    kind: DiffKind::Added,
                    before: None,
                    after: Some(after_val.clone()),
                }),
                (Some(before_val), None) => output.push(DiffEntry {
                    path: next_path,
                    kind: DiffKind::Removed,
                    before: Some(before_val.clone()),
                    after: None,
                }),
                (None, None) => {}
            }
        }
        return;
    }

    output.push(DiffEntry {
        path: if current_path.is_empty() {
            "<root>".to_string()
        } else {
            current_path.to_string()
        },
        kind: DiffKind::Changed,
        before: Some(before.clone()),
        after: Some(after.clone()),
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn identical_values_have_no_diff() {
        let v = json!({"a": 1, "b": [1, 2]});
        assert!(collect_diff_entries(&v, &v).is_empty());
    }

    #[test]
    fn detects_removed_added_changed_sorted_by_path() {
        let before = json!({"keep": 1, "gone": {"x": 1}, "moved": "a"});
        let after = json!({"keep": 1, "added": true, "moved": "b"});
        let diff = collect_diff_entries(&before, &after);
        // Paths sorted: "added", "gone", "moved"
        assert_eq!(diff.len(), 3);
        assert_eq!(diff[0].path, "added");
        assert_eq!(diff[0].kind, DiffKind::Added);
        assert_eq!(diff[1].path, "gone");
        assert_eq!(diff[1].kind, DiffKind::Removed);
        assert_eq!(diff[1].before, Some(json!({"x": 1})));
        assert_eq!(diff[2].path, "moved");
        assert_eq!(diff[2].kind, DiffKind::Changed);
        assert_eq!(diff[2].before, Some(json!("a")));
        assert_eq!(diff[2].after, Some(json!("b")));
    }

    #[test]
    fn prune_nulls_drops_object_nulls_keeps_empty_objects() {
        let pruned = prune_nulls(json!({"a": null, "b": {"c": null, "d": 1}, "e": {}}));
        assert_eq!(pruned, json!({"b": {"d": 1}, "e": {}}));
    }

    #[test]
    fn added_entry_omits_before_in_json() {
        let before = json!({});
        let after = json!({"x": 1});
        let diff = collect_diff_entries(&before, &after);
        let serialized = serde_json::to_string(&diff[0]).unwrap();
        assert!(!serialized.contains("\"before\""));
        assert!(serialized.contains("\"after\":1"));
        assert!(serialized.contains("\"kind\":\"added\""));
    }
}
