mod app_paths;
mod commands;
mod db;

use commands::*;
use db::migrations::initialize_database_file;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            initialize_database_file(app.handle()).map_err(|err| {
                Box::new(std::io::Error::new(std::io::ErrorKind::Other, err))
                    as Box<dyn std::error::Error>
            })?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            workspace::create_workspace,
            workspace::open_workspace,
            workspace::get_workspace_status,
            workspace::create_default_directories,
            workspace::initialize_database,
            molecule::create_molecule,
            molecule::list_molecules,
            molecule::get_molecule,
            molecule::update_molecule,
            molecule::delete_molecule,
            molecule::check_duplicate_molecule,
            molecule::check_molecule_duplicate,
            molecule::import_new_molecule,
            molecule::save_molecule_with_required_descriptors,
            molecule_visualization::visualize_molecule_from_smiles,
            molecule_visualization::generate_molecule_3d,
            molecule_visualization::convert_molecule_format,
            molecule_visualization::export_molecule_file,
            descriptor::calculate_rdkit_descriptors,
            descriptor::calculate_mordred_descriptors,
            descriptor::calculate_required_descriptors,
            descriptor::batch_calculate_descriptors,
            descriptor::recalculate_failed_descriptors,
            descriptor::recalculate_all_descriptors,
            descriptor::list_descriptor_jobs,
            descriptor::list_molecule_descriptors,
            descriptor::get_descriptor_status,
            descriptor::get_descriptor_summary,
            descriptor::get_descriptor_json,
            descriptor::export_all_descriptors_csv,
            descriptor::export_ml_descriptor_matrix_csv,
            base_additive::create_base_oil,
            base_additive::list_base_oils,
            base_additive::delete_base_oil,
            base_additive::create_additive,
            base_additive::list_additives,
            base_additive::delete_additive,
            formulation::create_formulation,
            formulation::list_formulations,
            formulation::get_formulation,
            formulation::delete_formulation,
            formulation::add_formulation_component,
            formulation::update_formulation_component,
            formulation::delete_formulation_component,
            experiment::create_experiment,
            experiment::list_experiments,
            experiment::create_performance_result,
            experiment::list_performance_results,
            experiment::get_experiment_with_results,
            experiment::add_attachment,
            analysis::get_dashboard_summary,
            analysis::get_performance_distribution,
            analysis::get_descriptor_property_correlation,
            analysis::export_ml_dataset,
            analysis::run_additive_design_mock,
            analysis::run_formulation_design_mock,
            sidecar::standardize_molecule_with_sidecar,
            sidecar::calculate_descriptors_with_sidecar,
            sidecar::calculate_required_descriptors_with_sidecar,
            sidecar::validate_smiles_with_sidecar,
            sidecar::molfile_to_smiles_with_sidecar,
            sidecar::smiles_to_molfile_with_sidecar,
            sidecar::calculate_sketcher_descriptors_with_sidecar,
            sidecar::import_excel_with_sidecar,
            sidecar::predict_additive_with_sidecar
        ])
        .run(tauri::generate_context!())
        .expect("error while running LMD application");
}

fn main() {
    run();
}
