//! Training and prediction feature agreement, against a real SQLite file.
//!
//! The question these answer is the one a user would ask: if I train a formulation-level model on
//! this workspace, can it actually predict one of these formulations — or does every aggregated
//! column come back as "missing"?

use lubricant_materials_database::commands::features::ConcentrationBasis;
use lubricant_materials_database::commands::model::{
    additive_dataset_shape, aggregate_feature_agreement, dataset_summary, molecule_prediction_row,
    MoleculeRow,
};
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;

fn schema() -> &'static str {
    include_str!("../src/db/schema_for_tests.sql")
}

const TARGET: &str = "average_friction_coefficient";

/// Writes a row that today's `CHECK` constraints refuse.
///
/// A zero or negative concentration cannot be *entered* any more — the schema and the write
/// validation both refuse it. It can still be *read*, because a workspace written by an older
/// build may hold one and the migration deliberately preserves such rows rather than correcting
/// values nobody measured. These tests are about what the dataset builder does when it meets one,
/// so they have to be able to produce one the way history did.
fn write_as_a_legacy_build_would(connection: &Connection, sql: &str) {
    connection
        .pragma_update(None, "ignore_check_constraints", true)
        .expect("check enforcement should be suspendable");
    let result = connection.execute(sql, []);
    connection
        .pragma_update(None, "ignore_check_constraints", false)
        .expect("check enforcement should be restored");
    result.expect("the legacy row should be written");
}

struct Workspace {
    root: PathBuf,
}

impl Workspace {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "lmd-model-int-{name}-{}-{}",
            std::process::id(),
            name.len()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("workspace should be created");
        let connection = Connection::open(root.join("lmd.sqlite")).expect("database should open");
        connection
            .execute_batch(schema())
            .expect("schema should initialize");
        Self { root }
    }

    fn open(&self) -> Connection {
        Connection::open(self.root.join("lmd.sqlite")).expect("database should open")
    }

    fn cleanup(self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// Twelve two-additive formulations, each measured once: enough rows for the training floor, and
/// every blend genuinely a mixture rather than a single molecule.
fn seed_blends(connection: &Connection, unit: &str) {
    connection
        .execute_batch(
            "INSERT INTO base_oils (id, name, viscosity_40c, viscosity_100c, density,
                                    created_at, updated_at)
             VALUES ('bo-1', 'PAO-6', 32.0, 6.0, 0.83, '2026-01-01', '2026-01-01');",
        )
        .expect("base oil should insert");
    for index in 0..12 {
        let suffix = format!("{index:02}");
        connection
            .execute_batch(&format!(
                r#"
                INSERT INTO molecules (id, name, created_at, updated_at) VALUES
                  ('mol-a-{suffix}', 'Additive A {suffix}', '2026-01-01', '2026-01-01'),
                  ('mol-b-{suffix}', 'Additive B {suffix}', '2026-01-01', '2026-01-01');
                INSERT INTO molecule_descriptors
                  (id, molecule_id, descriptor_set, descriptors_json, descriptor_count, status,
                   mode, calculated_at) VALUES
                  ('d-a-{suffix}', 'mol-a-{suffix}', 'rdkit',
                   '{{"MolWt": {weight_a}, "MolLogP": {logp_a}}}', 2, 'calculated', 'real',
                   '2026-01-01'),
                  ('d-b-{suffix}', 'mol-b-{suffix}', 'rdkit',
                   '{{"MolWt": {weight_b}, "MolLogP": {logp_b}}}', 2, 'calculated', 'real',
                   '2026-01-01');
                INSERT INTO additives (id, molecule_id, created_at, updated_at) VALUES
                  ('add-a-{suffix}', 'mol-a-{suffix}', '2026-01-01', '2026-01-01'),
                  ('add-b-{suffix}', 'mol-b-{suffix}', '2026-01-01', '2026-01-01');
                INSERT INTO formulations (id, name, created_at, updated_at)
                  VALUES ('form-{suffix}', 'Blend {suffix}', '2026-01-01', '2026-01-01');
                INSERT INTO formulation_components
                  (id, formulation_id, component_role, additive_id, concentration_value,
                   concentration_unit) VALUES
                  ('c-a-{suffix}', 'form-{suffix}', 'additive', 'add-a-{suffix}', 1.0, '{unit}'),
                  ('c-b-{suffix}', 'form-{suffix}', 'additive', 'add-b-{suffix}', 3.0, '{unit}');
                INSERT INTO formulation_components
                  (id, formulation_id, component_role, base_oil_id, concentration_value,
                   concentration_unit)
                  VALUES ('c-o-{suffix}', 'form-{suffix}', 'base_oil', 'bo-1', 96.0, '{unit}');
                INSERT INTO experiments (id, formulation_id, created_at, updated_at)
                  VALUES ('exp-{suffix}', 'form-{suffix}', '2026-01-01', '2026-01-01');
                INSERT INTO performance_results
                  (id, experiment_id, average_friction_coefficient, created_at, updated_at)
                  VALUES ('res-{suffix}', 'exp-{suffix}', {friction}, '2026-01-01', '2026-01-01');
                "#,
                weight_a = 100.0 + index as f64,
                weight_b = 900.0 + index as f64,
                logp_a = 1.0 + index as f64 * 0.1,
                logp_b = 9.0 - index as f64 * 0.1,
                friction = 0.05 + index as f64 * 0.001,
            ))
            .expect("blend fixtures should insert");
    }
}

