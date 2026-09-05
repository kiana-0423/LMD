use lubricant_materials_database::commands::{self, *};
use lubricant_materials_database::db::migrations::initialize_database_file;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // Native open/save dialogs. Without it the interface has to ask a user to type an
        // absolute path, which is both unpleasant and a source of paths that do not exist.
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Logged before anything else can fail: a workspace that will not open produces no
            // interface at all, so the log file is the only place the reason can be found.
            commands::diagnostics::log_event(
                app.handle(),
                commands::diagnostics::LogLevel::Info,
                "app.starting",
                serde_json::json!({
                    "version": env!("CARGO_PKG_VERSION"),
                    "platform": std::env::consts::OS,
                    "architecture": std::env::consts::ARCH,
                }),
            );
            initialize_database_file(app.handle()).map_err(|err| {
                commands::diagnostics::log_event(
                    app.handle(),
                    commands::diagnostics::LogLevel::Error,
                    "database.initializeFailed",
                    serde_json::json!({ "error": err }),
                );
                Box::new(std::io::Error::other(err)) as Box<dyn std::error::Error>
            })?;
            // A job row still marked `running` cannot belong to this process: the previous one
            // ended without closing it. Left alone it would misreport the workspace forever, so it
            // is closed as interrupted before the window opens.
            match commands::jobs::mark_interrupted_jobs_on_startup(app.handle()) {
                Ok(0) => {}
                Ok(count) => {
                    eprintln!("LMD: marked {count} interrupted job(s) from a previous run");
                    commands::diagnostics::log_event(
                        app.handle(),
                        commands::diagnostics::LogLevel::Warn,
                        "jobs.interrupted",
                        serde_json::json!({ "count": count }),
                    );
                }
                // A failure here must not stop the application from starting.
                Err(err) => {
                    eprintln!("LMD: could not close interrupted jobs: {err}");
                    commands::diagnostics::log_event(
                        app.handle(),
                        commands::diagnostics::LogLevel::Error,
                        "jobs.recoveryFailed",
                        serde_json::json!({ "error": err }),
                    );
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace::create_workspace,
            workspace::open_workspace,
            workspace::get_workspace_status,
            workspace::create_default_directories,
            workspace::initialize_database,
            workspace::get_workspace_details,
            workspace::check_database_integrity,
            workspace::list_workspace_backups,
            workspace::create_workspace_backup,
            workspace::restore_workspace_backup,
            workspace::list_rows_needing_attention,
            diagnostics::get_diagnostics,
            diagnostics::export_diagnostics,
            molecule::list_molecules,
            molecule::get_molecule,
            molecule::delete_molecule,
            molecule::check_molecule_duplicate,
            molecule::import_new_molecule,
            molecule::save_molecule_with_required_descriptors,
            molecule_visualization::generate_molecule_3d,
            molecule_visualization::convert_molecule_format,
            molecule_visualization::export_molecule_file,
            descriptor::batch_calculate_descriptors,
            descriptor::recalculate_failed_descriptors,
            descriptor::recalculate_all_descriptors,
            descriptor::list_descriptor_jobs,
            descriptor::list_molecule_descriptors,
            export::export_all_descriptors_csv,
            export::export_ml_descriptor_matrix_csv,
            export::export_molecule_library_csv,
            base_additive::create_base_oil,
            base_additive::list_base_oils,
            base_additive::list_base_oils_page,
            base_additive::search_base_oils,
            base_additive::delete_base_oil,
            base_additive::delete_base_oil_with_components,
            base_additive::create_additive,
            base_additive::list_additives,
            base_additive::list_additives_page,
            base_additive::search_additives,
            base_additive::delete_additive,
            base_additive::delete_additive_with_components,
            formulation::create_formulation,
            formulation::list_formulations,
            formulation::list_formulations_page,
            formulation::search_formulations,
            formulation::delete_formulation,
            experiment::list_experiments,
            experiment::list_experiments_page,
            experiment::save_experiment_with_performance,
            experiment::list_performance_results,
            experiment::list_performance_results_page,
            experiment::get_experiment_with_results,
            experiment::list_formulation_experiments,
            analysis::get_dashboard_summary,
            analysis::list_performance_metrics,
            analysis::get_performance_distribution,
            analysis::compare_performance_by_group,
            analysis::get_concentration_performance,
            analysis::get_descriptor_property_correlation,
            base_additive::update_base_oil,
            base_additive::update_additive,
            formulation::update_formulation,
            formulation::copy_formulation,
            formulation::compare_formulations,
            molecule_usage::list_formulations_for_molecule,
            molecule_usage::list_molecule_files,
            molecule_usage::import_attachment,
            molecule_usage::export_workspace_file,
            molecule_usage::delete_attachment_record,
            experiment::update_experiment,
            experiment::delete_experiment,
            experiment::update_performance_result,
            experiment::delete_performance_result,
            experiment::list_attachments,
            model::train_model,
            model::predict_molecule_performance,
            model::predict_formulation_performance,
            model::list_models,
            model::list_model_jobs,
            model::export_ml_dataset,
            model::describe_training_scope,
            design::list_design_templates,
            design::get_design_readiness,
            design::run_design_generation,
            design::list_design_candidates,
            design::list_design_jobs,
            design::assess_design_candidates,
            design::promote_design_candidate,
            design::update_design_candidate_verification,
            design::export_design_candidates,
            sidecar::validate_smiles_with_sidecar,
            sidecar::molfile_to_smiles_with_sidecar,
            sidecar::smiles_to_molfile_with_sidecar,
            sidecar::calculate_sketcher_descriptors_with_sidecar,
            sidecar::preview_table_import,
            sidecar::confirm_table_import
        ])
        .run(tauri::generate_context!())
        .expect("error while running LMD application");
}

fn main() {
    run();
}
