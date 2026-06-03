// SPDX-License-Identifier: Apache-2.0
//! `alp explain` — describe project/module templates and generation targets.
//!
//! Mirrors TS `runExplainCommand`: `--template` explains an init/scaffold
//! template, `--target` explains a generation output target, and no selector
//! prints an overview. Supplying both is an error (exit 1), as is an unknown id.

use alp_core::wizard::{ModuleTemplateDefinition, WizardFeatureFlags, WizardTemplateDefinition};
use alp_core::wizard::{list_module_templates, list_wizard_templates};
use alp_core::{GenerationTargetSupport, list_generation_target_support};

use super::CommandRun;
use crate::cli::{ExplainArgs, GlobalArgs};
use crate::envelope::{Envelope, Issue, Project};
use crate::exit::ExitCode;

#[derive(serde::Serialize)]
struct Selector {
    kind: String,
    value: String,
}

#[derive(serde::Serialize)]
struct Available {
    #[serde(rename = "projectTemplates")]
    project_templates: Vec<String>,
    #[serde(rename = "moduleTemplates")]
    module_templates: Vec<String>,
    #[serde(rename = "generationTargets")]
    generation_targets: Vec<String>,
}

#[derive(serde::Serialize)]
struct ExplainData {
    #[serde(rename = "schemaVersion")]
    schema_version: String,
    selector: Selector,
    summary: String,
    details: Vec<String>,
    available: Available,
}