/// Re-records a range of the seeded blends on one concentration basis.
///
/// The three bases are three genuinely different states of the data, so each is written the way a
/// user's workspace would hold it:
///
///  * `wt%` — a value with a mass unit;
///  * `unrecorded` — a value with no unit at all;
///  * `none` — no value, which is what a formulation whose proportions were never written down
///    looks like. Not zero, and not a blank unit: absent.
fn record_basis(connection: &Connection, suffixes: std::ops::Range<usize>, basis: &str) {
    for index in suffixes {
        let suffix = format!("{index:02}");
        let clause = match basis {
            "wt%" => "concentration_unit = 'wt%'".to_string(),
            "unrecorded" => "concentration_unit = ''".to_string(),
            "none" => "concentration_value = NULL, concentration_unit = ''".to_string(),
            other => panic!("unknown basis {other}"),
        };
        connection
            .execute(
                &format!(
                    "UPDATE formulation_components SET {clause} WHERE formulation_id = 'form-{suffix}'"
                ),
                [],
            )
            .expect("basis should be recorded");
    }
}

/// The message codes a dataset report carries, in order.
fn warning_codes(summary: &serde_json::Value) -> Vec<String> {
    summary["report"]["warnings"]
        .as_array()
        .expect("warnings should be an array")
        .iter()
        .map(|warning| {
            warning["code"]
                .as_str()
                .expect("every warning carries a code")
                .to_string()
        })
        .collect()
}

/// Every warning's untranslated diagnostic, joined — what a user would quote asking for help.
fn warning_details(summary: &serde_json::Value) -> String {
    summary["report"]["warnings"]
        .as_array()
        .expect("warnings should be an array")
        .iter()
        .filter_map(|warning| warning["detail"].as_str())
        .collect::<Vec<_>>()
        .join(" ")
}

#[test]
fn an_aggregate_model_can_predict_a_formulation_without_missing_every_wavg_feature() {
    let workspace = Workspace::new("aggregate");
    let connection = workspace.open();
    seed_blends(&connection, "wt%");

    let agreement = aggregate_feature_agreement(&connection, TARGET, "form-05")
        .expect("agreement should build");

    assert_eq!(agreement.row_count, 12, "one row per measured formulation");
    assert!(
        agreement
            .feature_order
            .iter()
            .any(|key| key.starts_with("wavg_")),
        "the aggregate dataset must carry weighted-mean columns: {:?}",
        agreement.feature_order
    );
    assert!(
        agreement.missing.is_empty(),
        "prediction must supply every column training used, but these were missing: {:?}",
        agreement.missing
    );
    assert_eq!(
        agreement.prediction_features.len(),
        agreement.feature_order.len()
    );
    assert_eq!(agreement.training_basis, "wt%");
    assert_eq!(agreement.prediction_basis, "wt%");
    for key in &agreement.feature_order {
        assert_eq!(
            agreement.prediction_features.get(key),
            agreement.training_features.get(key),
            "feature {key} differs between training and prediction"
        );
    }
    // The aggregate really did combine both additives: (100+5)*1 + (900+5)*3 over 4.
    assert_eq!(
        agreement.prediction_features["wavg_rdkit_MolWt"].as_f64(),
        Some((105.0 + 905.0 * 3.0) / 4.0)
    );
    assert_eq!(
        agreement.prediction_features["additive_count"].as_f64(),
        Some(2.0)
    );
    assert_eq!(
        agreement.prediction_features["base_oil_viscosity_40c"].as_f64(),
        Some(32.0)
    );
    workspace.cleanup();
}

#[test]
fn the_additive_dataset_gives_each_additive_its_own_row() {
    let workspace = Workspace::new("additive");
    let connection = workspace.open();
    seed_blends(&connection, "wt%");

    let summary = dataset_summary(&connection, TARGET, "", "additive_component")
        .expect("summary should build");

    assert_eq!(
        summary["rowCount"].as_u64(),
        Some(24),
        "twelve blends, two additives each"
    );
    assert_eq!(
        summary["report"]["multiAdditiveResultCount"].as_u64(),
        Some(12)
    );
    assert_eq!(
        summary["report"]["concentrationBasis"].as_str(),
        Some("wt%")
    );
    // A per-molecule row carries the molecule's own descriptor, never a weighted mean.
    let features = summary["featureOrder"].as_array().expect("feature order");
    assert!(features.iter().any(|key| key == "rdkit_MolWt"));
    assert!(!features
        .iter()
        .any(|key| key.as_str().unwrap_or_default().starts_with("wavg_")));
    workspace.cleanup();
}

#[test]
fn a_workspace_recorded_in_ppm_trains_on_the_same_scale_as_one_recorded_in_weight_percent() {
    let weight_percent = Workspace::new("wtpct");
    seed_blends(&weight_percent.open(), "wt%");
    let in_ppm = Workspace::new("ppm");
    let connection = in_ppm.open();
    seed_blends(&connection, "wt%");
    // The same compositions, re-recorded in ppm: 1 wt% is 10 000 ppm.
    connection
        .execute(
            "UPDATE formulation_components
             SET concentration_value = concentration_value * 10000.0,
                 concentration_unit = 'ppm'",
            [],
        )
        .expect("units should convert");

    let from_percent = aggregate_feature_agreement(&weight_percent.open(), TARGET, "form-03")
        .expect("wt% agreement");
    let from_ppm =
        aggregate_feature_agreement(&connection, TARGET, "form-03").expect("ppm agreement");

    assert_eq!(from_percent.feature_order, from_ppm.feature_order);
    for key in &from_percent.feature_order {
        let left = from_percent.prediction_features[key]
            .as_f64()
            .expect("number");
        let right = from_ppm.prediction_features[key].as_f64().expect("number");
        assert!(
            (left - right).abs() < 1e-9,
            "{key}: {left} (wt%) and {right} (ppm) describe the same blend"
        );
    }
    weight_percent.cleanup();
    in_ppm.cleanup();
}

