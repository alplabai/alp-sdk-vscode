// SPDX-License-Identifier: Apache-2.0
//! Wizard and module-scaffold domain logic.

pub mod filesystem;
pub mod models;
pub mod service;

pub use filesystem::{collect_wizard_file_changes, write_wizard_files};
pub use models::*;
pub use service::{
    app_core_for_sku, create_module_scaffold_plan, create_scaffold_tree_preview,
    create_wizard_plan, create_wizard_plan_with_cores, infer_runtime_for_core_id,
    list_module_templates, list_wizard_templates, normalize_module_name,
};