pub fn run(g: &GlobalArgs, args: &ExplainArgs) -> CommandRun {
    let project_templates = list_wizard_templates();
    let module_templates = list_module_templates();
    let generation_targets = list_generation_target_support();

    let available = || Available {
        project_templates: project_templates
            .iter()
            .map(|t| t.id.as_str().to_string())
            .collect(),
        module_templates: module_templates
            .iter()
            .map(|t| t.id.as_str().to_string())
            .collect(),
        generation_targets: generation_targets
            .iter()
            .map(|t| t.emit.to_string())
            .collect(),
    };

    let requested_template = args
        .template
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let requested_target = g.target.as_deref().map(str::trim).filter(|s| !s.is_empty());

    if requested_template.is_some() && requested_target.is_some() {
        return failure(
            g,
            available(),
            Selector {
                kind: "overview".to_string(),
                value: String::new(),
            },
            "ambiguous-selector",
            "Use either --template or --target for explain, not both.",
            vec![
                "explain: use either --template or --target, but not both in the same command."
                    .to_string(),
            ],
        );
    }

    if let Some(requested) = requested_template {
        if let Some(pt) = project_templates
            .iter()
            .copied()
            .find(|t| t.id.as_str() == requested)
        {
            return success(
                g,
                available(),
                Selector {
                    kind: "project-template".to_string(),
                    value: pt.id.as_str().to_string(),
                },
                format!("{} ({})", pt.label, pt.id.as_str()),
                project_template_details(pt),
            );
        }
        if let Some(mt) = module_templates
            .iter()
            .copied()
            .find(|t| t.id.as_str() == requested)
        {
            return success(
                g,
                available(),
                Selector {
                    kind: "module-template".to_string(),
                    value: mt.id.as_str().to_string(),
                },
                format!("{} ({})", mt.label, mt.id.as_str()),
                module_template_details(mt),
            );
        }
        return failure(
            g,
            available(),
            Selector {
                kind: "overview".to_string(),
                value: requested.to_string(),
            },
            "template-unknown",
            &format!("Unknown template '{requested}'."),
            vec![format!(
                "explain: unknown template '{requested}'. Run alp explain without selectors to list available topics."
            )],
        );
    }

    if let Some(requested) = requested_target {
        let Some(target) = generation_targets.iter().find(|t| t.emit == requested) else {
            return failure(
                g,
                available(),
                Selector {
                    kind: "overview".to_string(),
                    value: requested.to_string(),
                },
                "target-unknown",
                &format!("Unknown generation target '{requested}'."),
                vec![format!(
                    "explain: unknown generation target '{requested}'. Run alp explain without selectors to list available targets."
                )],
            );
        };
        return success(
            g,
            available(),
            Selector {
                kind: "generation-target".to_string(),
                value: target.emit.to_string(),
            },
            format!("{} ({})", target.display_name, target.emit),
            generation_target_details(target),
        );
    }

    let overview = vec![
        "Use --template to explain a project template (init) or module template (scaffold)."
            .to_string(),
        "Use --target to explain a generation output target.".to_string(),
        format!(
            "Project templates: {}",
            project_templates
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ),
        format!(
            "Module templates: {}",
            module_templates
                .iter()
                .map(|t| t.id.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ),
        format!(
            "Generation targets: {}",
            generation_targets
                .iter()
                .map(|t| t.emit)
                .collect::<Vec<_>>()
                .join(", ")
        ),
    ];
    success(
        g,
        available(),
        Selector {
            kind: "overview".to_string(),
            value: "all".to_string(),
        },
        "ALP explain topics".to_string(),
        overview,
    )
}

fn project_template_details(pt: &WizardTemplateDefinition) -> Vec<String> {
    let mut details = vec![pt.description.to_string()];
    details.extend(pt.explanation.iter().map(|s| (*s).to_string()));
    let libraries = if pt.libs.is_empty() {
        "(none)".to_string()
    } else {
        pt.libs.join(", ")
    };
    details.push(format!("Default libraries: {libraries}"));
    details.push(format!(
        "Default features: {}",
        format_feature_flags(pt.features.as_ref())
    ));
    details
}

fn module_template_details(mt: &ModuleTemplateDefinition) -> Vec<String> {
    vec![
        mt.description.to_string(),
        format!("Function prefix: {}", mt.function_prefix),
        "Use this template with alp scaffold to generate a module source/header baseline."
            .to_string(),
    ]
}

fn generation_target_details(target: &GenerationTargetSupport) -> Vec<String> {
    vec![
        format!("Display name: {}", target.display_name),
        format!("Output path: {}", target.output_relative_path),
        format!("Preview label: {}", target.preview_label),
        format!("Preview language: {}", target.preview_language_id),
    ]
}

fn format_feature_flags(features: Option<&WizardFeatureFlags>) -> String {
    let (wifi, mqtt, ble, tls) = match features {
        Some(f) => (f.wifi, f.mqtt, f.ble, f.tls),
        None => (false, false, false, false),
    };
    format!("wifi={wifi} mqtt={mqtt} ble={ble} tls={tls}")
}

fn null_project() -> Project {
    Project {
        root: None,
        board_yaml: None,
    }
}

fn success(
    g: &GlobalArgs,
    available: Available,
    selector: Selector,
    summary: String,
    details: Vec<String>,
) -> CommandRun {
    let text = if g.is_json() {
        Vec::new()
    } else {
        explain_text(&summary, &details, g)
    };
    let data = ExplainData {
        schema_version: "1".to_string(),
        selector,
        summary,
        details,
        available,
    };
    let json = g.is_json().then(|| {
        Envelope::new(
            "explain",
            null_project(),
            data,
            Vec::new(),
            ExitCode::Success.code(),
        )
        .to_json()
    });
    CommandRun {
        exit: ExitCode::Success,
        text,
        json,
    }
}

fn failure(
    g: &GlobalArgs,
    available: Available,
    selector: Selector,
    code: &str,
    issue_message: &str,
    text_lines: Vec<String>,
) -> CommandRun {
    let issues = vec![Issue {
        code: format!("explain.{code}"),
        severity: "error".to_string(),
        message: issue_message.to_string(),
    }];
    let data = ExplainData {
        schema_version: "1".to_string(),
        selector,
        summary: String::new(),
        details: Vec::new(),
        available,
    };
    let text = if g.is_json() { Vec::new() } else { text_lines };
    let json = g.is_json().then(|| {
        Envelope::new(
            "explain",
            null_project(),
            data,
            issues,
            ExitCode::RuntimeFailure.code(),
        )
        .to_json()
    });
    CommandRun {
        exit: ExitCode::RuntimeFailure,
        text,
        json,
    }
}

fn explain_text(summary: &str, details: &[String], g: &GlobalArgs) -> Vec<String> {
    let mut lines = vec![format!("explain: {summary}")];
    if !g.quiet {
        for detail in details {
            lines.push(format!("- {detail}"));
        }
    }
    lines
}