#[test]
fn blends_recorded_in_mol_percent_are_excluded_and_counted() {
    let workspace = Workspace::new("molpct");
    let connection = workspace.open();
    seed_blends(&connection, "wt%");
    connection
        .execute(
            "UPDATE formulation_components SET concentration_unit = 'mol%'
             WHERE formulation_id IN ('form-00', 'form-01', 'form-02')",
            [],
        )
        .expect("units should change");

    let summary = dataset_summary(&connection, TARGET, "", "formulation_aggregate")
        .expect("summary should build");

    assert_eq!(
        summary["rowCount"].as_u64(),
        Some(9),
        "three blends drop out"
    );
    assert_eq!(
        summary["report"]["excludedIncompatibleUnits"].as_u64(),
        Some(3)
    );
    let warnings = summary["report"]["warnings"].as_array().expect("warnings");
    // The unit the user typed is a parameter and is never translated: "mol%" must reach the
    // screen exactly as it was recorded, whatever language the interface is in.
    assert!(
        warnings
            .iter()
            .any(|warning| warning["params"]["units"] == "mol%"),
        "the warning must name the unit: {warnings:?}"
    );
    assert!(warning_codes(&summary).contains(&"concentration.incompatibleUnits".to_string()));
    workspace.cleanup();
}

#[test]
fn a_blend_mixing_recorded_and_unrecorded_units_is_excluded_and_counted() {
    let workspace = Workspace::new("mixed");
    let connection = workspace.open();
    seed_blends(&connection, "wt%");
    connection
        .execute(
            "UPDATE formulation_components SET concentration_unit = '' WHERE id = 'c-b-00'",
            [],
        )
        .expect("unit should clear");

    let summary = dataset_summary(&connection, TARGET, "", "formulation_aggregate")
        .expect("summary should build");

    assert_eq!(summary["rowCount"].as_u64(), Some(11));
    assert_eq!(summary["report"]["excludedMixedUnits"].as_u64(), Some(1));
    workspace.cleanup();
}

#[test]
fn a_workspace_that_records_no_units_at_all_says_so_rather_than_assuming_weight_percent() {
    let workspace = Workspace::new("nounits");
    let connection = workspace.open();
    seed_blends(&connection, "");

    let summary = dataset_summary(&connection, TARGET, "", "formulation_aggregate")
        .expect("summary should build");

    assert_eq!(
        summary["rowCount"].as_u64(),
        Some(12),
        "the data is still usable"
    );
    assert_eq!(
        summary["report"]["concentrationBasis"].as_str(),
        Some("unrecorded")
    );
    assert!(warning_codes(&summary).contains(&"dataset.unrecordedBasis".to_string()));
    // The English diagnostic travels beside the code rather than instead of it.
    assert!(warning_details(&summary)
        .contains("No component in this dataset records a concentration unit"));
    workspace.cleanup();
}

#[test]
fn the_feature_schema_version_travels_with_the_dataset() {
    let workspace = Workspace::new("schema");
    let connection = workspace.open();
    seed_blends(&connection, "wt%");

    let summary =
        dataset_summary(&connection, TARGET, "", "formulation_aggregate").expect("summary");

    assert!(
        !summary["featureSchemaVersion"]
            .as_str()
            .unwrap_or_default()
            .is_empty(),
        "a model must record which feature definition produced it"
    );
    workspace.cleanup();
}

// --- concentration parity between training and prediction ---------------------------------------

/// The screening scenario: a model fitted from concentration-bearing formulations, then asked
/// about a molecule that is not in any of them.
#[test]
fn a_concentration_trained_model_needs_a_concentration_for_every_candidate() {
    let workspace = Workspace::new("conc-required");
    let connection = workspace.open();
    seed_blends(&connection, "wt%");
    // A library molecule with descriptors but no formulation of its own — exactly what screening
    // ranks.
    connection
        .execute_batch(
            "INSERT INTO molecules (id, name, created_at, updated_at)
               VALUES ('mol-candidate', 'Candidate', '2026-01-01', '2026-01-01');
             INSERT INTO molecule_descriptors
               (id, molecule_id, descriptor_set, descriptors_json, descriptor_count, status, mode,
                calculated_at)
               VALUES ('d-candidate', 'mol-candidate', 'rdkit',
                       '{\"MolWt\": 420.0, \"MolLogP\": 4.0}', 2, 'calculated', 'real',
                       '2026-01-01');",
        )
        .expect("candidate should insert");

    let (feature_order, basis) =
        additive_dataset_shape(&connection, TARGET).expect("the dataset shape reads");
    assert_eq!(basis, ConcentrationBasis::MassPercent);
    assert!(
        feature_order.iter().any(|key| key == "concentration"),
        "the model is fitted with a concentration column: {feature_order:?}"
    );

    // Screening without a concentration: every candidate is skipped, and the reason says why.
    let without = molecule_prediction_row(
        &connection,
        "mol-candidate",
        None,
        "",
        basis,
        &feature_order,
    )
    .expect("the row builds");
    match without {
        MoleculeRow::Skipped { reason, .. } => {
            assert!(
                reason.contains("not comparable") || reason.contains("concentration"),
                "{reason}"
            );
        }
        MoleculeRow::Ready { .. } => panic!("a concentration-trained model must not invent one"),
    }

    // Screening with an explicit concentration and unit: the row is complete.
    let with = molecule_prediction_row(
        &connection,
        "mol-candidate",
        Some(1.5),
        "wt%",
        basis,
        &feature_order,
    )
    .expect("the row builds");
    match with {
        MoleculeRow::Ready { features, .. } => {
            assert_eq!(features["concentration"].as_f64(), Some(1.5));
            assert_eq!(features.len(), feature_order.len());
        }
        MoleculeRow::Skipped { reason, .. } => panic!("expected a complete row, got: {reason}"),
    }
    workspace.cleanup();
}

