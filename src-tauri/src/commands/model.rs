//! Local model training and prediction backed by the packaged Python sidecar.
//!
//! The dataset is assembled here, from SQLite, so the sidecar never touches the database. Only
//! descriptor records that were really calculated take part: training against placeholder values
//! would produce a model that looks trustworthy and is not.
//!
//! Every feature — for training, for the CSV export, and for prediction — is built by
//! [`crate::commands::features`]. That module is the single definition of what a column means, so
//! a prediction cannot be computed from differently-defined inputs than the fit was.

use crate::app_paths::{default_database_path, default_workspace_dir};
use crate::commands::errors::{self, coded};
use crate::commands::features::{
    additive_component_concentration, additive_component_features, aggregate_features,
    numeric_descriptors, order_features, resolve_category, BaseOilInput, CategoryRecording,
    ComponentInput, ConcentrationBasis, ConcentrationCategory, UnitProblem, FEATURE_CONCENTRATION,
    FEATURE_SCHEMA_VERSION,
};
use crate::commands::ok;
use crate::commands::sidecar::{
    run_sidecar_command, runtime_file_path, set_private_file_permissions,
};
use crate::commands::tempfile::TempFile;
use crate::db::open_database;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::fs;
use tauri::AppHandle;
use uuid::Uuid;

/// Mirrors the sidecar's floor so the UI can explain the requirement before a round trip.
const MIN_TRAINING_SAMPLES: usize = 12;
/// A descriptor present in only a handful of rows adds columns without adding signal.
const MIN_FEATURE_COVERAGE: f64 = 0.6;

fn open(app: &AppHandle) -> Result<Connection, String> {
    open_database(default_database_path(app)?)
        .map_err(|err| format!("Failed to open SQLite database for modelling: {err}"))
}

/// How a training dataset interprets a row.
///
/// The two modes answer different scientific questions and must not be confused:
///
/// * `AdditiveComponent` — one row per (performance result, additive component). Each row holds a
///   single molecule's descriptors and that molecule's own concentration, against the performance
///   measured for the formulation it belongs to. A formulation with three additives contributes
///   three rows that share one target. This is a molecule-level predictor: it asks "how does this
///   additive relate to the performance of mixtures containing it", not "what will this exact
///   mixture do".
/// * `FormulationAggregate` — one row per performance result, with descriptors combined across
///   every additive component by concentration-weighted mean, plus base-oil properties and
///   composition summaries. This is the formulation-level predictor.
///
/// Both modes group by `formulation_id` so a mixture never straddles a validation split, and a
/// model records which mode produced it so a prediction cannot be requested in the other shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DatasetMode {
    AdditiveComponent,
    FormulationAggregate,
}

impl DatasetMode {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim() {
            "" | "additive_component" | "molecule" => Ok(Self::AdditiveComponent),
            "formulation_aggregate" | "formulation" => Ok(Self::FormulationAggregate),
            other => Err(format!(
                "Unknown dataset mode '{other}'. Use additive_component or formulation_aggregate."
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::AdditiveComponent => "additive_component",
            Self::FormulationAggregate => "formulation_aggregate",
        }
    }

    /// The translation key for what one row of this dataset means.
    ///
    /// The English text below is stored in the registry, because that column is provenance a
    /// later reader inspects with a database tool; this is what the interface renders.
    fn interpretation_code(self) -> &'static str {
        match self {
            Self::AdditiveComponent => crate::commands::messages::DATASET_INTERPRETATION_ADDITIVE,
            Self::FormulationAggregate => {
                crate::commands::messages::DATASET_INTERPRETATION_AGGREGATE
            }
        }
    }

    /// Plain-language description stored with the model so a later reader knows what a row meant.
    fn interpretation(self) -> &'static str {
        match self {
            Self::AdditiveComponent => {
                "One row per additive component per measured result. Features describe a single \
                 additive molecule and its own concentration; the target is the performance of the \
                 whole formulation containing it. Formulations with several additives contribute \
                 one row each, all grouped together for validation."
            }
            Self::FormulationAggregate => {
                "One row per measured result. Additive descriptors are combined by \
                 concentration-weighted mean across every additive component, alongside base-oil \
                 properties and composition summaries."
            }
        }
    }

    /// What a prediction request must supply for a model of this mode.
    fn prediction_requirement(self) -> &'static str {
        match self {
            Self::AdditiveComponent => {
                "molecule ids with their concentrations (predict_molecule_performance)"
            }
            Self::FormulationAggregate => {
                "stored formulation ids or an explicit candidate formulation \
                 (predict_formulation_performance)"
            }
        }
    }
}

/// One raw join row: a single descriptor set for a single molecule in a single component.
struct RawJoinRow {
    result_id: String,
    component_id: String,
    molecule_id: String,
    molecule_name: String,
    descriptor_set: String,
    descriptors_json: String,
    concentration: Option<f64>,
    concentration_unit: String,
    target: Option<f64>,
    formulation_id: String,
}

/// One training row handed to the sidecar.
struct TrainingRow {
    id: String,
    label: String,
    /// The formulation the measurement came from. Repeated runs of one mixture share this, so the
    /// sidecar can hold whole formulations out of validation instead of splitting them apart.
    group_id: String,
    /// Present for additive-component rows; empty for aggregate rows.
    molecule_id: String,
    features: Map<String, Value>,
    target: f64,
    /// Which concentration basis this row's features were built on.
    basis: ConcentrationBasis,
}

/// What the dataset builder had to leave out, so the caller can explain itself.
#[derive(Debug, Default)]
pub struct DatasetReport {
    pub considered_joins: usize,
    pub result_count: usize,
    pub multi_additive_result_count: usize,
    pub excluded_missing_target: usize,
    pub excluded_no_descriptors: usize,
    /// Concentrations recorded in a unit that cannot be converted without further measurement.
    pub excluded_incompatible_units: usize,
    /// Components in one blend recorded on bases that cannot be compared.
    pub excluded_mixed_units: usize,
    /// Some components carry a concentration and others do not — including across categories.
    pub excluded_partial_concentration: usize,
    /// Negative, non-finite, or all-zero concentrations: values that cannot describe a blend.
    pub excluded_nonphysical: usize,
    /// Rows dropped because the dataset as a whole settled on a different basis.
    pub excluded_other_basis: usize,
    pub basis: ConcentrationBasis,
    /// Messages naming the affected records, for display next to the training result.
    ///
    /// Message descriptors, not sentences: each one carries a code, the values it needs, and the
    /// English prose as untranslated detail. A warning built as a finished sentence here could
    /// only ever appear in English, which is exactly where a user most needs to understand.
    pub warnings: Vec<crate::commands::messages::Message>,
}

impl DatasetReport {
    fn excluded_for_units(&self) -> usize {
        self.excluded_incompatible_units
            + self.excluded_mixed_units
            + self.excluded_partial_concentration
            + self.excluded_nonphysical
            + self.excluded_other_basis
    }

    fn to_json(&self) -> Value {
        json!({
            "consideredJoins": self.considered_joins,
            "resultCount": self.result_count,
            "multiAdditiveResultCount": self.multi_additive_result_count,
            "excludedMissingTarget": self.excluded_missing_target,
            "excludedNoDescriptors": self.excluded_no_descriptors,
            "excludedIncompatibleUnits": self.excluded_incompatible_units,
            "excludedMixedUnits": self.excluded_mixed_units,
            "excludedPartialConcentration": self.excluded_partial_concentration,
            "excludedNonphysical": self.excluded_nonphysical,
            "excludedOtherBasis": self.excluded_other_basis,
            "excludedForUnits": self.excluded_for_units(),
            "concentrationBasis": self.basis.as_str(),
            "warnings": crate::commands::messages::to_json_array(&self.warnings)
        })
    }
}

fn load_raw_join(
    connection: &Connection,
    target_column: &str,
    descriptor_set: &str,
) -> Result<Vec<RawJoinRow>, String> {
    // component_id and molecule_id are selected explicitly: without them, descriptors from two
    // additives in one formulation collapse onto the same feature names.
    let sql = format!(
        "SELECT r.id, c.id, m.id, COALESCE(m.name, m.id), d.descriptor_set, d.descriptors_json,
                c.concentration_value, COALESCE(c.concentration_unit, ''), r.{target_column},
                e.formulation_id
         FROM performance_results r
         JOIN experiments e ON e.id = r.experiment_id
         JOIN formulation_components c ON c.formulation_id = e.formulation_id
         JOIN additives a ON a.id = c.additive_id
         JOIN molecules m ON m.id = a.molecule_id
         JOIN molecule_descriptors d ON d.molecule_id = a.molecule_id
         WHERE d.mode = 'real' AND d.status = 'calculated'
           AND (?1 = '' OR d.descriptor_set = ?1)
         ORDER BY r.id, c.id, d.descriptor_set"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare the training query: {err}"))?;
    let rows = statement
        .query_map(params![descriptor_set], |row| {
            Ok(RawJoinRow {
                result_id: row.get(0)?,
                component_id: row.get(1)?,
                molecule_id: row.get(2)?,
                molecule_name: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                descriptor_set: row.get(4)?,
                descriptors_json: row.get(5)?,
                concentration: row.get(6)?,
                concentration_unit: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                target: row.get(8)?,
                formulation_id: row.get(9)?,
            })
        })
        .map_err(|err| format!("Failed to query training data: {err}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read a training row: {err}"))
}

/// One measured result: its formulation, its target, and the components that fed it.
type ResultBundle = (String, Option<f64>, BTreeMap<String, ComponentInput>);

/// Collects the join into result → component → features, so no molecule's descriptors can be
/// written over another's.
fn collect_components(raw: Vec<RawJoinRow>) -> (BTreeMap<String, ResultBundle>, usize) {
    let considered = raw.len();
    let mut results: BTreeMap<String, ResultBundle> = BTreeMap::new();
    for row in raw {
        let entry = results
            .entry(row.result_id)
            .or_insert_with(|| (row.formulation_id, row.target, BTreeMap::new()));
        let component = entry.2.entry(row.component_id.clone()).or_default();
        component.component_id = row.component_id;
        component.molecule_id = row.molecule_id;
        component.molecule_name = row.molecule_name;
        component.concentration = row.concentration;
        component.concentration_unit = row.concentration_unit;
        // Descriptor sets for the same molecule extend that molecule's own feature map only.
        component.descriptors.extend(numeric_descriptors(
            &row.descriptors_json,
            &row.descriptor_set,
        ));
    }
    (results, considered)
}

/// Base oils of one formulation, in stored order.
fn load_base_oils(
    connection: &Connection,
    formulation_id: &str,
) -> Result<Vec<BaseOilInput>, String> {
    let mut statement = connection
        .prepare(
            "SELECT b.viscosity_40c, b.viscosity_100c, b.viscosity_index, b.density,
                    b.pour_point, b.flash_point, c.concentration_value,
                    COALESCE(c.concentration_unit, '')
             FROM formulation_components c
             JOIN base_oils b ON b.id = c.base_oil_id
             WHERE c.formulation_id = ?1
             ORDER BY c.id",
        )
        .map_err(|err| format!("Failed to prepare the base oil query: {err}"))?;
    let rows = statement
        .query_map(params![formulation_id], |row| {
            Ok(BaseOilInput {
                properties: [
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ],
                concentration: row.get(6)?,
                concentration_unit: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
            })
        })
        .map_err(|err| format!("Failed to query base oils: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read a base oil row: {err}"))?;
    Ok(rows)
}

