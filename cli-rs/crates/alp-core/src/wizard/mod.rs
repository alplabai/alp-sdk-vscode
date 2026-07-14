// SPDX-License-Identifier: Apache-2.0
//! Wizard and module-scaffold domain logic.

/// Filesystem I/O: diff detection against existing files and writing planned changes.
pub mod filesystem;
/// Domain types for the project wizard and module scaffold.
pub mod models;
/// Template registry, file-content generators, and planning logic.
pub mod service;

pub use filesystem::{
    ExampleDiscovery, ExampleReadError, collect_wizard_file_changes, discover_examples,
    read_example_tree, write_wizard_files,
};
pub use models::*;
pub use service::{
    app_core_for_sku, create_module_scaffold_plan, create_scaffold_tree_preview,
    create_wizard_plan, create_wizard_plan_with_cores, example_description_from_readme,
    example_id_from_source_dir, example_title_from_readme, infer_runtime_for_core_id,
    list_module_templates, list_wizard_templates, normalize_module_name, retarget_board_yaml_som,
};