#[test]
fn a_screening_concentration_is_converted_before_it_is_compared() {
    let workspace = Workspace::new("conc-ppm");
    let connection = workspace.open();
    seed_blends(&connection, "wt%");
    connection
        .execute_batch(
            "INSERT INTO molecules (id, name, created_at, updated_at)
               VALUES ('mol-candidate', 'Candidate', '2026-01-01', '2026-01-01');
             INSERT INTO molecule_descriptors
               (id, molecule_id, descriptor_set, descriptors_json, descriptor_count, status, mode,
                calculated_at)
               VALUES ('d-candidate', 'mol-candidate', 'rdkit',
                       '{\"MolWt\": 420.0, \"MolLogP\": 4.0}', 2, 'calculated', 'real',
                       '2026-01-01');",
        )
        .expect("candidate should insert");
    let (feature_order, basis) = additive_dataset_shape(&connection, TARGET).expect("shape");

    let row = molecule_prediction_row(
        &connection,
        "mol-candidate",
        Some(15_000.0),
        "ppm",
        basis,
        &feature_order,
    )
    .expect("the row builds");

    match row {
        // 15 000 ppm is 1.5 wt%, which is the basis the model was fitted on.
        MoleculeRow::Ready { features, .. } => {
            assert_eq!(features["concentration"].as_f64(), Some(1.5))
        }
        MoleculeRow::Skipped { reason, .. } => panic!("{reason}"),
    }
    workspace.cleanup();
}

#[test]
fn a_screening_concentration_in_an_unconvertible_unit_is_refused_by_name() {
    let workspace = Workspace::new("conc-molpct");
    let connection = workspace.open();
    seed_blends(&connection, "wt%");
    let (feature_order, basis) = additive_dataset_shape(&connection, TARGET).expect("shape");

    let row = molecule_prediction_row(
        &connection,
        "mol-a-00",
        Some(2.0),
        "mol%",
        basis,
        &feature_order,
    )
    .expect("the row builds");

    match row {
        MoleculeRow::Skipped { reason, .. } => assert!(reason.contains("mol%"), "{reason}"),
        MoleculeRow::Ready { .. } => panic!("mol% cannot be converted without a molar mass"),
    }
    workspace.cleanup();
}

#[test]
fn a_negative_or_zero_screening_concentration_is_refused() {
    let workspace = Workspace::new("conc-nonphysical");
    let connection = workspace.open();
    seed_blends(&connection, "wt%");
    let (feature_order, basis) = additive_dataset_shape(&connection, TARGET).expect("shape");

    for value in [-1.0, 0.0] {
        let row = molecule_prediction_row(
            &connection,
            "mol-a-00",
            Some(value),
            "wt%",
            basis,
            &feature_order,
        )
        .expect("the row builds");
        assert!(
            matches!(row, MoleculeRow::Skipped { .. }),
            "{value} is not a concentration a candidate can be present at"
        );
    }
    workspace.cleanup();
}

#[test]
fn a_model_fitted_without_concentrations_refuses_one() {
    let workspace = Workspace::new("conc-none");
    let connection = workspace.open();
    // No component records a concentration anywhere, so the dataset has no concentration column.
    seed_blends(&connection, "wt%");
    connection
        .execute(
            "UPDATE formulation_components SET concentration_value = NULL",
            [],
        )
        .expect("concentrations should clear");

    let (feature_order, basis) = additive_dataset_shape(&connection, TARGET).expect("shape");
    assert_eq!(basis, ConcentrationBasis::None);
    assert!(
        !feature_order.iter().any(|key| key == "concentration"),
        "a model fitted without concentrations has no such column: {feature_order:?}"
    );

    let supplied = molecule_prediction_row(
        &connection,
        "mol-a-00",
        Some(1.0),
        "wt%",
        basis,
        &feature_order,
    )
    .expect("the row builds");
    match supplied {
        MoleculeRow::Skipped { reason, .. } => {
            assert!(reason.contains("not comparable"), "{reason}");
            assert!(reason.contains("none"), "{reason}");
        }
        MoleculeRow::Ready { .. } => {
            panic!("a wt% candidate is not the kind of row this model was fitted on")
        }
    }

    let omitted = molecule_prediction_row(&connection, "mol-a-00", None, "", basis, &feature_order)
        .expect("the row builds");
    assert!(matches!(omitted, MoleculeRow::Ready { .. }));
    workspace.cleanup();
}

// --- cross-category recording ------------------------------------------------------------------