/// Loads one stored base oil by id, for a candidate formulation the user described by hand.
fn load_base_oil(
    connection: &Connection,
    base_oil_id: &str,
    concentration: Option<f64>,
    unit: &str,
) -> Result<BaseOilInput, String> {
    connection
        .query_row(
            "SELECT viscosity_40c, viscosity_100c, viscosity_index, density, pour_point,
                    flash_point
             FROM base_oils WHERE id = ?1",
            params![base_oil_id],
            |row| {
                Ok(BaseOilInput {
                    properties: [
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                    ],
                    concentration,
                    concentration_unit: unit.to_string(),
                })
            },
        )
        .optional()
        .map_err(|err| format!("Failed to load base oil {base_oil_id}: {err}"))?
        .ok_or_else(|| format!("Base oil not found: {base_oil_id}"))
}

/// Records a unit problem against the report, keeping the counts exact and the messages readable.
fn note_unit_problem(report: &mut DatasetReport, subject: &str, problem: &UnitProblem) {
    match problem {
        UnitProblem::Incompatible { .. } => report.excluded_incompatible_units += 1,
        UnitProblem::MixedBases | UnitProblem::BasisMismatch { .. } => {
            report.excluded_mixed_units += 1
        }
        UnitProblem::PartiallyRecorded { .. } => report.excluded_partial_concentration += 1,
        UnitProblem::NonPhysical { .. } | UnitProblem::ZeroTotal { .. } => {
            report.excluded_nonphysical += 1
        }
    }
    // Naming every affected record would flood the panel; the counts stay exact regardless.
    if report.warnings.len() < 10 {
        report.warnings.push(problem.to_message(subject));
    }
}

/// Builds the training rows for the requested dataset mode.
fn build_training_rows(
    connection: &Connection,
    target_column: &str,
    descriptor_set: &str,
    mode: DatasetMode,
) -> Result<(Vec<TrainingRow>, DatasetReport), String> {
    let raw = load_raw_join(connection, target_column, descriptor_set)?;
    let (results, considered) = collect_components(raw);

    let mut report = DatasetReport {
        considered_joins: considered,
        result_count: results.len(),
        ..DatasetReport::default()
    };
    let mut rows = Vec::new();
    let mut base_oil_cache: BTreeMap<String, Vec<BaseOilInput>> = BTreeMap::new();

    for (result_id, (formulation_id, target, components)) in results {
        if components.len() > 1 {
            report.multi_additive_result_count += 1;
        }
        let Some(target) = target.filter(|value| value.is_finite()) else {
            report.excluded_missing_target += 1;
            continue;
        };
        let ordered: Vec<ComponentInput> = components.into_values().collect();
        match mode {
            DatasetMode::AdditiveComponent => {
                // Each additive is its own row, but the blend's units still have to be consistent:
                // a component measured in mol% cannot sit in the same column as one in wt%.
                let readings: Vec<_> = ordered.iter().map(ComponentInput::reading).collect();
                let recording = match resolve_category(&readings, ConcentrationCategory::Additives)
                {
                    Ok(recording) => recording,
                    Err(problem) => {
                        note_unit_problem(&mut report, &format!("Result {result_id}"), &problem);
                        continue;
                    }
                };
                let (basis, values) = match &recording {
                    CategoryRecording::Values { basis, values } => {
                        (*basis, values.iter().map(|value| Some(*value)).collect())
                    }
                    // Components with no concentration recorded at all: the row carries no
                    // concentration column, which is a different feature set from one that does.
                    _ => (ConcentrationBasis::None, vec![None; ordered.len()]),
                };
                let mut produced = false;
                for (component, concentration) in ordered.iter().zip(values.iter()) {
                    if component.descriptors.is_empty() {
                        continue;
                    }
                    produced = true;
                    rows.push(TrainingRow {
                        // The row id names the exact component it came from, so an exported
                        // dataset can be traced back to a single molecule.
                        id: format!("{result_id}::{}", component.component_id),
                        label: component.molecule_name.clone(),
                        group_id: formulation_id.clone(),
                        molecule_id: component.molecule_id.clone(),
                        features: additive_component_features(component, *concentration),
                        target,
                        basis,
                    });
                }
                if !produced {
                    report.excluded_no_descriptors += 1;
                }
            }
            DatasetMode::FormulationAggregate => {
                if ordered
                    .iter()
                    .all(|component| component.descriptors.is_empty())
                {
                    report.excluded_no_descriptors += 1;
                    continue;
                }
                let base_oils = match base_oil_cache.get(&formulation_id) {
                    Some(cached) => cached.clone(),
                    None => {
                        let loaded = load_base_oils(connection, &formulation_id)?;
                        base_oil_cache.insert(formulation_id.clone(), loaded.clone());
                        loaded
                    }
                };
                let (features, basis) = match aggregate_features(&ordered, &base_oils) {
                    Ok(built) => built,
                    Err(problem) => {
                        note_unit_problem(
                            &mut report,
                            &format!("Formulation {formulation_id}"),
                            &problem,
                        );
                        continue;
                    }
                };
                let mut labels: Vec<String> = ordered
                    .iter()
                    .filter(|component| !component.descriptors.is_empty())
                    .map(|component| component.molecule_name.clone())
                    .collect();
                labels.sort();
                rows.push(TrainingRow {
                    id: result_id,
                    label: labels.join(" + "),
                    group_id: formulation_id.clone(),
                    molecule_id: String::new(),
                    features,
                    target,
                    basis,
                });
            }
        }
    }

    reconcile_dataset_basis(&mut rows, &mut report);
    Ok((rows, report))
}

/// A feature column must mean one thing across the whole dataset.
///
/// Three bases exist, and they are not degrees of the same thing:
///
///  * `wt%` — a real proportion of the blend.
///  * `unrecorded` — a number whose unit nobody wrote down. Comparable with other unit-less
///    numbers from the same workspace, and with nothing else.
///  * `none` — no concentration at all. A row on this basis has no concentration column.
///
/// A dataset may contain rows from exactly one of them. The policy is fixed and documented rather
/// than emergent: the most informative basis present wins, in the order `wt%` > `unrecorded` >
/// `none`, and every row on another basis is excluded and counted.
///
/// The rule this replaces only removed unit-less rows when mass-percent rows were also present.
/// A dataset mixing `wt%` with `none`, or `unrecorded` with `none`, therefore trained happily —
/// and its concentration column meant "1.5 percent by mass" in some rows and "no concentration
/// was recorded" in others, which is not a column at all.
///
/// A `none` row is never given an imputed concentration to make it fit. There is nothing to
/// impute from: the value was not measured, not merely absent from this table.
fn reconcile_dataset_basis(rows: &mut Vec<TrainingRow>, report: &mut DatasetReport) {
    use crate::commands::messages::{self, Message};

    let Some(chosen) = ConcentrationBasis::PREFERENCE_ORDER
        .into_iter()
        .find(|basis| rows.iter().any(|row| row.basis == *basis))
    else {
        // No rows at all. The basis stays at its default and there is nothing to exclude.
        report.basis = ConcentrationBasis::None;
        return;
    };

    for excluded in ConcentrationBasis::PREFERENCE_ORDER {
        if excluded == chosen {
            continue;
        }
        let before = rows.len();
        rows.retain(|row| row.basis != excluded);
        let removed = before - rows.len();
        if removed == 0 {
            continue;
        }
        report.excluded_other_basis += removed;
        report.warnings.push(
            Message::new(messages::DATASET_EXCLUDED_OTHER_BASIS)
                .with("count", removed as u64)
                .with("excluded", excluded.as_str())
                .with("chosen", chosen.as_str())
                .detail(format!(
                    "{removed} record(s) recorded concentrations as '{}' while the dataset settled on '{}'. They were excluded: a single feature column cannot mean both.",
                    excluded.as_str(),
                    chosen.as_str()
                )),
        );
    }

    report.basis = chosen;
    match chosen {
        ConcentrationBasis::Unrecorded => report.warnings.push(
            Message::new(messages::DATASET_UNRECORDED_BASIS).detail(
                "No component in this dataset records a concentration unit. Concentrations are used exactly as stored, which is only meaningful if the whole workspace uses one unit.",
            ),
        ),
        ConcentrationBasis::None => report.warnings.push(
            Message::new(messages::DATASET_NO_CONCENTRATIONS).detail(
                "No record in this dataset carries a concentration, so the model is fitted from descriptors alone and cannot answer a question that names one.",
            ),
        ),
        ConcentrationBasis::MassPercent => {}
    }
}

/// Keeps features present in enough rows to be worth a column, in a stable order.
fn select_feature_order(rows: &[TrainingRow]) -> Vec<String> {
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    for row in rows {
        for key in row.features.keys() {
            *counts.entry(key.clone()).or_default() += 1;
        }
    }
    let threshold = (rows.len() as f64 * MIN_FEATURE_COVERAGE).ceil() as usize;
    counts
        .into_iter()
        .filter(|(_, count)| *count >= threshold.max(1))
        .map(|(key, _)| key)
        .collect()
}

/// The columns an additive-component dataset would produce, and the basis it settled on.
///
/// Exposed so an integration test can build a prediction row exactly as the command does, without
/// having to reproduce the dataset assembly it is meant to be checking.
pub fn additive_dataset_shape(
    connection: &Connection,
    target: &str,
) -> Result<(Vec<String>, ConcentrationBasis), String> {
    let (rows, report) =
        build_training_rows(connection, target, "", DatasetMode::AdditiveComponent)?;
    Ok((select_feature_order(&rows), report.basis))
}

/// What a trained model would use as columns, and what a prediction supplies for one stored
/// formulation, built by the code path the commands use.
///
/// Exposed so an integration test can prove against a real database file that an aggregate model
/// can describe a formulation without reporting its `wavg_*` columns as missing.
#[derive(Debug)]
pub struct AggregateAgreement {
    pub feature_order: Vec<String>,
    pub training_features: Map<String, Value>,
    pub prediction_features: Map<String, Value>,
    /// Columns the model needs that the prediction path could not build. Must be empty.
    pub missing: Vec<String>,
    pub training_basis: String,
    pub prediction_basis: String,
    pub row_count: usize,
}

pub fn aggregate_feature_agreement(
    connection: &Connection,
    target: &str,
    formulation_id: &str,
) -> Result<AggregateAgreement, String> {
    let (rows, report) =
        build_training_rows(connection, target, "", DatasetMode::FormulationAggregate)?;
    let feature_order = select_feature_order(&rows);
    let training_features = rows
        .iter()
        .find(|row| row.group_id == formulation_id)
        .map(|row| row.features.clone())
        .unwrap_or_default();

    let blend = load_stored_formulation(connection, formulation_id)?;
    let (features, basis) = aggregate_features(&blend.components, &blend.base_oils)
        .map_err(|problem| problem.describe(&format!("'{}'", blend.name)))?;
    let (prediction_features, missing) = order_features(&features, &feature_order);

    Ok(AggregateAgreement {
        feature_order,
        training_features,
        prediction_features,
        missing,
        training_basis: report.basis.as_str().to_string(),
        prediction_basis: basis.as_str().to_string(),
        row_count: rows.len(),
    })
}

/// The dataset a training run would build, without training anything.
///
/// Returns the row count, the feature order, and the exclusion report — the numbers a caller needs
/// to explain why a workspace produced fewer rows than it has records.
pub fn dataset_summary(
    connection: &Connection,
    target: &str,
    descriptor_set: &str,
    dataset_mode: &str,
) -> Result<Value, String> {
    let mode = DatasetMode::parse(dataset_mode)?;
    let (rows, report) = build_training_rows(connection, target, descriptor_set, mode)?;
    Ok(json!({
        "rowCount": rows.len(),
        "featureOrder": select_feature_order(&rows),
        "datasetMode": mode.as_str(),
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
        "report": report.to_json()
    }))
}