#[test]
fn additive_concentrations_without_base_oil_concentrations_are_excluded() {
    let workspace = Workspace::new("partial-baseoil");
    let connection = workspace.open();
    seed_blends(&connection, "wt%");
    connection
        .execute(
            "UPDATE formulation_components SET concentration_value = NULL
             WHERE component_role = 'base_oil' AND formulation_id IN ('form-00', 'form-01')",
            [],
        )
        .expect("base-oil concentrations should clear");

    let summary = dataset_summary(&connection, TARGET, "", "formulation_aggregate")
        .expect("summary should build");

    assert_eq!(
        summary["rowCount"].as_u64(),
        Some(10),
        "two blends drop out"
    );
    assert_eq!(
        summary["report"]["excludedPartialConcentration"].as_u64(),
        Some(2)
    );
    let warnings = summary["report"]["warnings"].as_array().expect("warnings");
    // The category is a parameter, not a translated word: the sentence is assembled in the
    // frontend, so "base oils" can become "基础油" without the backend knowing.
    assert!(
        warnings.iter().any(|warning| {
            warning["code"] == "concentration.partiallyRecordedAcross"
                && warning["params"]["unrecorded"] == "baseOils"
        }),
        "the warning must name the category that is missing values: {warnings:?}"
    );
    assert!(warning_details(&summary).contains("base oils"));
    workspace.cleanup();
}

#[test]
fn base_oil_concentrations_without_additive_concentrations_are_excluded() {
    let workspace = Workspace::new("partial-additive");
    let connection = workspace.open();
    seed_blends(&connection, "wt%");
    connection
        .execute(
            "UPDATE formulation_components SET concentration_value = NULL
             WHERE component_role = 'additive' AND formulation_id = 'form-03'",
            [],
        )
        .expect("additive concentrations should clear");

    let summary = dataset_summary(&connection, TARGET, "", "formulation_aggregate")
        .expect("summary should build");

    assert_eq!(summary["rowCount"].as_u64(), Some(11));
    assert_eq!(
        summary["report"]["excludedPartialConcentration"].as_u64(),
        Some(1)
    );
    workspace.cleanup();
}

#[test]
fn a_negative_concentration_excludes_its_blend_and_is_counted_apart() {
    let workspace = Workspace::new("negative");
    let connection = workspace.open();
    seed_blends(&connection, "wt%");
    write_as_a_legacy_build_would(
        &connection,
        "UPDATE formulation_components SET concentration_value = -1.0 WHERE id = 'c-a-02'",
    );

    let summary = dataset_summary(&connection, TARGET, "", "formulation_aggregate")
        .expect("summary should build");

    assert_eq!(summary["rowCount"].as_u64(), Some(11));
    assert_eq!(summary["report"]["excludedNonphysical"].as_u64(), Some(1));
    workspace.cleanup();
}

#[test]
fn a_blend_whose_concentrations_are_all_zero_is_excluded() {
    let workspace = Workspace::new("zero");
    let connection = workspace.open();
    seed_blends(&connection, "wt%");
    write_as_a_legacy_build_would(
        &connection,
        "UPDATE formulation_components SET concentration_value = 0.0
         WHERE formulation_id = 'form-05'",
    );

    let summary = dataset_summary(&connection, TARGET, "", "formulation_aggregate")
        .expect("summary should build");

    assert_eq!(summary["rowCount"].as_u64(), Some(11));
    assert_eq!(summary["report"]["excludedNonphysical"].as_u64(), Some(1));
    workspace.cleanup();
}

#[test]
fn a_blend_with_no_base_oil_at_all_still_trains() {
    // An absent category is a shape, not a partially recorded composition.
    let workspace = Workspace::new("no-baseoil");
    let connection = workspace.open();
    seed_blends(&connection, "wt%");
    connection
        .execute(
            "DELETE FROM formulation_components WHERE component_role = 'base_oil'
             AND formulation_id = 'form-09'",
            [],
        )
        .expect("base oil should be removed");

    let summary = dataset_summary(&connection, TARGET, "", "formulation_aggregate")
        .expect("summary should build");

    assert_eq!(
        summary["rowCount"].as_u64(),
        Some(12),
        "no blend is excluded"
    );
    assert_eq!(
        summary["report"]["excludedPartialConcentration"].as_u64(),
        Some(0)
    );
    workspace.cleanup();
}

// --- one basis per dataset ----------------------------------------------------------------------
//
// Three bases exist, so there are three single-basis datasets, three pairs, and one three-way mix.
// All seven are checked, because the rule that was wrong before was wrong only in the cases nobody
// had written down: `wt%` beside `none`, and `unrecorded` beside `none`, both trained happily on a
// concentration column that meant two different things.

/// Builds a workspace whose twelve blends are split across the given bases, and summarises it.
///
/// `slices` names how many of the twelve formulations sit on each basis, in order.
fn dataset_across_bases(name: &str, slices: &[(&str, usize)]) -> (Workspace, serde_json::Value) {
    let workspace = Workspace::new(name);
    let connection = workspace.open();
    seed_blends(&connection, "wt%");
    let mut start = 0;
    for (basis, count) in slices {
        record_basis(&connection, start..start + count, basis);
        start += count;
    }
    assert_eq!(start, 12, "every seeded blend must be assigned a basis");
    let summary = dataset_summary(&connection, TARGET, "", "formulation_aggregate")
        .expect("summary should build");
    (workspace, summary)
}

#[test]
fn a_dataset_recorded_entirely_in_weight_percent_keeps_every_row() {
    let (workspace, summary) = dataset_across_bases("basis-wt", &[("wt%", 12)]);

    assert_eq!(
        summary["report"]["concentrationBasis"].as_str(),
        Some("wt%")
    );
    assert_eq!(summary["rowCount"].as_u64(), Some(12));
    assert_eq!(summary["report"]["excludedOtherBasis"].as_u64(), Some(0));
    // Nothing to warn about: one basis, all rows, no exclusions.
    assert!(warning_codes(&summary).is_empty(), "{summary:?}");
    workspace.cleanup();
}

#[test]
fn a_dataset_recorded_entirely_without_units_keeps_every_row_and_says_so() {
    let (workspace, summary) = dataset_across_bases("basis-unrec", &[("unrecorded", 12)]);

    assert_eq!(
        summary["report"]["concentrationBasis"].as_str(),
        Some("unrecorded")
    );
    assert_eq!(summary["rowCount"].as_u64(), Some(12));
    assert_eq!(summary["report"]["excludedOtherBasis"].as_u64(), Some(0));
    assert_eq!(warning_codes(&summary), vec!["dataset.unrecordedBasis"]);
    workspace.cleanup();
}

#[test]
fn a_dataset_that_records_no_concentrations_keeps_every_row_and_has_no_concentration_column() {
    let (workspace, summary) = dataset_across_bases("basis-none", &[("none", 12)]);

    assert_eq!(
        summary["report"]["concentrationBasis"].as_str(),
        Some("none")
    );
    assert_eq!(summary["rowCount"].as_u64(), Some(12));
    assert_eq!(summary["report"]["excludedOtherBasis"].as_u64(), Some(0));
    assert_eq!(warning_codes(&summary), vec!["dataset.noConcentrations"]);
    // The point of the `none` basis: no concentration was recorded, so none is invented. A
    // total or a weighted mean here would be a number the workspace never measured.
    let features = summary["featureOrder"].as_array().expect("feature order");
    for forbidden in [
        "total_additive_concentration",
        "base_oil_total_concentration",
    ] {
        assert!(
            !features.iter().any(|key| key == forbidden),
            "a dataset with no concentrations must not carry {forbidden}: {features:?}"
        );
    }
    workspace.cleanup();
}

#[test]
fn weight_percent_wins_over_unrecorded_and_the_unrecorded_rows_are_counted() {
    let (workspace, summary) =
        dataset_across_bases("basis-wt-unrec", &[("wt%", 7), ("unrecorded", 5)]);

    assert_eq!(
        summary["report"]["concentrationBasis"].as_str(),
        Some("wt%")
    );
    assert_eq!(summary["rowCount"].as_u64(), Some(7));
    assert_eq!(summary["report"]["excludedOtherBasis"].as_u64(), Some(5));
    let warning = &summary["report"]["warnings"][0];
    assert_eq!(warning["code"], "dataset.excludedOtherBasis");
    assert_eq!(warning["params"]["count"], 5);
    assert_eq!(warning["params"]["excluded"], "unrecorded");
    assert_eq!(warning["params"]["chosen"], "wt%");
    workspace.cleanup();
}

#[test]
fn weight_percent_wins_over_no_concentrations_at_all() {
    // The combination the previous rule let through: it only excluded unit-less rows when mass
    // rows existed, and said nothing at all about rows with no concentration.
    let (workspace, summary) = dataset_across_bases("basis-wt-none", &[("wt%", 8), ("none", 4)]);

    assert_eq!(
        summary["report"]["concentrationBasis"].as_str(),
        Some("wt%")
    );
    assert_eq!(summary["rowCount"].as_u64(), Some(8));
    assert_eq!(summary["report"]["excludedOtherBasis"].as_u64(), Some(4));
    let warning = &summary["report"]["warnings"][0];
    assert_eq!(warning["code"], "dataset.excludedOtherBasis");
    assert_eq!(warning["params"]["count"], 4);
    assert_eq!(warning["params"]["excluded"], "none");
    assert_eq!(warning["params"]["chosen"], "wt%");
    workspace.cleanup();
}

#[test]
fn unrecorded_wins_over_no_concentrations_at_all() {
    // The other combination the previous rule let through.
    let (workspace, summary) =
        dataset_across_bases("basis-unrec-none", &[("unrecorded", 9), ("none", 3)]);

    assert_eq!(
        summary["report"]["concentrationBasis"].as_str(),
        Some("unrecorded")
    );
    assert_eq!(summary["rowCount"].as_u64(), Some(9));
    assert_eq!(summary["report"]["excludedOtherBasis"].as_u64(), Some(3));
    let codes = warning_codes(&summary);
    assert!(
        codes.contains(&"dataset.excludedOtherBasis".to_string()),
        "{codes:?}"
    );
    assert!(
        codes.contains(&"dataset.unrecordedBasis".to_string()),
        "{codes:?}"
    );
    let excluded = summary["report"]["warnings"]
        .as_array()
        .expect("warnings")
        .iter()
        .find(|warning| warning["code"] == "dataset.excludedOtherBasis")
        .expect("the exclusion must be reported");
    assert_eq!(excluded["params"]["excluded"], "none");
    assert_eq!(excluded["params"]["chosen"], "unrecorded");
    workspace.cleanup();
}