/// Trains a model for one performance metric and records it in the workspace registry.
#[tauri::command]
pub async fn train_model(
    app: AppHandle,
    target: String,
    algorithm: Option<String>,
    descriptor_set: Option<String>,
    dataset_mode: Option<String>,
    name: Option<String>,
) -> Result<Value, String> {
    // The request is checked first: a target that does not exist, or a mode that is not one of the
    // two, is a malformed request rather than work, and leaves no job behind.
    let (_, label, unit) = crate::commands::analysis::describe_metric(&target)?;
    let descriptor_set = descriptor_set.unwrap_or_default();
    let mode = DatasetMode::parse(dataset_mode.as_deref().unwrap_or_default())?;

    // Everything from here on is tracked, including reading the workspace: a training run that
    // fails because the workspace is too small is still an attempt worth recording, and the guard
    // closes the row on every path.
    let job = crate::commands::jobs::JobGuard::start(
        open(&app)?,
        "train_model",
        0,
        &json!({
            "target": target,
            "descriptorSet": descriptor_set,
            "datasetMode": mode.as_str()
        }),
    )?;

    let connection = open(&app)?;
    let (rows, report) = match build_training_rows(&connection, &target, &descriptor_set, mode) {
        Ok(built) => built,
        Err(err) => {
            job.fail(0, 0, &err)?;
            return Err(err);
        }
    };
    job.set_total(rows.len() as i64)?;

    if rows.len() < MIN_TRAINING_SAMPLES {
        let mut message = format!(
            "Training '{label}' needs at least {MIN_TRAINING_SAMPLES} rows that link an experiment to an additive molecule with real descriptors. This workspace provides {} (from {} candidate joins across {} measured results).",
            rows.len(),
            report.considered_joins,
            report.result_count
        );
        if report.excluded_for_units() > 0 {
            message.push_str(&format!(
                " {} record(s) were excluded because of their concentration units: {}",
                report.excluded_for_units(),
                crate::commands::messages::details(&report.warnings)
            ));
        }
        message.push_str(" Add more experiments with measured results, or calculate RDKit and Mordred descriptors for the molecules already used in formulations.");
        let message = coded(errors::MODEL_NOT_ENOUGH_DATA, message);
        job.fail(0, rows.len() as i64, &message)?;
        return Err(message);
    }

    let feature_order = select_feature_order(&rows);
    if feature_order.is_empty() {
        let message =
            "No descriptor is present in enough records to use as a feature. Calculate descriptors for every molecule used in your experiments and try again."
                .to_string();
        job.fail(0, rows.len() as i64, &message)?;
        return Err(message);
    }

    let model_id = Uuid::new_v4().to_string();
    let relative_path = format!("files/models/{model_id}.joblib");
    let workspace = default_workspace_dir(&app)?;
    let model_path =
        crate::commands::attachments::resolve_in_workspace(&workspace, &relative_path)?;
    if let Some(parent) = model_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create the model directory: {err}"))?;
    }
    // Until the registry row exists the file is unreachable, so it is owned by a guard that
    // removes it — and reports a removal failure — on any early return.
    let mut model_file = TempFile::claim(&model_path);

    let dataset_path = runtime_file_path(&app, "dataset", "json")?;
    let dataset_file = TempFile::claim(&dataset_path);
    let dataset = json!({
        "target": target,
        "dataset_mode": mode.as_str(),
        "interpretation": mode.interpretation(),
        "feature_schema_version": FEATURE_SCHEMA_VERSION,
        "concentration_basis": report.basis.as_str(),
        "feature_order": feature_order,
        "rows": rows
            .iter()
            .map(|row| json!({
                "id": row.id,
                "label": row.label,
                "group_id": row.group_id,
                "molecule_id": row.molecule_id,
                "features": row.features,
                "target": row.target
            }))
            .collect::<Vec<_>>()
    });
    fs::write(
        &dataset_path,
        serde_json::to_vec(&dataset)
            .map_err(|err| format!("Failed to serialize the training dataset: {err}"))?,
    )
    .map_err(|err| format!("Failed to write the training dataset: {err}"))?;
    set_private_file_permissions(&dataset_path)?;

    let outcome = run_sidecar_command(
        &app,
        "train-model",
        json!({
            "dataset_path": dataset_path,
            "model_path": model_path,
            "algorithm": algorithm.unwrap_or_else(|| "auto".to_string()),
            "min_samples": MIN_TRAINING_SAMPLES
        }),
    )
    .await;
    // The staged dataset is temporary either way, and a failure to remove it is reported rather
    // than left for the workspace to accumulate.
    let mut cleanup_failures = dataset_file.discard();

    let response = match outcome {
        Ok(response) => response,
        Err(err) => {
            return Err(abandon_training(job, model_file, err, cleanup_failures));
        }
    };
    let Some(data) = response.get("data").cloned() else {
        return Err(abandon_training(
            job,
            model_file,
            "The sidecar returned no training result.".to_string(),
            cleanup_failures,
        ));
    };

    let trained_at = Utc::now().to_rfc3339();
    let metrics = data.get("metrics").cloned().unwrap_or_else(|| json!({}));
    let trained_features = data
        .get("feature_order")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let registration = connection.execute(
        "INSERT INTO models (
                id, name, target, task, algorithm, model_version, relative_path, feature_order,
                metrics_json, sample_count, feature_count, trained_at, split_method, dataset_mode,
                interpretation, group_count, validated, feature_schema_version,
                concentration_basis, dataset_report_json, notes, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
                       ?18, ?19, ?20, ?21, ?12, ?12)",
        params![
            &model_id,
            name.unwrap_or_else(|| format!("{label} model")),
            &target,
            data.get("task")
                .and_then(Value::as_str)
                .unwrap_or("regression"),
            data.get("algorithm")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            data.get("model_version")
                .and_then(Value::as_str)
                .unwrap_or("1"),
            &relative_path,
            serde_json::to_string(&trained_features).unwrap_or_else(|_| "[]".to_string()),
            metrics.to_string(),
            data.get("sample_count")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
            data.get("feature_count")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
            &trained_at,
            data.get("split_method")
                .and_then(Value::as_str)
                .unwrap_or("unknown"),
            mode.as_str(),
            mode.interpretation(),
            data.get("group_count")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
            i64::from(
                data.get("validated")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            ),
            FEATURE_SCHEMA_VERSION,
            report.basis.as_str(),
            report.to_json().to_string(),
            format!("Unit: {unit}")
        ],
    );
    if let Err(err) = registration {
        return Err(abandon_training(
            job,
            model_file,
            format!("Failed to record the trained model: {err}"),
            cleanup_failures,
        ));
    }
    // The registry now points at the file, so it is no longer temporary.
    model_file.keep();

    let mut warnings: Vec<Value> = response
        .get("warnings")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    warnings.extend(
        report
            .warnings
            .iter()
            .map(crate::commands::messages::Message::to_json),
    );
    warnings.extend(cleanup_failures.drain(..).map(|text| {
        crate::commands::messages::Message::new(crate::commands::messages::DATASET_CLEANUP_FAILED)
            .detail(text)
            .to_json()
    }));

    let summary = json!({
        "modelId": model_id,
        "jobId": job.id(),
        "target": target,
        "label": label,
        "unit": unit,
        "algorithm": data.get("algorithm"),
        "modelVersion": data.get("model_version"),
        "trainedAt": trained_at,
        "sampleCount": data.get("sample_count"),
        "excludedCount": data.get("excluded_count"),
        "featureCount": data.get("feature_count"),
        "featureOrder": trained_features,
        "droppedFeatures": data.get("dropped_features"),
        "datasetMode": mode.as_str(),
        "interpretation": mode.interpretation(),
        "interpretationCode": mode.interpretation_code(),
        "splitMethodMessage": split_method_message(
            data.get("split_method").and_then(Value::as_str).unwrap_or_default()
        ),
        "featureSchemaVersion": FEATURE_SCHEMA_VERSION,
        "concentrationBasis": report.basis.as_str(),
        "multiAdditiveResultCount": report.multi_additive_result_count,
        "resultCount": report.result_count,
        "excludedForUnits": report.excluded_for_units(),
        "datasetReport": report.to_json(),
        "splitMethod": data.get("split_method"),
        "groupCount": data.get("group_count"),
        "validated": data.get("validated"),
        "metrics": metrics,
        "relativePath": relative_path,
        "warnings": warnings,
        "mode": "real"
    });
    job.succeed(rows.len() as i64, 0, &summary)?;
    ok("train_model", summary)
}

/// Closes a failed training run: the unregistered model file goes, the job records the failure,
/// and any cleanup that itself failed is appended to the message rather than dropped.
fn abandon_training(
    job: crate::commands::jobs::JobGuard,
    model_file: TempFile,
    message: String,
    mut cleanup_failures: Vec<String>,
) -> String {
    cleanup_failures.extend(model_file.discard());
    let mut message = message;
    if !cleanup_failures.is_empty() {
        message.push_str(&format!(
            " Some temporary files could not be removed: {}",
            cleanup_failures.join("; ")
        ));
    }
    if let Err(err) = job.fail(0, 0, &message) {
        message.push_str(&format!(
            " The job record could not be closed either: {err}"
        ));
    }
    message
}

/// Turns the sidecar's split-method string into a translatable message.
///
/// The string itself is provenance and stays in the registry unchanged — a model trained by an
/// older build must keep meaning what it meant. This reads it and names the situation, so the
/// panel can say "whole formulations were held out" in the user's language rather than showing
/// `GroupShuffleSplit(test_size=0.25, random_state=42) grouped by formulation`.
///
/// A string this build does not recognise is reported as unknown with the original text attached,
/// which is more useful than a guess and more honest than silence.
fn split_method_message(split_method: &str) -> Value {
    use crate::commands::messages::{self, Message};

    let trimmed = split_method.trim();
    let not_scoreable = trimmed.contains("not scoreable");
    let code = if trimmed.starts_with("GroupShuffleSplit") {
        messages::SPLIT_GROUPED
    } else if trimmed.starts_with("train_test_split") {
        messages::SPLIT_UNGROUPED
    } else if trimmed.starts_with("none") || trimmed.is_empty() {
        messages::SPLIT_NONE
    } else {
        messages::SPLIT_UNKNOWN
    };
    let code = if not_scoreable && code != messages::SPLIT_UNKNOWN {
        messages::SPLIT_NOT_SCOREABLE
    } else {
        code
    };
    Message::new(code).detail(trimmed).to_json()
}

/// A model as stored, including everything a prediction must agree with.
#[derive(Debug)]
struct ModelRow {
    id: String,
    name: String,
    target: String,
    algorithm: String,
    model_version: String,
    relative_path: String,
    feature_order: String,
    metrics_json: String,
    sample_count: i64,
    trained_at: String,
    split_method: String,
    dataset_mode: String,
    interpretation: String,
    feature_schema_version: String,
    concentration_basis: String,
}

const MODEL_COLUMNS: &str = "id, name, target, algorithm, model_version, relative_path, \
                             feature_order, metrics_json, sample_count, trained_at, split_method, \
                             dataset_mode, interpretation, feature_schema_version, \
                             concentration_basis";