#[test]
fn a_three_way_mix_keeps_only_the_most_informative_basis_and_counts_both_others() {
    let (workspace, summary) =
        dataset_across_bases("basis-three", &[("wt%", 5), ("unrecorded", 4), ("none", 3)]);

    assert_eq!(
        summary["report"]["concentrationBasis"].as_str(),
        Some("wt%")
    );
    assert_eq!(summary["rowCount"].as_u64(), Some(5));
    // Both excluded groups are counted, in one total, and reported separately by basis.
    assert_eq!(summary["report"]["excludedOtherBasis"].as_u64(), Some(7));
    let exclusions: Vec<(String, u64)> = summary["report"]["warnings"]
        .as_array()
        .expect("warnings")
        .iter()
        .filter(|warning| warning["code"] == "dataset.excludedOtherBasis")
        .map(|warning| {
            (
                warning["params"]["excluded"].as_str().unwrap().to_string(),
                warning["params"]["count"].as_u64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        exclusions,
        vec![("unrecorded".to_string(), 4), ("none".to_string(), 3)],
        "each excluded basis is named and counted on its own"
    );
    workspace.cleanup();
}

#[test]
fn an_excluded_row_is_never_rescaled_or_imputed_onto_the_chosen_basis() {
    // The exclusion count and the row count must agree exactly: a row that "survived" by being
    // given a concentration it never had would show up here as a row too many.
    let (workspace, summary) = dataset_across_bases("basis-noimpute", &[("wt%", 6), ("none", 6)]);

    let rows = summary["rowCount"].as_u64().expect("row count");
    let excluded = summary["report"]["excludedOtherBasis"]
        .as_u64()
        .expect("exclusions");
    assert_eq!(rows, 6);
    assert_eq!(excluded, 6);
    assert_eq!(rows + excluded, 12, "every seeded blend is accounted for");
    workspace.cleanup();
}

#[test]
fn every_pairwise_and_three_way_basis_combination_settles_on_one_basis() {
    // The property behind the individual cases above, stated once: whatever the mix, the report
    // names exactly one basis, and it is the most informative one present.
    for (name, slices, expected, kept) in [
        ("pair-a", vec![("wt%", 6), ("unrecorded", 6)], "wt%", 6),
        ("pair-b", vec![("wt%", 6), ("none", 6)], "wt%", 6),
        (
            "pair-c",
            vec![("unrecorded", 6), ("none", 6)],
            "unrecorded",
            6,
        ),
        (
            "triple",
            vec![("wt%", 4), ("unrecorded", 4), ("none", 4)],
            "wt%",
            4,
        ),
    ] {
        let (workspace, summary) = dataset_across_bases(name, &slices);
        assert_eq!(
            summary["report"]["concentrationBasis"].as_str(),
            Some(expected),
            "{name} should settle on {expected}"
        );
        assert_eq!(
            summary["rowCount"].as_u64(),
            Some(kept),
            "{name} should keep only the {expected} rows"
        );
        assert_eq!(
            summary["rowCount"].as_u64().unwrap()
                + summary["report"]["excludedOtherBasis"].as_u64().unwrap(),
            12,
            "{name} must account for every blend"
        );
        workspace.cleanup();
    }
}

// --- the exact payloads the frontend sends -------------------------------------------------------
//
// The frontend builds three different request shapes, one per basis, and the difference between
// them is the whole point:
//
//   wt%        → { moleculeId, concentration, concentrationUnit }
//   unrecorded → { moleculeId, concentration }              — no unit key at all
//   none       → { moleculeId }                             — neither
//
// These tests feed each shape to the code the command runs, against a workspace trained on each
// basis, and check all nine combinations. Three are accepted and six are refused by name.

/// The row `molecule_prediction_row` builds for one payload shape against one workspace.
fn prediction_row(
    connection: &Connection,
    basis: ConcentrationBasis,
    feature_order: &[String],
    concentration: Option<f64>,
    unit: &str,
) -> MoleculeRow {
    molecule_prediction_row(
        connection,
        "mol-a-00",
        concentration,
        unit,
        basis,
        feature_order,
    )
    .expect("the row should build or explain itself")
}

/// Builds a workspace on one basis and returns its trained column order and basis.
fn trained_on(name: &str, basis: &str) -> (Workspace, Vec<String>, ConcentrationBasis) {
    let workspace = Workspace::new(name);
    let connection = workspace.open();
    seed_blends(&connection, "wt%");
    record_basis(&connection, 0..12, basis);
    let (feature_order, trained_basis) =
        additive_dataset_shape(&connection, TARGET).expect("the dataset shape should build");
    assert_eq!(
        trained_basis.as_str(),
        basis,
        "{name} settled on the wrong basis"
    );
    (workspace, feature_order, trained_basis)
}

#[test]
fn a_weight_percent_model_accepts_only_the_payload_with_a_unit() {
    let (workspace, order, basis) = trained_on("payload-wt", "wt%");
    let connection = workspace.open();

    // The `wt%` payload: a value and the unit it was measured in.
    match prediction_row(&connection, basis, &order, Some(1.5), "ppm") {
        MoleculeRow::Ready { features, .. } => {
            // 1.5 ppm is 0.00015 wt%, converted before it is compared. The comparison allows
            // for binary floating point: 1.5 * 1e-4 is not exactly representable.
            let converted = features["concentration"].as_f64().expect("a number");
            assert!((converted - 1.5e-4).abs() < 1e-12, "{converted}");
        }
        MoleculeRow::Skipped { reason, .. } => panic!("the wt% payload must be accepted: {reason}"),
    }

    // The `unrecorded` payload, sent to a `wt%` model: a number with no unit is not a proportion.
    match prediction_row(&connection, basis, &order, Some(1.5), "") {
        MoleculeRow::Skipped { message, .. } => {
            assert_eq!(message.code(), "concentration.basisMismatch");
        }
        MoleculeRow::Ready { .. } => panic!("a unit-less value must not be read as weight percent"),
    }

    // The `none` payload: nothing at all, where the model needs something.
    assert!(matches!(
        prediction_row(&connection, basis, &order, None, ""),
        MoleculeRow::Skipped { .. }
    ));
    workspace.cleanup();
}

#[test]
fn a_unit_less_model_accepts_only_the_payload_without_a_unit() {
    let (workspace, order, basis) = trained_on("payload-unrec", "unrecorded");
    let connection = workspace.open();

    // The `unrecorded` payload: a value, and deliberately no unit key.
    match prediction_row(&connection, basis, &order, Some(1.5), "") {
        MoleculeRow::Ready { features, .. } => {
            // Used exactly as stored: there is no conversion to make, and none is invented.
            assert_eq!(features["concentration"].as_f64(), Some(1.5));
        }
        MoleculeRow::Skipped { reason, .. } => {
            panic!("the unit-less payload must be accepted: {reason}")
        }
    }

    // The `wt%` payload sent to a unit-less model: attaching a unit claims a measurement the
    // training data never carried.
    match prediction_row(&connection, basis, &order, Some(1.5), "wt%") {
        MoleculeRow::Skipped { message, .. } => {
            assert_eq!(message.code(), "concentration.basisMismatch");
            assert_eq!(message.to_json()["params"]["found"], "wt%");
            assert_eq!(message.to_json()["params"]["expected"], "unrecorded");
        }
        MoleculeRow::Ready { .. } => panic!("a wt% value must not be read as unit-less"),
    }

    assert!(matches!(
        prediction_row(&connection, basis, &order, None, ""),
        MoleculeRow::Skipped { .. }
    ));
    workspace.cleanup();
}

#[test]
fn a_model_without_concentrations_accepts_only_the_payload_that_sends_none() {
    let (workspace, order, basis) = trained_on("payload-none", "none");
    let connection = workspace.open();

    // The `none` payload: a molecule id and nothing else.
    match prediction_row(&connection, basis, &order, None, "") {
        MoleculeRow::Ready { features, .. } => {
            // No concentration column exists, so none is imputed into one.
            assert!(
                !features.contains_key("concentration"),
                "a model fitted without concentrations must not be handed one: {features:?}"
            );
        }
        MoleculeRow::Skipped { reason, .. } => {
            panic!("the empty payload must be accepted: {reason}")
        }
    }

    // Both other payloads are refused: a number the model was never fitted on cannot improve it.
    for (concentration, unit) in [(Some(1.5), ""), (Some(1.5), "wt%")] {
        match prediction_row(&connection, basis, &order, concentration, unit) {
            MoleculeRow::Skipped { message, .. } => {
                assert_eq!(message.code(), "concentration.basisMismatch");
                assert_eq!(message.to_json()["params"]["expected"], "none");
            }
            MoleculeRow::Ready { .. } => {
                panic!(
                    "a model fitted without concentrations must refuse {concentration:?} {unit:?}"
                )
            }
        }
    }
    workspace.cleanup();
}

#[test]
fn a_candidate_blend_is_buildable_on_every_basis_from_the_payload_the_frontend_sends() {
    use lubricant_materials_database::commands::features::{
        aggregate_features, BaseOilInput, ComponentInput,
    };
    use serde_json::json;

    /// One candidate row, as the aggregate reader builds it from a frontend payload.
    fn component(concentration: Option<f64>, unit: &str) -> ComponentInput {
        ComponentInput {
            molecule_id: "mol-1".to_string(),
            molecule_name: "ZDDP".to_string(),
            concentration,
            concentration_unit: unit.to_string(),
            descriptors: serde_json::from_value(json!({ "rdkit_MolWt": 300.0 })).unwrap(),
            ..ComponentInput::default()
        }
    }
    fn base_oil(concentration: Option<f64>, unit: &str) -> BaseOilInput {
        BaseOilInput {
            properties: [Some(32.0), None, None, None, None, None],
            concentration,
            concentration_unit: unit.to_string(),
        }
    }

    // wt%: value plus unit on every component.
    let (features, basis) = aggregate_features(
        &[component(Some(4.0), "wt%")],
        &[base_oil(Some(96.0), "wt%")],
    )
    .expect("a fully recorded blend resolves");
    assert_eq!(basis, ConcentrationBasis::MassPercent);
    assert_eq!(features["total_additive_concentration"].as_f64(), Some(4.0));

    // unrecorded: values with no unit anywhere.
    let (features, basis) =
        aggregate_features(&[component(Some(4.0), "")], &[base_oil(Some(96.0), "")])
            .expect("a unit-less blend resolves");
    assert_eq!(basis, ConcentrationBasis::Unrecorded);
    assert_eq!(features["total_additive_concentration"].as_f64(), Some(4.0));

    // none: component ids only. The candidate is still constructible, and carries no invented
    // total — which is the property that makes a `none`-basis candidate honest.
    let (features, basis) = aggregate_features(&[component(None, "")], &[base_oil(None, "")])
        .expect("a blend with no concentrations resolves");
    assert_eq!(basis, ConcentrationBasis::None);
    assert!(
        !features.contains_key("total_additive_concentration"),
        "{features:?}"
    );
    assert_eq!(features["additive_count"].as_f64(), Some(1.0));
    assert_eq!(features["base_oil_viscosity_40c"].as_f64(), Some(32.0));

    // Mixing the payload shapes within one candidate is refused rather than half-applied.
    let problem = aggregate_features(&[component(Some(4.0), "wt%")], &[base_oil(Some(96.0), "")])
        .expect_err("a blend cannot be half in weight percent");
    assert_eq!(problem.message_code(), "concentration.mixedBases");

    let problem = aggregate_features(&[component(Some(4.0), "wt%")], &[base_oil(None, "")])
        .expect_err("a blend cannot record only half its composition");
    assert_eq!(
        problem.message_code(),
        "concentration.partiallyRecordedAcross"
    );
}