fn read_model_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ModelRow> {
    Ok(ModelRow {
        id: row.get(0)?,
        name: row.get(1)?,
        target: row.get(2)?,
        algorithm: row.get(3)?,
        model_version: row.get(4)?,
        relative_path: row.get(5)?,
        feature_order: row.get(6)?,
        metrics_json: row.get(7)?,
        sample_count: row.get(8)?,
        trained_at: row.get(9)?,
        split_method: row.get(10)?,
        dataset_mode: row.get(11)?,
        interpretation: row.get(12)?,
        feature_schema_version: row.get(13)?,
        concentration_basis: row.get(14)?,
    })
}

/// Loads a model by id and checks it can answer the request that was made.
///
/// A model trained on aggregated formulations cannot be asked about a bare molecule, and a model
/// built under an older feature definition cannot be asked at all: both would return a number
/// computed from columns that do not mean what the caller thinks they mean.
fn load_model_for(
    connection: &Connection,
    model_id: &str,
    expected: DatasetMode,
) -> Result<(ModelRow, Vec<String>, ConcentrationBasis), String> {
    let model_id = model_id.trim();
    if model_id.is_empty() {
        return Err(coded(
            errors::MODEL_NOT_CHOSEN,
            "Choose a trained model before predicting; a prediction must name the model it came from.",
        ));
    }
    let model = connection
        .query_row(
            &format!("SELECT {MODEL_COLUMNS} FROM models WHERE id = ?1"),
            params![model_id],
            read_model_row,
        )
        .optional()
        .map_err(|err| format!("Failed to load model {model_id}: {err}"))?
        .ok_or_else(|| {
            coded(
                errors::MODEL_NOT_FOUND,
                format!("Model not found: {model_id}"),
            )
        })?;

    let stored = DatasetMode::parse(&model.dataset_mode)?;
    if stored != expected {
        return Err(coded(errors::MODEL_WRONG_MODE, format!(
            "'{}' was trained as a {} model, so it expects {}. This request supplied {}. Choose a {} model, or train one.",
            model.name,
            stored.as_str(),
            stored.prediction_requirement(),
            expected.prediction_requirement(),
            expected.as_str()
        )));
    }
    if model.feature_schema_version != FEATURE_SCHEMA_VERSION {
        return Err(coded(errors::MODEL_STALE_SCHEMA, format!(
            "'{}' was trained under feature schema {} and this build defines schema {}. The columns no longer mean the same thing, so the model must be retrained before it can predict.",
            model.name, model.feature_schema_version, FEATURE_SCHEMA_VERSION
        )));
    }
    let feature_order: Vec<String> = serde_json::from_str(&model.feature_order).map_err(|err| {
        format!(
            "Stored feature order for '{}' is unreadable: {err}",
            model.name
        )
    })?;
    // A basis this build does not define is not a basis to guess at. Reading it as "unrecorded" —
    // which is what the previous parser did with anything unfamiliar — turns a corrupt row into a
    // usable model whose concentration column means something nobody chose.
    let basis = ConcentrationBasis::parse(&model.concentration_basis).map_err(|stored| {
        coded(
            errors::MODEL_UNKNOWN_BASIS,
            format!(
                "'{}' records its concentration basis as '{stored}', which this build does not define. The model cannot be used; train it again.",
                model.name
            ),
        )
    })?;
    Ok((model, feature_order, basis))
}

fn model_file_path(app: &AppHandle, model: &ModelRow) -> Result<std::path::PathBuf, String> {
    let workspace = default_workspace_dir(app)?;
    let path =
        crate::commands::attachments::resolve_in_workspace(&workspace, &model.relative_path)?;
    if !path.is_file() {
        return Err(coded(
            errors::MODEL_FILE_MISSING,
            format!(
                "The model file for '{}' is missing from the workspace ({}). Train the model again.",
                model.name, model.relative_path
            ),
        ));
    }
    Ok(path)
}

/// Descriptor features for one molecule, built exactly as training builds them.
fn molecule_descriptor_features(
    connection: &Connection,
    molecule_id: &str,
) -> Result<(String, Map<String, Value>), String> {
    let name: Option<String> = connection
        .query_row(
            "SELECT COALESCE(NULLIF(name, ''), id) FROM molecules WHERE id = ?1",
            params![molecule_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| format!("Failed to load molecule {molecule_id}: {err}"))?;
    let Some(name) = name else {
        return Err(format!("Molecule not found: {molecule_id}"));
    };
    let mut statement = connection
        .prepare(
            "SELECT descriptor_set, descriptors_json FROM molecule_descriptors
             WHERE molecule_id = ?1 AND mode = 'real' AND status = 'calculated'
             ORDER BY descriptor_set",
        )
        .map_err(|err| format!("Failed to prepare the feature query: {err}"))?;
    let rows = statement
        .query_map(params![molecule_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|err| format!("Failed to query descriptors for {molecule_id}: {err}"))?;
    let mut features = Map::new();
    for row in rows {
        let (set, descriptors_json) =
            row.map_err(|err| format!("Failed to read a descriptor row: {err}"))?;
        features.extend(numeric_descriptors(&descriptors_json, &set));
    }
    Ok((name, features))
}

/// One molecule a caller wants an additive-component prediction for.
#[derive(Debug)]
struct MoleculeRequest {
    molecule_id: String,
    concentration: Option<f64>,
    concentration_unit: String,
}

fn read_molecule_requests(items: &[Value]) -> Result<Vec<MoleculeRequest>, String> {
    let mut requests = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let molecule_id = item
            .get("moleculeId")
            .or_else(|| item.get("molecule_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("Item {} does not name a molecule.", index + 1))?;
        requests.push(MoleculeRequest {
            molecule_id: molecule_id.to_string(),
            concentration: item
                .get("concentration")
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite()),
            concentration_unit: item
                .get("concentrationUnit")
                .or_else(|| item.get("concentration_unit"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
        });
    }
    Ok(requests)
}

/// Predicts with an additive-component model: one molecule, at one concentration, per item.
#[tauri::command]
pub async fn predict_molecule_performance(
    app: AppHandle,
    model_id: String,
    items: Vec<Value>,
) -> Result<Value, String> {
    if items.is_empty() {
        return Err("Select at least one molecule to predict.".to_string());
    }
    let requests = read_molecule_requests(&items)?;
    let connection = open(&app)?;
    let (model, feature_order, basis) =
        load_model_for(&connection, &model_id, DatasetMode::AdditiveComponent)?;
    let model_path = model_file_path(&app, &model)?;

    let mut payload_items = Vec::new();
    let mut skipped = Vec::new();
    for request in &requests {
        match molecule_prediction_row(
            &connection,
            &request.molecule_id,
            request.concentration,
            &request.concentration_unit,
            basis,
            &feature_order,
        )? {
            MoleculeRow::Ready { label, features } => {
                payload_items.push(
                    json!({ "id": request.molecule_id, "label": label, "features": features }),
                );
            }
            MoleculeRow::Skipped {
                label,
                reason,
                message,
                missing,
            } => skipped.push(json!({
                "id": request.molecule_id,
                "moleculeId": request.molecule_id,
                "label": label,
                "missingCount": missing.len(),
                "missing": missing.iter().take(10).collect::<Vec<_>>(),
                "reason": reason,
                "reasonMessage": message.to_json()
            })),
        }
    }

    if payload_items.is_empty() {
        return Err(coded(errors::MODEL_NOTHING_TO_PREDICT, format!(
            "None of the selected molecules can be described by the {} features this model needs. {}",
            feature_order.len(),
            skipped
                .first()
                .and_then(|item| item.get("reason"))
                .and_then(Value::as_str)
                .unwrap_or("Calculate real descriptors for them first.")
        )));
    }

    run_prediction(&app, &model, &model_path, payload_items, skipped).await
}

/// One molecule, either described well enough to predict on or explained.
#[derive(Debug)]
pub enum MoleculeRow {
    Ready {
        label: String,
        features: Map<String, Value>,
    },
    Skipped {
        label: String,
        /// The English diagnostic, shown as-is beside the translated sentence.
        reason: String,
        /// The same thing as a code and its parameters, so the sentence can be Japanese.
        message: crate::commands::messages::Message,
        missing: Vec<String>,
    },
}

/// Builds the row a molecule contributes to an additive-component prediction.
///
/// The command and the integration tests both come through here, so what the tests check is what
/// the application does. The concentration must be on exactly the basis the model was fitted on:
/// a model fitted from concentration-bearing formulations needs one, and a model fitted without
/// concentrations must not be handed one.
pub fn molecule_prediction_row(
    connection: &Connection,
    molecule_id: &str,
    concentration: Option<f64>,
    concentration_unit: &str,
    basis: ConcentrationBasis,
    feature_order: &[String],
) -> Result<MoleculeRow, String> {
    let (label, descriptors) = molecule_descriptor_features(connection, molecule_id)?;
    let input = ComponentInput {
        molecule_id: molecule_id.to_string(),
        molecule_name: label.clone(),
        concentration,
        concentration_unit: concentration_unit.to_string(),
        descriptors,
        ..ComponentInput::default()
    };

    let concentration = match additive_component_concentration(&input, basis) {
        Ok(value) => value,
        Err(problem) => {
            return Ok(MoleculeRow::Skipped {
                reason: problem.describe_coded(&format!("'{label}'")),
                message: problem.to_message(&label),
                label,
                missing: Vec::new(),
            })
        }
    };

    let features = additive_component_features(&input, concentration);
    let (ordered, missing) = order_features(&features, feature_order);
    if !missing.is_empty() {
        let needs_concentration = missing.iter().any(|key| key == FEATURE_CONCENTRATION);
        let (code, reason) = if needs_concentration {
            (
                crate::commands::messages::SKIPPED_NEEDS_CONCENTRATION,
                "This model uses concentration as a feature; supply a concentration and unit for this molecule.",
            )
        } else {
            (
                crate::commands::messages::SKIPPED_NO_DESCRIPTORS,
                "Real RDKit and Mordred descriptors have not been calculated for this molecule.",
            )
        };
        let message = crate::commands::messages::Message::new(code)
            .with("subject", label.clone())
            .with("missingCount", missing.len() as u64)
            .detail(reason);
        return Ok(MoleculeRow::Skipped {
            label,
            reason: reason.to_string(),
            message,
            missing,
        });
    }
    Ok(MoleculeRow::Ready {
        label,
        features: ordered,
    })
}

/// One candidate blend described by the caller rather than stored in the workspace.
#[derive(Debug)]
struct CandidateFormulation {
    name: String,
    components: Vec<ComponentInput>,
    base_oils: Vec<BaseOilInput>,
}

fn read_candidate(
    connection: &Connection,
    index: usize,
    value: &Value,
) -> Result<CandidateFormulation, String> {
    let position = index + 1;
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("Candidate {position}"));
    let additives = value
        .get("additives")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if additives.is_empty() {
        return Err(format!(
            "Candidate {position} lists no additive components. A formulation-level model needs the whole blend."
        ));
    }
    let mut components = Vec::new();
    for (position_in_blend, additive) in additives.iter().enumerate() {
        let molecule_id = additive
            .get("moleculeId")
            .or_else(|| additive.get("molecule_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| {
                format!(
                    "Additive {} of candidate {position} does not name a molecule.",
                    position_in_blend + 1
                )
            })?;
        let (molecule_name, descriptors) = molecule_descriptor_features(connection, molecule_id)?;
        components.push(ComponentInput {
            component_id: format!("candidate-{position}-{}", position_in_blend + 1),
            molecule_id: molecule_id.to_string(),
            molecule_name,
            concentration: additive
                .get("concentration")
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite()),
            concentration_unit: additive
                .get("concentrationUnit")
                .or_else(|| additive.get("concentration_unit"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            descriptors,
        });
    }
    let mut base_oils = Vec::new();
    for oil in value
        .get("baseOils")
        .or_else(|| value.get("base_oils"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let base_oil_id = oil
            .get("baseOilId")
            .or_else(|| oil.get("base_oil_id"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| format!("A base oil of candidate {position} does not name a record."))?;
        base_oils.push(load_base_oil(
            connection,
            base_oil_id,
            oil.get("concentration")
                .and_then(Value::as_f64)
                .filter(|value| value.is_finite()),
            oil.get("concentrationUnit")
                .or_else(|| oil.get("concentration_unit"))
                .and_then(Value::as_str)
                .unwrap_or_default(),
        )?);
    }
    Ok(CandidateFormulation {
        name,
        components,
        base_oils,
    })
}

/// Reads a stored formulation into the same shape a candidate takes.
fn load_stored_formulation(
    connection: &Connection,
    formulation_id: &str,
) -> Result<CandidateFormulation, String> {
    let name: Option<String> = connection
        .query_row(
            "SELECT COALESCE(NULLIF(name, ''), id) FROM formulations WHERE id = ?1",
            params![formulation_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|err| format!("Failed to load formulation {formulation_id}: {err}"))?;
    let Some(name) = name else {
        return Err(format!("Formulation not found: {formulation_id}"));
    };

    let mut statement = connection
        .prepare(
            "SELECT c.id, m.id, COALESCE(NULLIF(m.name, ''), m.id), c.concentration_value,
                    COALESCE(c.concentration_unit, '')
             FROM formulation_components c
             JOIN additives a ON a.id = c.additive_id
             JOIN molecules m ON m.id = a.molecule_id
             WHERE c.formulation_id = ?1
             ORDER BY c.id",
        )
        .map_err(|err| format!("Failed to prepare the formulation component query: {err}"))?;
    let rows = statement
        .query_map(params![formulation_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<f64>>(3)?,
                row.get::<_, String>(4)?,
            ))
        })
        .map_err(|err| format!("Failed to query formulation components: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read a formulation component: {err}"))?;
    drop(statement);

    let mut components = Vec::new();
    for (component_id, molecule_id, molecule_name, concentration, unit) in rows {
        let (_, descriptors) = molecule_descriptor_features(connection, &molecule_id)?;
        components.push(ComponentInput {
            component_id,
            molecule_id,
            molecule_name,
            concentration,
            concentration_unit: unit,
            descriptors,
        });
    }
    if components.is_empty() {
        return Err(format!(
            "'{name}' has no additive components, so a formulation-level model has nothing to describe."
        ));
    }
    Ok(CandidateFormulation {
        name,
        components,
        base_oils: load_base_oils(connection, formulation_id)?,
    })
}

/// Predicts with a formulation-aggregate model, from stored formulations or candidate blends.
#[tauri::command]
pub async fn predict_formulation_performance(
    app: AppHandle,
    model_id: String,
    formulation_ids: Option<Vec<String>>,
    candidates: Option<Vec<Value>>,
) -> Result<Value, String> {
    let formulation_ids = formulation_ids.unwrap_or_default();
    let candidates = candidates.unwrap_or_default();
    if formulation_ids.is_empty() && candidates.is_empty() {
        return Err(
            "Choose at least one stored formulation, or describe a candidate blend, to predict."
                .to_string(),
        );
    }
    let connection = open(&app)?;
    let (model, feature_order, basis) =
        load_model_for(&connection, &model_id, DatasetMode::FormulationAggregate)?;
    let model_path = model_file_path(&app, &model)?;

    let mut blends: Vec<(String, CandidateFormulation)> = Vec::new();
    for formulation_id in &formulation_ids {
        blends.push((
            formulation_id.clone(),
            load_stored_formulation(&connection, formulation_id)?,
        ));
    }
    for (index, candidate) in candidates.iter().enumerate() {
        blends.push((
            format!("candidate-{}", index + 1),
            read_candidate(&connection, index, candidate)?,
        ));
    }

    let mut payload_items = Vec::new();
    let mut skipped = Vec::new();
    for (id, blend) in &blends {
        let (features, blend_basis) = match aggregate_features(&blend.components, &blend.base_oils)
        {
            Ok(built) => built,
            Err(problem) => {
                skipped.push(json!({
                    "id": id,
                    "label": blend.name,
                    "reason": problem.describe_coded(&format!("'{}'", blend.name)),
                    "reasonMessage": problem.to_message(&blend.name).to_json()
                }));
                continue;
            }
        };
        if !blend_basis.matches(basis) {
            let problem = UnitProblem::BasisMismatch {
                found: blend_basis,
                expected: basis,
            };
            skipped.push(json!({
                "id": id,
                "label": blend.name,
                "reason": problem.describe(&format!("'{}'", blend.name)),
                "reasonMessage": problem.to_message(&blend.name).to_json()
            }));
            continue;
        }
        let (ordered, missing) = order_features(&features, &feature_order);
        if !missing.is_empty() {
            skipped.push(json!({
                "id": id,
                "label": blend.name,
                "missingCount": missing.len(),
                "missing": missing.iter().take(10).collect::<Vec<_>>(),
                "reason": "Some columns this model needs could not be built for this blend. Calculate real descriptors for every additive it contains.",
                "reasonMessage": crate::commands::messages::Message::new(
                    crate::commands::messages::SKIPPED_MISSING_FEATURES,
                )
                .with("subject", blend.name.clone())
                .with("missingCount", missing.len() as u64)
                .detail("Some columns this model needs could not be built for this blend. Calculate real descriptors for every additive it contains.")
                .to_json()
            }));
            continue;
        }
        payload_items.push(json!({ "id": id, "label": blend.name, "features": ordered }));
    }

    if payload_items.is_empty() {
        return Err(coded(errors::MODEL_NOTHING_TO_PREDICT, format!(
            "None of the selected formulations can be described by the {} features this model needs. {}",
            feature_order.len(),
            skipped
                .first()
                .and_then(|item| item.get("reason"))
                .and_then(Value::as_str)
                .unwrap_or("Calculate real descriptors for their additives first.")
        )));
    }

    run_prediction(&app, &model, &model_path, payload_items, skipped).await
}

/// Runs the sidecar and shapes the response the two prediction commands share.
async fn run_prediction(
    app: &AppHandle,
    model: &ModelRow,
    model_path: &std::path::Path,
    items: Vec<Value>,
    skipped: Vec<Value>,
) -> Result<Value, String> {
    let response = run_sidecar_command(
        app,
        "predict-with-model",
        // The schema travels with the request so the sidecar refuses a bundle fitted under another
        // definition, even if the registry row somehow disagrees with the file.
        json!({
            "model_path": model_path,
            "items": items,
            "feature_schema_version": FEATURE_SCHEMA_VERSION
        }),
    )
    .await?;
    let data = response
        .get("data")
        .cloned()
        .ok_or_else(|| "The sidecar returned no prediction result.".to_string())?;

    ok(
        "predict_with_model",
        json!({
            "modelId": model.id,
            "modelName": model.name,
            "target": model.target,
            "algorithm": model.algorithm,
            "modelVersion": model.model_version,
            "trainedAt": model.trained_at,
            "sampleCount": model.sample_count,
            "splitMethod": model.split_method,
            "splitMethodMessage": split_method_message(&model.split_method),
            "datasetMode": model.dataset_mode,
            "interpretation": model.interpretation,
            "interpretationCode": DatasetMode::parse(&model.dataset_mode)
                .map(DatasetMode::interpretation_code)
                .unwrap_or_default(),
            "featureSchemaVersion": model.feature_schema_version,
            "concentrationBasis": model.concentration_basis,
            "metrics": serde_json::from_str::<Value>(&model.metrics_json).unwrap_or_else(|_| json!({})),
            "predictions": data.get("predictions").cloned().unwrap_or_else(|| json!([])),
            "skipped": skipped,
            "mode": "real"
        }),
    )
}

/// Lists trained models, filtered by target and dataset mode.
///
/// A page that can only use one kind of model asks for that kind, so a formulation-level model
/// never appears in a molecule-level picker.
#[tauri::command]
pub fn list_models(
    app: AppHandle,
    target: Option<String>,
    dataset_mode: Option<String>,
) -> Result<Value, String> {
    let connection = open(&app)?;
    let items = model_registry_rows(
        &connection,
        target.as_deref().unwrap_or_default(),
        dataset_mode.as_deref(),
    )?;
    ok("list_models", json!({ "items": items }))
}

/// Every registered model, as the picker sees it.
///
/// Separate from the command so a test can register a row and check how it is presented — which
/// is the only way to prove that a model from an older feature schema is offered as unusable
/// rather than quietly listed beside the current ones.
pub fn model_registry_rows(
    connection: &Connection,
    target: &str,
    dataset_mode: Option<&str>,
) -> Result<Vec<Value>, String> {
    let dataset_mode = match dataset_mode {
        None | Some("") | Some("all") => String::new(),
        Some(value) => DatasetMode::parse(value)?.as_str().to_string(),
    };
    let mut statement = connection
        .prepare(
            "SELECT id, name, target, task, algorithm, model_version, relative_path,
                    feature_order, metrics_json, sample_count, feature_count, trained_at,
                    split_method, dataset_mode, interpretation, group_count, validated,
                    feature_schema_version, concentration_basis, dataset_report_json
             FROM models
             WHERE (?1 = '' OR target = ?1) AND (?2 = '' OR dataset_mode = ?2)
             ORDER BY datetime(trained_at) DESC, trained_at DESC, id DESC",
        )
        .map_err(|err| format!("Failed to prepare the model query: {err}"))?;
    let items = statement
        .query_map(params![target, dataset_mode], |row| {
            let schema_version = row.get::<_, String>(17)?;
            let concentration_basis = row.get::<_, String>(18)?;
            // A basis this build cannot read makes the model unusable, exactly as an outdated
            // feature schema does. Both mean the same thing: the columns cannot be trusted to
            // mean what a prediction would assume, and the honest answer is to retrain.
            let basis_readable = ConcentrationBasis::parse(&concentration_basis).is_ok();
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "target": row.get::<_, String>(2)?,
                "task": row.get::<_, String>(3)?,
                "algorithm": row.get::<_, String>(4)?,
                "modelVersion": row.get::<_, String>(5)?,
                "relativePath": row.get::<_, String>(6)?,
                "featureOrder": serde_json::from_str::<Value>(&row.get::<_, String>(7)?)
                    .unwrap_or_else(|_| json!([])),
                "metrics": serde_json::from_str::<Value>(&row.get::<_, String>(8)?)
                    .unwrap_or_else(|_| json!({})),
                "sampleCount": row.get::<_, i64>(9)?,
                "featureCount": row.get::<_, i64>(10)?,
                "trainedAt": row.get::<_, String>(11)?,
                // Provenance is read from SQLite, so it survives a restart rather than existing
                // only in the response of the training call that created the model.
                "splitMethod": row.get::<_, String>(12)?,
                "datasetMode": row.get::<_, String>(13)?,
                "interpretation": row.get::<_, String>(14)?,
                "interpretationCode": DatasetMode::parse(&row.get::<_, String>(13)?)
                    .map(DatasetMode::interpretation_code)
                    .unwrap_or_default(),
                "splitMethodMessage": split_method_message(&row.get::<_, String>(12)?),
                "groupCount": row.get::<_, i64>(15)?,
                "validated": row.get::<_, i64>(16)? == 1,
                "featureSchemaVersion": schema_version,
                "concentrationBasis": concentration_basis,
                "concentrationBasisReadable": basis_readable,
                // A model from another feature schema is listed, but marked unusable rather than
                // silently offered for a prediction it cannot answer.
                "usable": schema_version == FEATURE_SCHEMA_VERSION && basis_readable,
                "datasetReport": serde_json::from_str::<Value>(&row.get::<_, String>(19)?)
                    .unwrap_or_else(|_| json!({}))
            }))
        })
        .map_err(|err| format!("Failed to query models: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read a model row: {err}"))?;
    Ok(items)
}

#[tauri::command]
pub fn list_model_jobs(app: AppHandle, limit: Option<i64>) -> Result<Value, String> {
    let connection = open(&app)?;
    let items =
        crate::commands::jobs::query_jobs(&connection, &["train_model"], limit.unwrap_or(25))?;
    ok("list_model_jobs", json!({ "items": items }))
}

/// Writes the same joined dataset used for training as a CSV, for use outside LMD.
#[tauri::command]
pub fn export_ml_dataset(
    app: AppHandle,
    target: String,
    descriptor_set: Option<String>,
    dataset_mode: Option<String>,
) -> Result<Value, String> {
    let (_, label, unit) = crate::commands::analysis::describe_metric(&target)?;
    let mode = DatasetMode::parse(dataset_mode.as_deref().unwrap_or_default())?;
    let connection = open(&app)?;
    let (rows, report) = build_training_rows(
        &connection,
        &target,
        &descriptor_set.unwrap_or_default(),
        mode,
    )?;
    if rows.is_empty() {
        let mut message = format!(
            "No record joins a measured {label} to a molecule with real descriptors (checked {} candidate joins across {} results).",
            report.considered_joins, report.result_count
        );
        if report.excluded_for_units() > 0 {
            message.push_str(&format!(
                " {} record(s) were excluded because of their concentration units: {}",
                report.excluded_for_units(),
                crate::commands::messages::details(&report.warnings)
            ));
        }
        return Err(message);
    }
    let feature_order = select_feature_order(&rows);
    // Every row names the component and molecule it came from, so a reader can check that a
    // multi-additive formulation produced separate rows rather than merged features.
    let mut headers = vec![
        "row_id".to_string(),
        "formulation_id".to_string(),
        "molecule_id".to_string(),
        "molecule_name".to_string(),
    ];
    headers.extend(feature_order.iter().cloned());
    headers.push(target.clone());

    let mut lines = vec![crate::commands::export::csv_row(&headers)];
    for row in &rows {
        let mut fields = vec![
            row.id.clone(),
            row.group_id.clone(),
            row.molecule_id.clone(),
            row.label.clone(),
        ];
        // Ordered by the same feature order training uses, so the CSV and the fitted model
        // describe the same columns in the same sequence.
        let (ordered, _) = order_features(&row.features, &feature_order);
        for key in &feature_order {
            fields.push(
                ordered
                    .get(key)
                    .map(|value| match value {
                        Value::Null => String::new(),
                        Value::String(text) => text.clone(),
                        other => other.to_string(),
                    })
                    .unwrap_or_default(),
            );
        }
        fields.push(row.target.to_string());
        lines.push(crate::commands::export::csv_row(&fields));
    }

    let path = crate::commands::export::export_path(
        &app,
        &crate::commands::export::timestamped("ml-dataset"),
    )?;
    fs::write(&path, lines.join("\n"))
        .map_err(|err| format!("Failed to write the ML dataset: {err}"))?;
    ok(
        "export_ml_dataset",
        json!({
            "path": path,
            "row_count": rows.len(),
            "column_count": headers.len(),
            "target": target,
            "label": label,
            "unit": unit,
            "dataset_mode": mode.as_str(),
            "interpretation": mode.interpretation(),
            "interpretation_code": mode.interpretation_code(),
            "feature_schema_version": FEATURE_SCHEMA_VERSION,
            "concentration_basis": report.basis.as_str(),
            "multi_additive_result_count": report.multi_additive_result_count,
            "result_count": report.result_count,
            "excluded_for_units": report.excluded_for_units(),
            "dataset_report": report.to_json(),
            "warnings": crate::commands::messages::to_json_array(&report.warnings),
            "mode": "real"
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::INIT_SCHEMA_SQL;

    fn workspace_with_results(result_count: usize) -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        connection
            .execute_batch(INIT_SCHEMA_SQL)
            .expect("schema should initialize");
        for index in 0..result_count {
            let suffix = format!("{index:03}");
            connection
                .execute_batch(&format!(
                    r#"
                    INSERT INTO molecules (id, name, created_at, updated_at)
                      VALUES ('mol-{suffix}', 'Molecule {suffix}', '2026-01-01', '2026-01-01');
                    INSERT INTO molecule_descriptors
                      (id, molecule_id, descriptor_set, descriptors_json, descriptor_count,
                       status, mode, calculated_at)
                      VALUES ('d-{suffix}', 'mol-{suffix}', 'rdkit',
                              '{{"MolWt": {weight}, "MolLogP": {logp}}}', 2,
                              'calculated', 'real', '2026-01-01');
                    INSERT INTO additives (id, molecule_id, created_at, updated_at)
                      VALUES ('add-{suffix}', 'mol-{suffix}', '2026-01-01', '2026-01-01');
                    INSERT INTO formulations (id, name, created_at, updated_at)
                      VALUES ('form-{suffix}', 'Formulation {suffix}', '2026-01-01', '2026-01-01');
                    INSERT INTO formulation_components
                      (id, formulation_id, component_role, additive_id, concentration_value,
                       concentration_unit)
                      VALUES ('comp-{suffix}', 'form-{suffix}', 'additive', 'add-{suffix}',
                              {conc}, 'wt%');
                    INSERT INTO experiments (id, formulation_id, created_at, updated_at)
                      VALUES ('exp-{suffix}', 'form-{suffix}', '2026-01-01', '2026-01-01');
                    INSERT INTO performance_results
                      (id, experiment_id, average_friction_coefficient, created_at, updated_at)
                      VALUES ('res-{suffix}', 'exp-{suffix}', {friction}, '2026-01-01', '2026-01-01');
                    "#,
                    weight = 100.0 + index as f64,
                    logp = 1.0 + index as f64 * 0.1,
                    conc = 0.5 + (index % 4) as f64 * 0.25,
                    friction = 0.05 + index as f64 * 0.001,
                ))
                .expect("fixtures should insert");
        }
        connection
    }

    #[test]
    fn the_training_join_reaches_results_through_formulations_and_additives() {
        let connection = workspace_with_results(5);

        let (rows, report) = build_training_rows(
            &connection,
            "average_friction_coefficient",
            "",
            DatasetMode::AdditiveComponent,
        )
        .expect("rows");

        assert_eq!(rows.len(), 5);
        assert_eq!(report.considered_joins, 5);
        assert!(rows[0].features.contains_key("rdkit_MolWt"));
        assert!(rows[0].features.contains_key("concentration"));
        assert!(rows[0].target > 0.0);
        assert_eq!(report.basis, ConcentrationBasis::MassPercent);
    }

    #[test]
    fn mock_descriptor_records_never_enter_the_training_set() {
        let connection = workspace_with_results(3);
        connection
            .execute(
                "UPDATE molecule_descriptors SET mode = 'mock' WHERE molecule_id = 'mol-000'",
                [],
            )
            .expect("update should apply");

        let (rows, _) = build_training_rows(
            &connection,
            "average_friction_coefficient",
            "",
            DatasetMode::AdditiveComponent,
        )
        .expect("rows");

        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|row| row.id != "res-000"));
    }

    #[test]
    fn results_without_a_measured_target_are_excluded() {
        let connection = workspace_with_results(4);
        connection
            .execute(
                "UPDATE performance_results SET average_friction_coefficient = NULL WHERE id = 'res-001'",
                [],
            )
            .expect("update should apply");

        let (rows, report) = build_training_rows(
            &connection,
            "average_friction_coefficient",
            "",
            DatasetMode::AdditiveComponent,
        )
        .expect("rows");

        assert_eq!(rows.len(), 3);
        assert_eq!(report.considered_joins, 4);
    }

    #[test]
    fn feature_selection_drops_descriptors_that_are_missing_from_most_records() {
        let connection = workspace_with_results(10);
        connection
            .execute(
                "UPDATE molecule_descriptors SET descriptors_json = '{\"MolWt\": 120.0, \"Rare\": 9.0}' WHERE molecule_id = 'mol-000'",
                [],
            )
            .expect("update should apply");

        let (rows, _) = build_training_rows(
            &connection,
            "average_friction_coefficient",
            "",
            DatasetMode::AdditiveComponent,
        )
        .expect("rows");
        let features = select_feature_order(&rows);

        assert!(features.contains(&"rdkit_MolWt".to_string()));
        // Present in one of ten rows, far below the coverage threshold.
        assert!(!features.contains(&"rdkit_Rare".to_string()));
    }

    #[test]
    fn every_training_row_carries_the_formulation_it_was_measured_on() {
        let connection = workspace_with_results(4);

        let (rows, _) = build_training_rows(
            &connection,
            "average_friction_coefficient",
            "",
            DatasetMode::AdditiveComponent,
        )
        .expect("rows");

        assert_eq!(rows.len(), 4);
        // The group id lets the sidecar hold whole formulations out of validation.
        assert!(rows.iter().all(|row| row.group_id.starts_with("form-")));
        assert_eq!(
            rows.iter()
                .map(|row| row.group_id.clone())
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            4
        );
    }

    #[test]
    fn repeated_measurements_of_one_formulation_share_a_group_id() {
        let connection = workspace_with_results(2);
        // A second run of the same mixture, as a repeat test would produce.
        connection
            .execute_batch(
                r#"
                INSERT INTO experiments (id, formulation_id, created_at, updated_at)
                  VALUES ('exp-repeat', 'form-000', '2026-01-02', '2026-01-02');
                INSERT INTO performance_results
                  (id, experiment_id, average_friction_coefficient, created_at, updated_at)
                  VALUES ('res-repeat', 'exp-repeat', 0.052, '2026-01-02', '2026-01-02');
                "#,
            )
            .expect("repeat run should insert");

        let (rows, _) = build_training_rows(
            &connection,
            "average_friction_coefficient",
            "",
            DatasetMode::AdditiveComponent,
        )
        .expect("rows");

        let repeated: Vec<&TrainingRow> = rows
            .iter()
            .filter(|row| row.group_id == "form-000")
            .collect();
        assert_eq!(
            repeated.len(),
            2,
            "both runs belong to the same formulation group"
        );
    }

    /// A formulation holding two additives with different descriptor values, so any overwrite is
    /// immediately visible.
    fn workspace_with_two_additives() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        connection
            .execute_batch(INIT_SCHEMA_SQL)
            .expect("schema should initialize");
        connection
            .execute_batch(
                r#"
                INSERT INTO molecules (id, name, created_at, updated_at) VALUES
                  ('mol-zddp', 'ZDDP', '2026-01-01', '2026-01-01'),
                  ('mol-modtc', 'MoDTC', '2026-01-01', '2026-01-01');
                INSERT INTO molecule_descriptors
                  (id, molecule_id, descriptor_set, descriptors_json, descriptor_count, status,
                   mode, calculated_at) VALUES
                  ('d-zddp-r', 'mol-zddp', 'rdkit', '{"MolWt": 100.0, "MolLogP": 1.0}', 2,
                   'calculated', 'real', '2026-01-01'),
                  ('d-zddp-m', 'mol-zddp', 'mordred', '{"ABC": 11.0}', 1,
                   'calculated', 'real', '2026-01-01'),
                  ('d-modtc-r', 'mol-modtc', 'rdkit', '{"MolWt": 900.0, "MolLogP": 9.0}', 2,
                   'calculated', 'real', '2026-01-01'),
                  ('d-modtc-m', 'mol-modtc', 'mordred', '{"ABC": 99.0}', 1,
                   'calculated', 'real', '2026-01-01');
                INSERT INTO additives (id, molecule_id, created_at, updated_at) VALUES
                  ('add-zddp', 'mol-zddp', '2026-01-01', '2026-01-01'),
                  ('add-modtc', 'mol-modtc', '2026-01-01', '2026-01-01');
                INSERT INTO base_oils (id, name, viscosity_40c, density, created_at, updated_at)
                  VALUES ('bo-1', 'PAO-6', 32.0, 0.83, '2026-01-01', '2026-01-01');
                INSERT INTO formulations (id, name, created_at, updated_at)
                  VALUES ('form-1', 'Two additive blend', '2026-01-01', '2026-01-01');
                INSERT INTO formulation_components
                  (id, formulation_id, component_role, additive_id, concentration_value,
                   concentration_unit) VALUES
                  ('c-zddp', 'form-1', 'additive', 'add-zddp', 1.0, 'wt%'),
                  ('c-modtc', 'form-1', 'additive', 'add-modtc', 3.0, 'wt%');
                INSERT INTO formulation_components
                  (id, formulation_id, component_role, base_oil_id, concentration_value,
                   concentration_unit)
                  VALUES ('c-bo', 'form-1', 'base_oil', 'bo-1', 96.0, 'wt%');
                INSERT INTO experiments (id, formulation_id, created_at, updated_at)
                  VALUES ('exp-1', 'form-1', '2026-01-01', '2026-01-01');
                INSERT INTO performance_results
                  (id, experiment_id, average_friction_coefficient, created_at, updated_at)
                  VALUES ('res-1', 'exp-1', 0.075, '2026-01-01', '2026-01-01');
                "#,
            )
            .expect("fixtures should insert");
        connection
    }

    #[test]
    fn two_additives_produce_two_rows_and_no_descriptor_is_overwritten() {
        let connection = workspace_with_two_additives();

        let (rows, report) = build_training_rows(
            &connection,
            "average_friction_coefficient",
            "",
            DatasetMode::AdditiveComponent,
        )
        .expect("rows");

        assert_eq!(rows.len(), 2, "each additive component gets its own row");
        assert_eq!(report.multi_additive_result_count, 1);

        let zddp = rows
            .iter()
            .find(|row| row.molecule_id == "mol-zddp")
            .expect("ZDDP row");
        let modtc = rows
            .iter()
            .find(|row| row.molecule_id == "mol-modtc")
            .expect("MoDTC row");

        // Each row carries only its own molecule's descriptors, at its own concentration.
        assert_eq!(zddp.features["rdkit_MolWt"].as_f64(), Some(100.0));
        assert_eq!(zddp.features["mordred_ABC"].as_f64(), Some(11.0));
        assert_eq!(zddp.features["concentration"].as_f64(), Some(1.0));
        assert_eq!(zddp.label, "ZDDP");

        assert_eq!(modtc.features["rdkit_MolWt"].as_f64(), Some(900.0));
        assert_eq!(modtc.features["mordred_ABC"].as_f64(), Some(99.0));
        assert_eq!(modtc.features["concentration"].as_f64(), Some(3.0));
        assert_eq!(modtc.label, "MoDTC");

        // Both rows share the measured target and the formulation group.
        assert!((zddp.target - 0.075).abs() < 1e-9);
        assert!((modtc.target - 0.075).abs() < 1e-9);
        assert_eq!(zddp.group_id, "form-1");
        assert_eq!(modtc.group_id, "form-1");
        // Row ids are distinct and name the component they came from.
        assert_ne!(zddp.id, modtc.id);
        assert!(zddp.id.contains("c-zddp"));
        assert!(modtc.id.contains("c-modtc"));
    }

    #[test]
    fn the_aggregate_dataset_combines_additives_by_concentration_weight() {
        let connection = workspace_with_two_additives();

        let (rows, _) = build_training_rows(
            &connection,
            "average_friction_coefficient",
            "",
            DatasetMode::FormulationAggregate,
        )
        .expect("rows");

        assert_eq!(rows.len(), 1, "the whole mixture is one row");
        let row = &rows[0];
        // (100*1 + 900*3) / 4 = 700
        assert_eq!(row.features["wavg_rdkit_MolWt"].as_f64(), Some(700.0));
        // (1*1 + 9*3) / 4 = 7
        assert_eq!(row.features["wavg_rdkit_MolLogP"].as_f64(), Some(7.0));
        // (11*1 + 99*3) / 4 = 77. The un-prefixed key must not exist: an aggregate is not a
        // per-molecule descriptor and must not be mistaken for one.
        assert!(row.features.get("mordred_ABC").is_none());
        assert_eq!(row.features["wavg_mordred_ABC"].as_f64(), Some(77.0));
        assert_eq!(row.features["additive_count"].as_f64(), Some(2.0));
        assert_eq!(
            row.features["total_additive_concentration"].as_f64(),
            Some(4.0)
        );
        // Base-oil properties belong to the formulation-level view.
        assert_eq!(row.features["base_oil_viscosity_40c"].as_f64(), Some(32.0));
        assert_eq!(row.features["base_oil_density"].as_f64(), Some(0.83));
        assert_eq!(row.label, "MoDTC + ZDDP");
    }

    #[test]
    fn the_aggregate_dataset_is_deterministic_across_runs() {
        let connection = workspace_with_two_additives();

        let first = build_training_rows(
            &connection,
            "average_friction_coefficient",
            "",
            DatasetMode::FormulationAggregate,
        )
        .expect("rows")
        .0;
        let second = build_training_rows(
            &connection,
            "average_friction_coefficient",
            "",
            DatasetMode::FormulationAggregate,
        )
        .expect("rows")
        .0;

        assert_eq!(first[0].features, second[0].features);
        assert_eq!(first[0].label, second[0].label);
    }

    #[test]
    fn a_result_without_a_measured_target_is_counted_as_excluded() {
        let connection = workspace_with_two_additives();
        connection
            .execute(
                "UPDATE performance_results SET average_friction_coefficient = NULL",
                [],
            )
            .expect("update should apply");

        let (rows, report) = build_training_rows(
            &connection,
            "average_friction_coefficient",
            "",
            DatasetMode::AdditiveComponent,
        )
        .expect("rows");

        assert!(rows.is_empty());
        assert_eq!(report.excluded_missing_target, 1);
    }

    #[test]
    fn dataset_modes_parse_from_their_public_names() {
        assert_eq!(
            DatasetMode::parse("").unwrap(),
            DatasetMode::AdditiveComponent
        );
        assert_eq!(
            DatasetMode::parse("formulation_aggregate").unwrap(),
            DatasetMode::FormulationAggregate
        );
        assert!(DatasetMode::parse("nonsense").is_err());
    }

    #[test]
    fn a_blend_recorded_in_mol_percent_is_excluded_and_explained() {
        let connection = workspace_with_two_additives();
        connection
            .execute(
                "UPDATE formulation_components SET concentration_unit = 'mol%' WHERE id = 'c-modtc'",
                [],
            )
            .expect("update should apply");

        let (rows, report) = build_training_rows(
            &connection,
            "average_friction_coefficient",
            "",
            DatasetMode::FormulationAggregate,
        )
        .expect("rows");

        assert!(rows.is_empty(), "an unconvertible unit is never guessed at");
        assert_eq!(report.excluded_incompatible_units, 1);
        assert!(report
            .warnings
            .iter()
            .any(|warning| warning.code() == "concentration.incompatibleUnits"));
        assert!(crate::commands::messages::details(&report.warnings).contains("mol%"));
    }

    #[test]
    fn ppm_and_weight_percent_components_train_on_one_scale() {
        let connection = workspace_with_two_additives();
        // 30 000 ppm is 3 wt%: exactly what the blend already records, on another scale.
        connection
            .execute(
                "UPDATE formulation_components
                 SET concentration_value = 30000.0, concentration_unit = 'ppm'
                 WHERE id = 'c-modtc'",
                [],
            )
            .expect("update should apply");

        let (rows, report) = build_training_rows(
            &connection,
            "average_friction_coefficient",
            "",
            DatasetMode::FormulationAggregate,
        )
        .expect("rows");

        assert_eq!(rows.len(), 1);
        assert_eq!(report.excluded_incompatible_units, 0);
        // Identical to the all-wt% blend, because it is the same composition.
        assert_eq!(rows[0].features["wavg_rdkit_MolWt"].as_f64(), Some(700.0));
        assert_eq!(
            rows[0].features["total_additive_concentration"].as_f64(),
            Some(4.0)
        );
    }

    #[test]
    fn a_blend_mixing_a_recorded_unit_with_a_missing_one_is_excluded() {
        let connection = workspace_with_two_additives();
        connection
            .execute(
                "UPDATE formulation_components SET concentration_unit = '' WHERE id = 'c-modtc'",
                [],
            )
            .expect("update should apply");

        let (_, report) = build_training_rows(
            &connection,
            "average_friction_coefficient",
            "",
            DatasetMode::FormulationAggregate,
        )
        .expect("rows");

        assert_eq!(report.excluded_mixed_units, 1);
        assert!(report
            .warnings
            .iter()
            .any(|warning| warning.code() == "concentration.mixedBases"));
        assert!(crate::commands::messages::details(&report.warnings)
            .contains("Record a unit for every component"));
    }

    #[test]
    fn a_dataset_recording_no_unit_at_all_says_so_rather_than_assuming_one() {
        let connection = workspace_with_results(3);
        connection
            .execute(
                "UPDATE formulation_components SET concentration_unit = ''",
                [],
            )
            .expect("update should apply");

        let (rows, report) = build_training_rows(
            &connection,
            "average_friction_coefficient",
            "",
            DatasetMode::AdditiveComponent,
        )
        .expect("rows");

        assert_eq!(rows.len(), 3);
        assert_eq!(report.basis, ConcentrationBasis::Unrecorded);
        assert!(report
            .warnings
            .iter()
            .any(|warning| warning.code() == crate::commands::messages::DATASET_UNRECORDED_BASIS));
    }

    #[test]
    fn a_dataset_mixing_unit_bases_keeps_the_recorded_rows_and_counts_the_rest() {
        let connection = workspace_with_results(4);
        connection
            .execute(
                "UPDATE formulation_components SET concentration_unit = ''
                 WHERE formulation_id IN ('form-000', 'form-001')",
                [],
            )
            .expect("update should apply");

        let (rows, report) = build_training_rows(
            &connection,
            "average_friction_coefficient",
            "",
            DatasetMode::AdditiveComponent,
        )
        .expect("rows");

        assert_eq!(rows.len(), 2, "only the wt% rows survive");
        assert_eq!(report.excluded_other_basis, 2);
        assert_eq!(report.basis, ConcentrationBasis::MassPercent);
    }

    #[test]
    fn a_stored_formulation_reads_back_into_the_same_shape_a_candidate_takes() {
        let connection = workspace_with_two_additives();

        let blend = load_stored_formulation(&connection, "form-1").expect("formulation loads");

        assert_eq!(blend.name, "Two additive blend");
        assert_eq!(blend.components.len(), 2);
        assert_eq!(blend.base_oils.len(), 1);
        assert_eq!(blend.base_oils[0].properties[0], Some(32.0));
        assert!(blend
            .components
            .iter()
            .all(|component| !component.descriptors.is_empty()));
    }

    /// The property that makes an aggregate prediction usable at all: the features built for a
    /// stored formulation are the ones the training rows carry, name for name and value for value.
    #[test]
    fn predicting_on_a_stored_formulation_reproduces_the_training_features_exactly() {
        let connection = workspace_with_two_additives();

        let (rows, _) = build_training_rows(
            &connection,
            "average_friction_coefficient",
            "",
            DatasetMode::FormulationAggregate,
        )
        .expect("rows");
        let feature_order = select_feature_order(&rows);
        assert!(
            feature_order.iter().any(|key| key.starts_with("wavg_")),
            "the aggregate dataset must actually carry wavg_* columns"
        );

        let blend = load_stored_formulation(&connection, "form-1").expect("formulation loads");
        let (features, basis) =
            aggregate_features(&blend.components, &blend.base_oils).expect("blend resolves");
        let (ordered, missing) = order_features(&features, &feature_order);

        assert!(
            missing.is_empty(),
            "no wavg_* feature may be reported as missing: {missing:?}"
        );
        assert_eq!(ordered.len(), feature_order.len());
        assert_eq!(basis, ConcentrationBasis::MassPercent);
        for key in &feature_order {
            assert_eq!(
                ordered.get(key),
                rows[0].features.get(key),
                "feature {key} differs between training and prediction"
            );
        }
    }

    #[test]
    fn a_candidate_blend_described_by_hand_produces_the_same_features_as_the_stored_one() {
        let connection = workspace_with_two_additives();
        let candidate = json!({
            "name": "Hand-written candidate",
            "additives": [
                { "moleculeId": "mol-zddp", "concentration": 1.0, "concentrationUnit": "wt%" },
                { "moleculeId": "mol-modtc", "concentration": 3.0, "concentrationUnit": "wt%" }
            ],
            "baseOils": [
                { "baseOilId": "bo-1", "concentration": 96.0, "concentrationUnit": "wt%" }
            ]
        });

        let described = read_candidate(&connection, 0, &candidate).expect("candidate reads");
        let stored = load_stored_formulation(&connection, "form-1").expect("formulation loads");

        let (from_candidate, _) =
            aggregate_features(&described.components, &described.base_oils).expect("resolves");
        let (from_stored, _) =
            aggregate_features(&stored.components, &stored.base_oils).expect("resolves");

        assert_eq!(from_candidate, from_stored);
        assert_eq!(described.name, "Hand-written candidate");
    }

    #[test]
    fn a_candidate_without_additives_is_refused_rather_than_predicted_on() {
        let connection = workspace_with_two_additives();
        let error = read_candidate(&connection, 0, &json!({ "name": "Empty" }))
            .expect_err("an empty candidate must be refused");
        assert!(error.contains("no additive components"), "{error}");
    }

    fn register_model(connection: &Connection, id: &str, mode: DatasetMode, schema: &str) {
        connection
            .execute(
                "INSERT INTO models (
                    id, name, target, task, algorithm, model_version, relative_path, feature_order,
                    metrics_json, sample_count, feature_count, trained_at, split_method,
                    dataset_mode, interpretation, group_count, validated, feature_schema_version,
                    concentration_basis, dataset_report_json, created_at, updated_at
                 ) VALUES (?1, ?1, 'average_friction_coefficient', 'regression', 'ridge', '1',
                           'files/models/x.joblib', '[\"rdkit_MolWt\"]', '{}', 12, 1,
                           '2026-01-01', 'none', ?2, '', 1, 1, ?3, 'wt%', '{}', '2026-01-01',
                           '2026-01-01')",
                params![id, mode.as_str(), schema],
            )
            .expect("model row should insert");
    }

    #[test]
    fn a_prediction_must_name_the_model_it_came_from() {
        let connection = workspace_with_two_additives();
        let error = load_model_for(&connection, "  ", DatasetMode::AdditiveComponent)
            .expect_err("an unnamed model must be refused");
        assert!(error.contains("name the model"), "{error}");
    }

    #[test]
    fn a_formulation_model_refuses_a_molecule_level_request() {
        let connection = workspace_with_two_additives();
        register_model(
            &connection,
            "m-agg",
            DatasetMode::FormulationAggregate,
            FEATURE_SCHEMA_VERSION,
        );

        let error = load_model_for(&connection, "m-agg", DatasetMode::AdditiveComponent)
            .expect_err("the modes must not be interchangeable");

        assert!(error.contains("formulation_aggregate"), "{error}");
        assert!(error.contains("molecule ids"), "{error}");
    }

    #[test]
    fn a_molecule_model_refuses_a_formulation_level_request() {
        let connection = workspace_with_two_additives();
        register_model(
            &connection,
            "m-add",
            DatasetMode::AdditiveComponent,
            FEATURE_SCHEMA_VERSION,
        );

        let error = load_model_for(&connection, "m-add", DatasetMode::FormulationAggregate)
            .expect_err("the modes must not be interchangeable");

        assert!(error.contains("additive_component"), "{error}");
    }

    #[test]
    fn a_model_from_an_older_feature_schema_is_refused_rather_than_reinterpreted() {
        let connection = workspace_with_two_additives();
        register_model(&connection, "m-old", DatasetMode::AdditiveComponent, "1");

        let error = load_model_for(&connection, "m-old", DatasetMode::AdditiveComponent)
            .expect_err("an older schema must be refused");

        assert!(error.contains("retrained"), "{error}");
    }

    #[test]
    fn a_model_of_the_current_schema_and_matching_mode_loads() {
        let connection = workspace_with_two_additives();
        register_model(
            &connection,
            "m-ok",
            DatasetMode::AdditiveComponent,
            FEATURE_SCHEMA_VERSION,
        );

        let (model, feature_order, basis) =
            load_model_for(&connection, "m-ok", DatasetMode::AdditiveComponent)
                .expect("the model loads");

        assert_eq!(model.id, "m-ok");
        assert_eq!(feature_order, vec!["rdkit_MolWt".to_string()]);
        assert_eq!(basis, ConcentrationBasis::MassPercent);
    }

    #[test]
    fn every_schema_three_model_is_listed_as_needing_retraining() {
        // Schema 3 admitted datasets that mixed `wt%` with `none`, or `unrecorded` with `none`.
        // A model fitted from those rows was fitted on a column that meant two things, and there
        // is no way to tell from the model which rows were which — so every one of them must be
        // offered as unusable, not merely the ones from a mixed workspace.
        let connection = workspace_with_two_additives();
        register_model(
            &connection,
            "m-schema-3",
            DatasetMode::AdditiveComponent,
            "3",
        );
        register_model(
            &connection,
            "m-current",
            DatasetMode::AdditiveComponent,
            FEATURE_SCHEMA_VERSION,
        );

        let rows = model_registry_rows(&connection, "average_friction_coefficient", None)
            .expect("the registry lists both models");

        let stale = rows
            .iter()
            .find(|row| row["id"] == "m-schema-3")
            .expect("the older model is still listed");
        assert_eq!(stale["usable"], false);
        assert_eq!(stale["featureSchemaVersion"], "3");
        let current = rows
            .iter()
            .find(|row| row["id"] == "m-current")
            .expect("the current model is listed");
        assert_eq!(current["usable"], true);

        let error = load_model_for(&connection, "m-schema-3", DatasetMode::AdditiveComponent)
            .expect_err("a schema-3 model must not predict");
        assert!(error.starts_with("[model.staleSchema]"), "{error}");
    }

    #[test]
    fn a_model_recording_an_unreadable_basis_is_unusable_rather_than_reinterpreted() {
        let connection = workspace_with_two_additives();
        register_model(
            &connection,
            "m-corrupt",
            DatasetMode::AdditiveComponent,
            FEATURE_SCHEMA_VERSION,
        );
        connection
            .execute(
                "UPDATE models SET concentration_basis = 'wt' WHERE id = 'm-corrupt'",
                [],
            )
            .expect("basis should update");

        let rows = model_registry_rows(&connection, "average_friction_coefficient", None)
            .expect("the registry lists the model");
        let row = rows
            .iter()
            .find(|row| row["id"] == "m-corrupt")
            .expect("listed");
        assert_eq!(row["usable"], false);
        assert_eq!(row["concentrationBasisReadable"], false);
        // The stored value is shown as-is rather than repaired into something plausible.
        assert_eq!(row["concentrationBasis"], "wt");

        let error = load_model_for(&connection, "m-corrupt", DatasetMode::AdditiveComponent)
            .expect_err("an unreadable basis must not be guessed at");
        assert!(error.starts_with("[model.unknownBasis]"), "{error}");
    }

    #[test]
    fn the_three_payload_shapes_the_frontend_sends_are_read_as_written() {
        // The frontend builds one shape per concentration basis, and the difference between them
        // is what tells this reader which basis the caller believes it is on. Reading an absent
        // `concentrationUnit` as anything other than "no unit" would collapse two of them.
        let requests = read_molecule_requests(&[
            json!({ "moleculeId": "m-1", "concentration": 1.5, "concentrationUnit": "ppm" }),
            json!({ "moleculeId": "m-2", "concentration": 1.5 }),
            json!({ "moleculeId": "m-3" }),
        ])
        .expect("every shape is a valid request");

        assert_eq!(requests[0].concentration, Some(1.5));
        assert_eq!(requests[0].concentration_unit, "ppm");
        // No unit key: a number on a scale nobody wrote down.
        assert_eq!(requests[1].concentration, Some(1.5));
        assert_eq!(requests[1].concentration_unit, "");
        // Neither key: a model fitted without concentrations.
        assert_eq!(requests[2].concentration, None);
        assert_eq!(requests[2].concentration_unit, "");
    }

    #[test]
    fn a_non_finite_concentration_in_a_payload_is_read_as_absent() {
        // JSON cannot carry NaN, but a `null` and a missing key both arrive here, and neither is
        // a measurement. Reading either as a number would put a fabricated value in a feature.
        let requests = read_molecule_requests(&[
            json!({ "moleculeId": "m-1", "concentration": null }),
            json!({ "moleculeId": "m-2", "concentration": "1.5" }),
        ])
        .expect("both are valid requests");
        assert_eq!(requests[0].concentration, None);
        assert_eq!(requests[1].concentration, None);
    }

    #[test]
    fn a_molecule_request_must_name_a_molecule() {
        let error = read_molecule_requests(&[json!({ "concentration": 1.0 })])
            .expect_err("an unnamed molecule must be refused");
        assert!(error.contains("does not name a molecule"), "{error}");

        let requests = read_molecule_requests(&[
            json!({ "moleculeId": "m-1", "concentration": 1.5, "concentrationUnit": "wt%" }),
            json!({ "molecule_id": "m-2" }),
        ])
        .expect("well-formed requests read");
        assert_eq!(requests.len(), 2);
        assert_eq!(requests[0].concentration, Some(1.5));
        assert_eq!(requests[0].concentration_unit, "wt%");
        assert_eq!(requests[1].concentration, None);
    }
}
