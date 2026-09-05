//! Molecular design: optional-template generation, a persistent candidate collection, and
//! prediction with the evidence needed to judge it.
//!
//! The workflow is organised around three independent dimensions, and the code keeps them apart:
//!
//!  * **Chemical class** — the template and substituent rules that bound what may be generated.
//!    The sidecar enumerates and validates; this module records what came back.
//!  * **Target function / property** — the measured outcome a designer wants to optimise. It is
//!    the *intent* of a request. A generated structure has no measured property; the intent is
//!    stored beside it, never as a tag or a role on the structure itself.
//!  * **Application conditions** — base oil, concentration, other components, test conditions. A
//!    prediction is assessed for one candidate against one model in one context, and the
//!    assessment says which of these conditions the model actually accounts for.
//!
//! Generated candidates live in `design_candidates`, apart from `molecules`. Nothing here writes
//! a molecule row except [`promote_design_candidate`], which a person invokes on one candidate.
//! Predictions live in `design_predictions` and are never read by the dataset builder, so a
//! predicted value cannot become a training label.
//!
//! A candidate absent from this workspace is reported as *not in the library*. That is a fact about
//! the workspace, not a claim of novelty, and the interface is expected to say so.

use crate::app_paths::default_database_path;
use crate::commands::errors::{self, coded};
use crate::commands::features::{
    additive_component_concentration, additive_component_features, numeric_descriptors,
    order_features, read_load_newtons, read_temperature_celsius, ComponentInput,
    ConcentrationBasis, ConditionInput, UnitProblem, CONDITION_FEATURES, FEATURE_CONDITION_LOAD,
    FEATURE_CONDITION_TEMPERATURE, FEATURE_SCHEMA_VERSION,
};
use crate::commands::jobs::JobGuard;
use crate::commands::messages::{self, Message};
use crate::commands::model::{
    dataset_summary_scoped, load_stored_model, model_registry_rows, DatasetScope, StoredModel,
};
use crate::commands::ok;
use crate::commands::sidecar::run_sidecar_command;
use crate::db::open_database;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use tauri::AppHandle;
use uuid::Uuid;

/// Mirrors the sidecar's ceilings so a request is refused here, before a job is opened.
pub const MAX_CANDIDATES_PER_REQUEST: usize = 500;
pub const MAX_SEEDS_PER_REQUEST: usize = 25;
/// Candidates assessed in one call. Each needs ~1,800 Mordred descriptors, so the bound keeps
/// the sidecar inside its timeout.
pub const MAX_CANDIDATES_PER_ASSESSMENT: usize = 200;
const DESCRIPTOR_CHUNK_SIZE: usize = 32;
const JOB_GENERATE: &str = "design_generate";
const JOB_ASSESS: &str = "design_assess";

pub const VERIFICATION_STATUSES: [&str; 4] = ["not_verified", "planned", "verified", "refuted"];

fn open(app: &AppHandle) -> Result<Connection, String> {
    open_database(default_database_path(app)?)
        .map_err(|err| format!("Failed to open SQLite database for molecular design: {err}"))
}

// --- Request shapes -----------------------------------------------------------------------------

/// One seed molecule: a stored one, or a structure the user typed or drew.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SeedRequest {
    /// `library` or `user`.
    pub source: String,
    pub molecule_id: String,
    pub smiles: String,
    pub label: String,
}

/// The application context a design request is made for.
///
/// Every field is optional and recorded as given. Which of them a model uses is reported by the
/// assessment, per model; none is silently ignored.
#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ApplicationContext {
    pub base_oil_id: String,
    pub base_oil_name: String,
    pub concentration: Option<f64>,
    pub concentration_unit: String,
    pub other_components: String,
    pub test_type: String,
    pub temperature_value: Option<f64>,
    pub temperature_unit: String,
    pub load_value: Option<f64>,
    pub load_unit: String,
    pub notes: String,
}

impl ApplicationContext {
    pub fn parse(value: Option<&Value>) -> Result<Self, String> {
        match value {
            None | Some(Value::Null) => Ok(Self::default()),
            Some(value) => serde_json::from_value(value.clone())
                .map_err(|err| format!("The application context could not be read: {err}")),
        }
    }

    fn conditions(&self) -> ConditionInput {
        ConditionInput {
            test_type: self.test_type.trim().to_string(),
            temperature: self.temperature_value,
            temperature_unit: self.temperature_unit.clone(),
            load: self.load_value,
            load_unit: self.load_unit.clone(),
        }
    }

    fn to_json(&self) -> Value {
        serde_json::to_value(self).unwrap_or_else(|_| json!({}))
    }
}

/// A design request, with its three dimensions named.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DesignRequest {
    pub name: String,
    // Chemical class.
    pub template_id: String,
    pub constraints: Value,
    /// Whole-molecule bounds for seed exchange, separate from template substituent bounds.
    pub candidate_constraints: Value,
    pub substituent_sources: Vec<String>,
    pub curated_substituent_ids: Option<Vec<String>>,
    pub identical_substituents: bool,
    pub max_candidates: usize,
    pub random_seed: Option<i64>,
    pub seeds: Vec<SeedRequest>,
    // Target function / property: what the designer wants, recorded as intent.
    pub target_function: String,
    pub target_metric: String,
    // Application conditions.
    pub context: ApplicationContext,
}

impl DesignRequest {
    pub fn parse(value: &Value) -> Result<Self, String> {
        let request: Self = serde_json::from_value(value.clone()).map_err(|err| {
            coded(
                errors::DESIGN_REQUEST_INVALID,
                format!("The design request could not be read: {err}"),
            )
        })?;
        if request.template_id.trim().is_empty() && request.seeds.is_empty() {
            return Err(coded(
                errors::DESIGN_REQUEST_INVALID,
                "Choose a template or supply seed molecules for generation without a template.",
            ));
        }
        if request.max_candidates == 0 || request.max_candidates > MAX_CANDIDATES_PER_REQUEST {
            return Err(coded(
                errors::DESIGN_REQUEST_INVALID,
                format!(
                    "The candidate limit must be between 1 and {MAX_CANDIDATES_PER_REQUEST}; got {}.",
                    request.max_candidates
                ),
            ));
        }
        if request.seeds.len() > MAX_SEEDS_PER_REQUEST {
            return Err(coded(
                errors::DESIGN_REQUEST_INVALID,
                format!(
                    "At most {MAX_SEEDS_PER_REQUEST} seed molecules may be supplied; got {}.",
                    request.seeds.len()
                ),
            ));
        }
        if !request.target_metric.trim().is_empty() {
            crate::commands::analysis::describe_metric(request.target_metric.trim())?;
        }
        Ok(request)
    }

    /// The request as stored with a job and with each candidate: the dimensions, without the
    /// generator's per-call scaffolding.
    fn to_json(&self) -> Value {
        json!({
            "name": self.name,
            "chemicalClass": {
                "templateId": self.template_id,
                "constraints": self.constraints,
                "candidateConstraints": self.candidate_constraints,
                "substituentSources": self.substituent_sources,
                "curatedSubstituentIds": self.curated_substituent_ids,
                "identicalSubstituents": self.identical_substituents,
                "maxCandidates": self.max_candidates,
                "randomSeed": self.random_seed,
                "seeds": self.seeds
            },
            "targetFunction": {
                "function": self.target_function,
                "metric": self.target_metric
            },
            "applicationContext": self.context.to_json()
        })
    }
}

// --- Templates -----------------------------------------------------------------------------------

/// The chemical-class templates the sidecar implements, with their controls.
#[tauri::command]
pub async fn list_design_templates(app: AppHandle) -> Result<Value, String> {
    let response = run_sidecar_command(&app, "design-templates", json!({})).await?;
    let data = response
        .get("data")
        .cloned()
        .ok_or_else(|| "The sidecar returned no template catalogue.".to_string())?;
    ok("list_design_templates", data)
}

// --- Readiness -----------------------------------------------------------------------------------

/// Whether the workspace can predict anything for a target, and with what.
///
/// Reads the actual workspace. A page that assumed a model existed would have to invent a number
/// when it did not; this reports the counts and the models so the interface can say "generation
/// only" plainly.
#[tauri::command]
pub fn get_design_readiness(app: AppHandle, target: Option<String>) -> Result<Value, String> {
    let connection = open(&app)?;
    let target = target.unwrap_or_default().trim().to_string();
    let molecule_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM molecules", [], |row| row.get(0))
        .map_err(|err| format!("Failed to count molecules: {err}"))?;
    let described_molecules: i64 = connection
        .query_row(
            "SELECT COUNT(DISTINCT molecule_id) FROM molecule_descriptors
             WHERE mode = 'real' AND status = 'calculated'",
            [],
            |row| row.get(0),
        )
        .map_err(|err| format!("Failed to count described molecules: {err}"))?;
    let result_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM performance_results", [], |row| {
            row.get(0)
        })
        .map_err(|err| format!("Failed to count results: {err}"))?;
    let candidate_count: i64 = connection
        .query_row("SELECT COUNT(*) FROM design_candidates", [], |row| {
            row.get(0)
        })
        .map_err(|err| format!("Failed to count candidates: {err}"))?;

    let mut payload = json!({
        "target": target,
        "workspace": {
            "moleculeCount": molecule_count,
            "moleculesWithRealDescriptors": described_molecules,
            "performanceResultCount": result_count,
            "candidateCount": candidate_count
        },
        "models": [],
        "dataset": Value::Null,
        "status": "generationOnly",
        "reasons": []
    });
    if target.is_empty() {
        payload["reasons"] = json!([Message::new(messages::DESIGN_NO_MODEL)
            .detail("No target metric was chosen, so no model can be selected.")
            .to_json()]);
        return ok("get_design_readiness", payload);
    }
    let (_, label, unit) = crate::commands::analysis::describe_metric(&target)?;
    payload["label"] = json!(label);
    payload["labelCode"] = json!(crate::commands::analysis::metric_label_code(&target));
    payload["unit"] = json!(unit);

    let models = model_registry_rows(&connection, &target, Some("additive_component"))?;
    let usable: Vec<&Value> = models
        .iter()
        .filter(|model| model["usable"] == true)
        .collect();
    let unrestricted = dataset_summary_scoped(
        &connection,
        &target,
        "",
        "additive_component",
        &DatasetScope::default(),
    )?;
    let single_additive = dataset_summary_scoped(
        &connection,
        &target,
        "",
        "additive_component",
        &DatasetScope {
            single_additive_only: true,
            ..DatasetScope::default()
        },
    )?;
    let scope_options = crate::commands::model::training_scope_options(&connection, &target)?;
    payload["dataset"] = json!({
        "unrestricted": {
            "rowCount": unrestricted["rowCount"],
            "moleculeCount": unrestricted["moleculeCount"],
            "report": unrestricted["report"]
        },
        "singleAdditive": {
            "rowCount": single_additive["rowCount"],
            "moleculeCount": single_additive["moleculeCount"]
        },
        "scopeOptions": scope_options
    });
    payload["models"] = Value::Array(models.clone());
    let mut reasons = Vec::new();
    if usable.is_empty() {
        reasons.push(
            Message::new(messages::DESIGN_NO_MODEL)
                .with("target", label)
                .detail(format!(
                    "No usable molecule-level model is trained for {label}. Candidates can be generated and validated; performance prediction is unavailable until a model exists."
                ))
                .to_json(),
        );
        payload["status"] = json!("generationOnly");
    } else {
        payload["status"] = json!("predictionAvailable");
        if !usable
            .iter()
            .any(|model| model["validated"] == true && model["splitGrouping"] == "linked")
        {
            reasons.push(
                Message::new(messages::DESIGN_NO_HELD_OUT_VALIDATION)
                    .detail(
                        "No model for this target records a held-out validation grouped by molecule, so no prediction can be reported as supported by validation.",
                    )
                    .to_json(),
            );
        }
    }
    payload["reasons"] = Value::Array(reasons);
    ok("get_design_readiness", payload)
}

// --- Generation ----------------------------------------------------------------------------------

/// Resolves library seeds to their stored structures; user seeds pass through as typed.
fn resolve_seeds(connection: &Connection, seeds: &[SeedRequest]) -> Result<Vec<Value>, String> {
    let mut resolved = Vec::new();
    for (index, seed) in seeds.iter().enumerate() {
        match seed.source.as_str() {
            "library" => {
                let molecule_id = seed.molecule_id.trim();
                if molecule_id.is_empty() {
                    return Err(coded(
                        errors::DESIGN_REQUEST_INVALID,
                        format!("Seed {} names no library molecule.", index + 1),
                    ));
                }
                let stored: Option<(String, String)> = connection
                    .query_row(
                        "SELECT COALESCE(NULLIF(smiles_canonical, ''), smiles_raw, ''),
                                COALESCE(NULLIF(name, ''), id)
                         FROM molecules WHERE id = ?1",
                        params![molecule_id],
                        |row| Ok((row.get(0)?, row.get(1)?)),
                    )
                    .optional()
                    .map_err(|err| format!("Failed to load seed molecule {molecule_id}: {err}"))?;
                let Some((smiles, name)) = stored else {
                    return Err(coded(
                        errors::RECORD_NOT_FOUND,
                        format!("Seed molecule not found: {molecule_id}"),
                    ));
                };
                resolved.push(json!({ "id": molecule_id, "smiles": smiles, "label": name, "source": "library" }));
            }
            "user" | "" => {
                let smiles = seed.smiles.trim();
                if smiles.is_empty() {
                    return Err(coded(
                        errors::DESIGN_REQUEST_INVALID,
                        format!("Seed {} carries no structure.", index + 1),
                    ));
                }
                let id = if seed.label.trim().is_empty() {
                    format!("user-seed-{}", index + 1)
                } else {
                    format!("user:{}", seed.label.trim())
                };
                resolved.push(
                    json!({ "id": id, "smiles": smiles, "label": seed.label, "source": "user" }),
                );
            }
            other => {
                return Err(coded(
                    errors::DESIGN_REQUEST_INVALID,
                    format!(
                        "Seed {} has an unknown source '{other}'; use library or user.",
                        index + 1
                    ),
                ));
            }
        }
    }
    Ok(resolved)
}

/// A stored molecule with the same structure as a candidate, if there is one.
fn find_existing_molecule(
    connection: &Connection,
    inchi_key: &str,
    smiles: &str,
) -> Result<Option<(String, String)>, String> {
    connection
        .query_row(
            "SELECT id, COALESCE(NULLIF(name, ''), id) FROM molecules
             WHERE (?1 <> '' AND inchi_key = ?1) OR (?2 <> '' AND smiles_canonical = ?2)
             ORDER BY created_at ASC LIMIT 1",
            params![inchi_key, smiles],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|err| format!("Failed to look for an existing molecule: {err}"))
}

/// Runs the generator and records every valid candidate it produced.
#[tauri::command]
pub async fn run_design_generation(app: AppHandle, request: Value) -> Result<Value, String> {
    let request = DesignRequest::parse(&request)?;
    let job = JobGuard::start(
        open(&app)?,
        JOB_GENERATE,
        request.max_candidates as i64,
        &request.to_json(),
    )?;
    let job_id = job.id().to_string();

    let connection = open(&app)?;
    let seeds = match resolve_seeds(&connection, &request.seeds) {
        Ok(seeds) => seeds,
        Err(err) => {
            job.fail(0, 0, &err)?;
            return Err(err);
        }
    };
    let response = match run_sidecar_command(
        &app,
        "design-generate",
        json!({
            "template_id": request.template_id,
            "constraints": request.constraints,
            "candidate_constraints": request.candidate_constraints,
            "substituent_sources": if request.substituent_sources.is_empty() { json!(["curated"]) } else { json!(request.substituent_sources) },
            "curated_substituent_ids": request.curated_substituent_ids,
            "identical_substituents": request.identical_substituents,
            "max_candidates": request.max_candidates,
            "random_seed": request.random_seed,
            "seeds": seeds
        }),
    )
    .await
    {
        Ok(response) => response,
        Err(err) => {
            job.fail(0, 0, &err)?;
            return Err(err);
        }
    };
    let data = response.get("data").cloned().unwrap_or_else(|| json!({}));
    let sidecar_warnings: Vec<Value> = response
        .get("warnings")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let generated = data
        .get("candidates")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let now = Utc::now().to_rfc3339();
    let request_json = request.to_json().to_string();
    let parameters = data.get("parameters").cloned().unwrap_or_else(|| json!({}));
    let random_seed = data.get("random_seed").and_then(Value::as_i64);
    let generator_version = data
        .get("generator_version")
        .and_then(Value::as_str)
        .unwrap_or("unknown")
        .to_string();

    let mut connection = connection;
    let tx = connection
        .transaction()
        .map_err(|err| format!("Failed to start the candidate transaction: {err}"))?;
    let mut stored = Vec::new();
    let mut existing_count = 0_usize;
    for (index, candidate) in generated.iter().enumerate() {
        let smiles = candidate
            .get("smiles_canonical")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let inchi_key = candidate
            .get("inchi_key")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        if smiles.is_empty() {
            continue;
        }
        let existing = find_existing_molecule(&tx, &inchi_key, &smiles)?;
        if existing.is_some() {
            existing_count += 1;
        }
        let id = Uuid::new_v4().to_string();
        let name = format!(
            "{} {}",
            candidate
                .get("template_id")
                .and_then(Value::as_str)
                .filter(|id| !id.is_empty())
                .unwrap_or("candidate"),
            index + 1
        );
        tx.execute(
            "INSERT INTO design_candidates (
                id, job_id, name, smiles_canonical, inchi, inchi_key, formula, molecular_weight,
                heavy_atom_count, template_id, template_family, chemical_classes, substituents_json,
                seed_ids, generator_version, parameters_json, random_seed, request_json,
                validation_status, validation_json, structure_svg, existing_molecule_id,
                promoted_molecule_id, verification_status, verification_notes, notes, created_at,
                updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
                       ?18, 'valid', ?19, ?20, ?21, NULL, 'not_verified', '', '', ?22, ?22)",
            params![
                &id,
                &job_id,
                &name,
                &smiles,
                candidate
                    .get("inchi")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                &inchi_key,
                candidate
                    .get("formula")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                candidate.get("molecular_weight").and_then(Value::as_f64),
                candidate.get("heavy_atom_count").and_then(Value::as_i64),
                candidate
                    .get("template_id")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                candidate
                    .get("template_family")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                candidate
                    .get("chemical_classes")
                    .cloned()
                    .unwrap_or_else(|| json!([]))
                    .to_string(),
                candidate
                    .get("substituents")
                    .cloned()
                    .unwrap_or_else(|| json!([]))
                    .to_string(),
                candidate
                    .get("seed_ids")
                    .cloned()
                    .unwrap_or_else(|| json!([]))
                    .to_string(),
                &generator_version,
                parameters.to_string(),
                random_seed,
                &request_json,
                candidate
                    .get("validation")
                    .cloned()
                    .unwrap_or_else(|| json!({}))
                    .to_string(),
                candidate
                    .get("svg")
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
                existing.as_ref().map(|(id, _)| id.clone()),
                &now
            ],
        )
        .map_err(|err| format!("Failed to store candidate {name}: {err}"))?;
        stored.push(id);
    }
    tx.commit()
        .map_err(|err| format!("Failed to commit the candidate collection: {err}"))?;

    let rejected_structures = data
        .get("rejected_structures")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let summary = json!({
        "jobId": job_id,
        "candidateCount": stored.len(),
        "existingInLibraryCount": existing_count,
        "duplicateCount": data.get("duplicate_count"),
        "enumeratedTotal": data.get("enumerated_total"),
        "proposedCount": data.get("proposed_count"),
        "substituentCount": data.get("substituent_count"),
        "substituents": data.get("substituents"),
        "rejectedSubstituents": data.get("rejected_substituents"),
        "rejectedStructureCount": rejected_structures.len(),
        "rejectedStructures": rejected_structures.iter().take(25).collect::<Vec<_>>(),
        "seedReports": data.get("seed_reports"),
        "template": data.get("template"),
        "generatorVersion": generator_version,
        "parameters": parameters,
        "randomSeed": random_seed,
        "request": request.to_json(),
        "warnings": sidecar_warnings,
        "mode": "real"
    });
    job.succeed(
        stored.len() as i64,
        rejected_structures.len() as i64,
        &summary,
    )?;

    let candidates = load_candidate_rows(&connection, &stored, true)?;
    let mut summary = summary;
    summary["candidates"] = Value::Array(candidates.iter().map(candidate_to_json).collect());
    ok("run_design_generation", summary)
}

// --- Candidate rows ----------------------------------------------------------------------------

/// One stored candidate, read whole.
#[derive(Debug, Clone)]
pub struct CandidateRow {
    pub id: String,
    pub job_id: String,
    pub name: String,
    pub smiles_canonical: String,
    pub inchi: String,
    pub inchi_key: String,
    pub formula: String,
    pub molecular_weight: Option<f64>,
    pub heavy_atom_count: Option<i64>,
    pub template_id: String,
    pub template_family: String,
    pub chemical_classes: Value,
    pub substituents: Value,
    pub seed_ids: Value,
    pub generator_version: String,
    pub parameters: Value,
    pub random_seed: Option<i64>,
    pub request: Value,
    pub validation_status: String,
    pub validation: Value,
    pub structure_svg: String,
    pub existing_molecule_id: String,
    pub existing_molecule_name: String,
    pub promoted_molecule_id: String,
    pub verification_status: String,
    pub verification_notes: String,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
    pub latest_assessment: Value,
}

const CANDIDATE_SELECT: &str =
    "SELECT c.id, c.job_id, c.name, c.smiles_canonical, COALESCE(c.inchi, ''),
        COALESCE(c.inchi_key, ''), COALESCE(c.formula, ''), c.molecular_weight, c.heavy_atom_count,
        c.template_id, c.template_family, c.chemical_classes, c.substituents_json, c.seed_ids,
        c.generator_version, c.parameters_json, c.random_seed, c.request_json, c.validation_status,
        c.validation_json, c.structure_svg, COALESCE(c.existing_molecule_id, ''),
        COALESCE(m.name, ''), COALESCE(c.promoted_molecule_id, ''), c.verification_status,
        COALESCE(c.verification_notes, ''), COALESCE(c.notes, ''), c.created_at, c.updated_at,
        (SELECT json_object('status', p.status, 'predictedValue', p.predicted_value,
                            'target', p.target, 'unit', p.unit, 'modelName', p.model_name,
                            'modelId', p.model_id, 'createdAt', p.created_at)
           FROM design_predictions p WHERE p.candidate_id = c.id
           ORDER BY datetime(p.created_at) DESC, p.created_at DESC, p.id DESC LIMIT 1)
 FROM design_candidates c
 LEFT JOIN molecules m ON m.id = c.existing_molecule_id";

fn parse_json(text: &str, fallback: Value) -> Value {
    serde_json::from_str(text).unwrap_or(fallback)
}

fn read_candidate_row(
    row: &rusqlite::Row<'_>,
    include_svg: bool,
) -> rusqlite::Result<CandidateRow> {
    Ok(CandidateRow {
        id: row.get(0)?,
        job_id: row.get(1)?,
        name: row.get(2)?,
        smiles_canonical: row.get(3)?,
        inchi: row.get(4)?,
        inchi_key: row.get(5)?,
        formula: row.get(6)?,
        molecular_weight: row.get(7)?,
        heavy_atom_count: row.get(8)?,
        template_id: row.get(9)?,
        template_family: row.get(10)?,
        chemical_classes: parse_json(&row.get::<_, String>(11)?, json!([])),
        substituents: parse_json(&row.get::<_, String>(12)?, json!([])),
        seed_ids: parse_json(&row.get::<_, String>(13)?, json!([])),
        generator_version: row.get(14)?,
        parameters: parse_json(&row.get::<_, String>(15)?, json!({})),
        random_seed: row.get(16)?,
        request: parse_json(&row.get::<_, String>(17)?, json!({})),
        validation_status: row.get(18)?,
        validation: parse_json(&row.get::<_, String>(19)?, json!({})),
        structure_svg: if include_svg {
            row.get::<_, Option<String>>(20)?.unwrap_or_default()
        } else {
            String::new()
        },
        existing_molecule_id: row.get(21)?,
        existing_molecule_name: row.get(22)?,
        promoted_molecule_id: row.get(23)?,
        verification_status: row.get(24)?,
        verification_notes: row.get(25)?,
        notes: row.get(26)?,
        created_at: row.get(27)?,
        updated_at: row.get(28)?,
        latest_assessment: row
            .get::<_, Option<String>>(29)?
            .map(|text| parse_json(&text, Value::Null))
            .unwrap_or(Value::Null),
    })
}

pub fn candidate_to_json(candidate: &CandidateRow) -> Value {
    json!({
        "id": candidate.id,
        "jobId": candidate.job_id,
        "name": candidate.name,
        "smilesCanonical": candidate.smiles_canonical,
        "inchi": candidate.inchi,
        "inchiKey": candidate.inchi_key,
        "formula": candidate.formula,
        "molecularWeight": candidate.molecular_weight,
        "heavyAtomCount": candidate.heavy_atom_count,
        "templateId": candidate.template_id,
        "templateFamily": candidate.template_family,
        "chemicalClasses": candidate.chemical_classes,
        "substituents": candidate.substituents,
        "seedIds": candidate.seed_ids,
        "generatorVersion": candidate.generator_version,
        "parameters": candidate.parameters,
        "randomSeed": candidate.random_seed,
        "request": candidate.request,
        "validationStatus": candidate.validation_status,
        "validation": candidate.validation,
        "structureSvg": candidate.structure_svg,
        "existingMoleculeId": candidate.existing_molecule_id,
        "existingMoleculeName": candidate.existing_molecule_name,
        "inLibrary": !candidate.existing_molecule_id.is_empty() || !candidate.promoted_molecule_id.is_empty(),
        "promotedMoleculeId": candidate.promoted_molecule_id,
        "verificationStatus": candidate.verification_status,
        "verificationNotes": candidate.verification_notes,
        "notes": candidate.notes,
        "createdAt": candidate.created_at,
        "updatedAt": candidate.updated_at,
        "latestAssessment": candidate.latest_assessment,
        // Explicit, so no reader mistakes structural validity for a synthesis assessment.
        "synthesisFeasibility": { "status": "not_assessed" }
    })
}

/// Candidates by id, in the order asked for; an unknown id is an error.
pub fn load_candidate_rows(
    connection: &Connection,
    ids: &[String],
    include_svg: bool,
) -> Result<Vec<CandidateRow>, String> {
    let mut statement = connection
        .prepare(&format!("{CANDIDATE_SELECT} WHERE c.id = ?1"))
        .map_err(|err| format!("Failed to prepare the candidate query: {err}"))?;
    let mut rows = Vec::new();
    for id in ids {
        let row = statement
            .query_row(params![id], |row| read_candidate_row(row, include_svg))
            .optional()
            .map_err(|err| format!("Failed to load candidate {id}: {err}"))?
            .ok_or_else(|| {
                coded(
                    errors::DESIGN_CANDIDATE_NOT_FOUND,
                    format!("Candidate not found: {id}"),
                )
            })?;
        rows.push(row);
    }
    Ok(rows)
}

/// A page of the candidate collection, newest first, optionally for one generation job.
#[tauri::command]
pub fn list_design_candidates(
    app: AppHandle,
    job_id: Option<String>,
    page: Option<i64>,
    page_size: Option<i64>,
    include_svg: Option<bool>,
) -> Result<Value, String> {
    let connection = open(&app)?;
    let job_id = job_id.unwrap_or_default();
    let page = page.unwrap_or(1).max(1);
    let page_size = page_size.unwrap_or(50).clamp(1, 500);
    let include_svg = include_svg.unwrap_or(true);
    let total: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM design_candidates WHERE (?1 = '' OR job_id = ?1)",
            params![job_id],
            |row| row.get(0),
        )
        .map_err(|err| format!("Failed to count candidates: {err}"))?;
    let mut statement = connection
        .prepare(&format!(
            "{CANDIDATE_SELECT} WHERE (?1 = '' OR c.job_id = ?1)
             ORDER BY datetime(c.created_at) DESC, c.created_at DESC, c.id DESC
             LIMIT ?2 OFFSET ?3"
        ))
        .map_err(|err| format!("Failed to prepare the candidate list: {err}"))?;
    let items = statement
        .query_map(params![job_id, page_size, (page - 1) * page_size], |row| {
            read_candidate_row(row, include_svg)
        })
        .map_err(|err| format!("Failed to list candidates: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read a candidate: {err}"))?;
    ok(
        "list_design_candidates",
        json!({
            "items": items.iter().map(candidate_to_json).collect::<Vec<_>>(),
            "total": total,
            "page": page,
            "pageSize": page_size
        }),
    )
}

#[tauri::command]
pub fn list_design_jobs(app: AppHandle, limit: Option<i64>) -> Result<Value, String> {
    let connection = open(&app)?;
    let items = crate::commands::jobs::query_jobs(
        &connection,
        &[JOB_GENERATE, JOB_ASSESS],
        limit.unwrap_or(25),
    )?;
    ok("list_design_jobs", json!({ "items": items }))
}

// --- Descriptors for candidates ------------------------------------------------------------------

/// Real descriptor features already stored for a candidate, prefixed as the model expects.
fn candidate_descriptor_features(
    connection: &Connection,
    candidate_id: &str,
) -> Result<Map<String, Value>, String> {
    let mut statement = connection
        .prepare(
            "SELECT descriptor_set, descriptors_json FROM design_candidate_descriptors
             WHERE candidate_id = ?1 AND mode = 'real' AND status = 'calculated'
             ORDER BY descriptor_set",
        )
        .map_err(|err| format!("Failed to prepare the candidate descriptor query: {err}"))?;
    let rows = statement
        .query_map(params![candidate_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|err| format!("Failed to query candidate descriptors: {err}"))?;
    let mut features = Map::new();
    for row in rows {
        let (set, descriptors_json) =
            row.map_err(|err| format!("Failed to read a candidate descriptor row: {err}"))?;
        features.extend(numeric_descriptors(&descriptors_json, &set));
    }
    Ok(features)
}

fn candidate_has_real_descriptors(
    connection: &Connection,
    candidate_id: &str,
) -> Result<bool, String> {
    let count: i64 = connection
        .query_row(
            "SELECT COUNT(DISTINCT descriptor_set) FROM design_candidate_descriptors
             WHERE candidate_id = ?1 AND mode = 'real' AND status = 'calculated'
               AND descriptor_set IN ('rdkit', 'mordred')",
            params![candidate_id],
            |row| row.get(0),
        )
        .map_err(|err| format!("Failed to check candidate descriptors: {err}"))?;
    Ok(count == 2)
}

/// Calculates real descriptors for the candidates that lack them, through the same sidecar
/// command the library uses, and stores them beside the candidate — never in
/// `molecule_descriptors`, which belongs to the library.
async fn ensure_candidate_descriptors(
    app: &AppHandle,
    candidates: &[CandidateRow],
) -> Result<BTreeMap<String, String>, String> {
    let connection = open(app)?;
    let mut pending = Vec::new();
    for candidate in candidates {
        if !candidate_has_real_descriptors(&connection, &candidate.id)? {
            pending.push(candidate);
        }
    }
    let mut failures: BTreeMap<String, String> = BTreeMap::new();
    for chunk in pending.chunks(DESCRIPTOR_CHUNK_SIZE) {
        let items: Vec<Value> = chunk
            .iter()
            .map(|candidate| json!({ "molecule_id": candidate.id, "smiles": candidate.smiles_canonical }))
            .collect();
        let response = run_sidecar_command(
            app,
            "calculate-descriptor-batch",
            json!({ "items": items, "require_rdkit": true, "require_mordred": true }),
        )
        .await?;
        let results = response
            .pointer("/data/items")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut connection = open(app)?;
        let tx = connection.transaction().map_err(|err| {
            format!("Failed to start the candidate descriptor transaction: {err}")
        })?;
        let now = Utc::now().to_rfc3339();
        for item in results {
            let candidate_id = item
                .get("molecule_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if item.get("ok").and_then(Value::as_bool) != Some(true) {
                let error = item
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Descriptor calculation failed.")
                    .to_string();
                failures.insert(candidate_id, error);
                continue;
            }
            // Old rows for the candidate go first, so a re-run never leaves two of one set.
            tx.execute(
                "DELETE FROM design_candidate_descriptors WHERE candidate_id = ?1",
                params![candidate_id],
            )
            .map_err(|err| format!("Failed to replace candidate descriptors: {err}"))?;
            for set in ["rdkit", "mordred"] {
                let Some(block) = item.pointer(&format!("/data/{set}")) else {
                    failures.insert(
                        candidate_id.clone(),
                        format!("The sidecar returned no {set} descriptors."),
                    );
                    continue;
                };
                let mode = block.get("mode").and_then(Value::as_str).unwrap_or("");
                if mode != "real" {
                    failures.insert(
                        candidate_id.clone(),
                        format!("The {set} descriptors were not a real calculation."),
                    );
                    continue;
                }
                let descriptors = block
                    .get("descriptors")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                tx.execute(
                    "INSERT INTO design_candidate_descriptors (
                        id, candidate_id, descriptor_set, descriptor_version, descriptors_json,
                        descriptor_count, status, mode, error_message, calculated_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'calculated', 'real', '', ?7)",
                    params![
                        Uuid::new_v4().to_string(),
                        candidate_id,
                        set,
                        block
                            .get("descriptor_version")
                            .and_then(Value::as_str)
                            .unwrap_or_default(),
                        descriptors.to_string(),
                        descriptors
                            .as_object()
                            .map(|object| object.len() as i64)
                            .unwrap_or_default(),
                        &now
                    ],
                )
                .map_err(|err| {
                    format!("Failed to store {set} descriptors for a candidate: {err}")
                })?;
            }
        }
        tx.commit()
            .map_err(|err| format!("Failed to commit candidate descriptors: {err}"))?;
    }
    Ok(failures)
}

// --- Assessment ----------------------------------------------------------------------------------

/// How the selected model treats each condition of the application context.
///
/// `feature` — used as a model input; `scopeFilter` — the model was fitted on this value only;
/// `coverageOnly` — not an input, but the training records are checked for it; `notUsed` — the
/// model's basis forbids it; `recordedOnly` — kept with the assessment and nothing more.
fn condition_handling(model: &StoredModel) -> Value {
    let uses = |key: &str| model.feature_order.iter().any(|name| name == key);
    json!({
        "concentration": if model.concentration_basis == ConcentrationBasis::None { "notUsed" } else { "feature" },
        "testType": if model.dataset_scope.test_type.trim().is_empty() { "coverageOnly" } else { "scopeFilter" },
        "baseOil": "coverageOnly",
        "temperature": if uses(FEATURE_CONDITION_TEMPERATURE) { "feature" } else { "coverageOnly" },
        "load": if uses(FEATURE_CONDITION_LOAD) { "feature" } else { "coverageOnly" },
        "otherComponents": "recordedOnly"
    })
}

/// Coverage of one requested condition by the training records: `covered`, `notCovered`,
/// `notRequested` (the request left it blank), or `notRecorded` (the model recorded nothing).
fn range_coverage(requested: Option<f64>, range: Option<(f64, f64)>) -> (&'static str, Value) {
    match (requested, range) {
        (None, _) => ("notRequested", Value::Null),
        (Some(_), None) => ("notRecorded", Value::Null),
        (Some(value), Some((low, high))) => (
            if value >= low && value <= high {
                "covered"
            } else {
                "notCovered"
            },
            json!({ "requested": value, "trainingMin": low, "trainingMax": high }),
        ),
    }
}

fn pair(value: &Value) -> Option<(f64, f64)> {
    let array = value.as_array()?;
    Some((array.first()?.as_f64()?, array.get(1)?.as_f64()?))
}

/// The training range of a condition recorded in several units, converted to one unit.
fn converted_range(
    ranges: &Value,
    convert: impl Fn(Option<f64>, &str) -> Option<f64>,
) -> Option<(f64, f64)> {
    let mut combined: Option<(f64, f64)> = None;
    for (unit, range) in ranges.as_object()?.iter() {
        let Some((low, high)) = pair(range) else {
            continue;
        };
        let (Some(low), Some(high)) = (convert(Some(low), unit), convert(Some(high), unit)) else {
            continue;
        };
        combined = Some(match combined {
            Some((current_low, current_high)) => (current_low.min(low), current_high.max(high)),
            None => (low.min(high), low.max(high)),
        });
    }
    combined
}

/// Application-condition coverage: what the training records say about the requested context.
fn condition_coverage(
    model: &StoredModel,
    context: &ApplicationContext,
    concentration: Option<f64>,
    reasons: &mut Vec<Message>,
) -> (bool, Value) {
    let conditions = model
        .domain
        .get("conditions")
        .cloned()
        .unwrap_or(Value::Null);
    let recorded = conditions.is_object();
    let mut all_covered = true;
    let mut note = |status: &str, message: Message| {
        if status == "notCovered" {
            all_covered = false;
            reasons.push(message);
        }
    };

    // Test type: a scope filter is compatibility, handled by readiness; here it is coverage.
    let requested_type = context.test_type.trim();
    let test_type_status = if requested_type.is_empty() {
        "notRequested"
    } else if !recorded {
        "notRecorded"
    } else if conditions["test_types"].get(requested_type).is_some() {
        "covered"
    } else {
        "notCovered"
    };
    note(
        test_type_status,
        Message::new(messages::DESIGN_TEST_TYPE_NOT_COVERED)
            .with("testType", requested_type)
            .detail(format!(
                "No training record is a '{requested_type}' experiment; the model has seen: {}.",
                conditions["test_types"]
                    .as_object()
                    .map(|types| types.keys().cloned().collect::<Vec<_>>().join(", "))
                    .unwrap_or_default()
            )),
    );

    let base_oil_status = if context.base_oil_id.trim().is_empty() {
        "notRequested"
    } else if !recorded {
        "notRecorded"
    } else if conditions["base_oils"]
        .as_array()
        .map(|oils| {
            oils.iter()
                .any(|oil| oil["id"] == context.base_oil_id.trim())
        })
        .unwrap_or(false)
    {
        "covered"
    } else {
        "notCovered"
    };
    note(
        base_oil_status,
        Message::new(messages::DESIGN_BASE_OIL_NOT_COVERED)
            .with("baseOil", context.base_oil_name.clone())
            .detail(format!(
                "No training record was measured in base oil '{}'. Base-oil properties are not inputs to a molecule-level model; this is coverage, not a feature.",
                context.base_oil_name
            )),
    );

    let (concentration_status, concentration_detail) = range_coverage(
        if model.concentration_basis == ConcentrationBasis::None {
            None
        } else {
            concentration
        },
        if recorded {
            pair(&conditions["concentration_range"])
        } else {
            None
        },
    );
    note(
        concentration_status,
        Message::new(messages::DESIGN_CONCENTRATION_NOT_COVERED)
            .with("value", format!("{}", concentration.unwrap_or_default()))
            .detail(format!(
                "The requested concentration lies outside the training range {}.",
                conditions["concentration_range"]
            )),
    );

    let (temperature_status, temperature_detail) = range_coverage(
        read_temperature_celsius(context.temperature_value, &context.temperature_unit),
        if recorded {
            converted_range(&conditions["temperature_ranges"], read_temperature_celsius)
        } else {
            None
        },
    );
    note(
        temperature_status,
        Message::new(messages::DESIGN_CONDITION_NOT_COVERED)
            .with("condition", "temperature")
            .detail(
                "The requested test temperature lies outside the range of the training records.",
            ),
    );
    let (load_status, load_detail) = range_coverage(
        read_load_newtons(context.load_value, &context.load_unit),
        if recorded {
            converted_range(&conditions["load_ranges"], read_load_newtons)
        } else {
            None
        },
    );
    note(
        load_status,
        Message::new(messages::DESIGN_CONDITION_NOT_COVERED)
            .with("condition", "load")
            .detail("The requested load lies outside the range of the training records."),
    );

    (
        all_covered,
        json!({
            "recorded": recorded,
            "testType": { "status": test_type_status, "requested": requested_type, "training": conditions["test_types"] },
            "baseOil": { "status": base_oil_status, "requested": context.base_oil_name, "training": conditions["base_oils"] },
            "concentration": { "status": concentration_status, "detail": concentration_detail },
            "temperature": { "status": temperature_status, "detail": temperature_detail },
            "load": { "status": load_status, "detail": load_detail },
            "otherComponents": { "status": "recordedOnly", "requested": context.other_components }
        }),
    )
}

/// What the model's validation says about unseen molecules.
fn validation_support(model: &StoredModel, reasons: &mut Vec<Message>) -> (&'static str, Value) {
    let grouping = crate::commands::model::split_grouping(&model.split_method);
    let validation = model
        .metrics
        .get("validation")
        .cloned()
        .unwrap_or(Value::Null);
    let status = if !model.validated || validation.is_null() {
        reasons.push(
            Message::new(messages::DESIGN_NO_HELD_OUT_VALIDATION).detail(
                "The model recorded no held-out validation; its metrics are in-sample and say nothing about unseen molecules.",
            ),
        );
        "none"
    } else if grouping == "linked" {
        "unseenMolecules"
    } else if grouping == "formulation" {
        reasons.push(
            Message::new(messages::DESIGN_VALIDATION_NOT_MOLECULE_GROUPED).detail(
                "The validation held out whole formulations, but a molecule could still appear on both sides of the split.",
            ),
        );
        "formulationsOnly"
    } else {
        reasons.push(
            Message::new(messages::DESIGN_VALIDATION_UNGROUPED)
                .detail("The validation held out rows without grouping, so repeat measurements inflate its score."),
        );
        "ungrouped"
    };
    (
        status,
        json!({
            "status": status,
            "grouping": grouping,
            "splitMethod": model.split_method,
            "metrics": validation,
            "trainingOnly": model.metrics.get("training_only").cloned().unwrap_or(Value::Null),
            "sampleCount": model.sample_count,
            "moleculeCount": model.molecule_count
        }),
    )
}

/// One candidate's prediction readiness: everything that must hold before a number is computed.
struct ReadyCandidate {
    features: Map<String, Value>,
    concentration: Option<f64>,
}

fn candidate_readiness(
    connection: &Connection,
    model: &StoredModel,
    candidate: &CandidateRow,
    context: &ApplicationContext,
    descriptor_failure: Option<&String>,
    reasons: &mut Vec<Message>,
) -> Result<Option<ReadyCandidate>, String> {
    if candidate.validation_status != "valid" {
        reasons.push(Message::new(messages::DESIGN_STRUCTURE_INVALID).detail(
            "The candidate failed the applicable structural rules and cannot be predicted on.",
        ));
        return Ok(None);
    }
    if let Some(failure) = descriptor_failure {
        reasons.push(
            Message::new(messages::DESIGN_DESCRIPTORS_UNAVAILABLE)
                .with("subject", candidate.name.clone())
                .detail(format!(
                    "Real descriptors could not be calculated: {failure}"
                )),
        );
        return Ok(None);
    }
    let descriptors = candidate_descriptor_features(connection, &candidate.id)?;
    if descriptors.is_empty() {
        reasons.push(
            Message::new(messages::DESIGN_DESCRIPTORS_UNAVAILABLE)
                .with("subject", candidate.name.clone())
                .detail("No real descriptor record exists for this candidate."),
        );
        return Ok(None);
    }

    // A test-type scope is a compatibility requirement: a model fitted on four-ball results only
    // cannot be asked about an SRV test.
    let scope_type = model.dataset_scope.test_type.trim();
    let requested_type = context.test_type.trim();
    if !scope_type.is_empty() && !requested_type.is_empty() && scope_type != requested_type {
        reasons.push(
            Message::new(messages::DESIGN_TEST_TYPE_INCOMPATIBLE)
                .with("requested", requested_type)
                .with("fitted", scope_type)
                .detail(format!(
                    "The model was fitted on '{scope_type}' experiments only and the request names '{requested_type}'."
                )),
        );
        return Ok(None);
    }

    let input = ComponentInput {
        component_id: candidate.id.clone(),
        molecule_id: candidate.id.clone(),
        molecule_name: candidate.name.clone(),
        smiles: candidate.smiles_canonical.clone(),
        concentration: context.concentration,
        concentration_unit: context.concentration_unit.clone(),
        descriptors,
    };
    let concentration = match additive_component_concentration(&input, model.concentration_basis) {
        Ok(value) => value,
        Err(problem) => {
            let detail = problem.describe(&format!("'{}'", candidate.name));
            reasons.push(
                Message::new(messages::DESIGN_CONCENTRATION_INCOMPATIBLE)
                    .with("subject", candidate.name.clone())
                    .with("basis", model.concentration_basis.as_str())
                    .detail(detail),
            );
            if let UnitProblem::BasisMismatch { .. } = problem {
                reasons.push(problem.to_message(&candidate.name));
            }
            return Ok(None);
        }
    };
    let mut features = additive_component_features(&input, concentration);
    features.extend(context.conditions().features());
    let (ordered, missing) = order_features(&features, &model.feature_order);
    if !missing.is_empty() {
        let needs_conditions = missing
            .iter()
            .any(|key| CONDITION_FEATURES.contains(&key.as_str()));
        if needs_conditions {
            reasons.push(
                Message::new(messages::DESIGN_CONDITIONS_REQUIRED)
                    .with("missing", missing.join(", "))
                    .detail("The model uses the test temperature and load as features; supply both, with units this build can convert."),
            );
        } else {
            reasons.push(
                Message::new(messages::DESIGN_FEATURES_MISSING)
                    .with("missingCount", missing.len() as u64)
                    .detail(format!(
                        "The model needs {} feature(s) the candidate could not supply: {}",
                        missing.len(),
                        missing
                            .iter()
                            .take(10)
                            .cloned()
                            .collect::<Vec<_>>()
                            .join(", ")
                    )),
            );
        }
        return Ok(None);
    }
    Ok(Some(ReadyCandidate {
        features: ordered,
        concentration,
    }))
}

/// Reads the sidecar's domain evidence for one item into a status and its reasons.
fn domain_status(evidence: &Value, reasons: &mut Vec<Message>) -> &'static str {
    if evidence["domain_recorded"] != true {
        reasons.push(
            Message::new(messages::DESIGN_DOMAIN_NOT_RECORDED).detail(
                "The model was trained before domain evidence was recorded; retrain it to obtain descriptor coverage and nearest-neighbour support.",
            ),
        );
        return "unknown";
    }
    let coverage = &evidence["feature_coverage"];
    let outside = coverage["outside_range_count"].as_u64().unwrap_or(0);
    if outside > 0 {
        let named: Vec<String> = coverage["outside_range"]
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .take(5)
                    .filter_map(|item| item["feature"].as_str().map(ToString::to_string))
                    .collect()
            })
            .unwrap_or_default();
        reasons.push(
            Message::new(messages::DESIGN_DESCRIPTORS_OUT_OF_RANGE)
                .with("count", outside)
                .with("features", named.join(", "))
                .detail(format!(
                    "{outside} of {} model feature(s) lie outside the training range: {}",
                    coverage["compared_features"],
                    named.join(", ")
                )),
        );
        return "outside";
    }
    if let Some(identical) = evidence["nearest_training"]["identical_training_molecule"].as_str() {
        reasons.push(
            Message::new(messages::DESIGN_IDENTICAL_TRAINING_MOLECULE)
                .with("moleculeId", identical)
                .detail(format!(
                    "This structure is training molecule {identical}; the prediction describes a molecule the model has already seen."
                )),
        );
    }
    "within"
}

/// Predicts for a set of candidates against one model in one application context, and records
/// an assessment for each: structural compliance, prediction readiness, applicability domain,
/// validation support, and the resulting status.
#[tauri::command]
pub async fn assess_design_candidates(
    app: AppHandle,
    candidate_ids: Vec<String>,
    model_id: String,
    context: Option<Value>,
) -> Result<Value, String> {
    if candidate_ids.is_empty() {
        return Err(coded(
            errors::DESIGN_REQUEST_INVALID,
            "Select at least one candidate to assess.",
        ));
    }
    if candidate_ids.len() > MAX_CANDIDATES_PER_ASSESSMENT {
        return Err(coded(
            errors::DESIGN_REQUEST_INVALID,
            format!(
                "At most {MAX_CANDIDATES_PER_ASSESSMENT} candidates can be assessed in one run; got {}.",
                candidate_ids.len()
            ),
        ));
    }
    let context = ApplicationContext::parse(context.as_ref())?;
    let model = load_stored_model(&app, &model_id)?;
    let (_, label, unit) = crate::commands::analysis::describe_metric(&model.target)?;
    let connection = open(&app)?;
    let candidates = load_candidate_rows(&connection, &candidate_ids, false)?;

    let job = JobGuard::start(
        open(&app)?,
        JOB_ASSESS,
        candidates.len() as i64,
        &json!({
            "modelId": model.id,
            "modelName": model.name,
            "target": model.target,
            "candidateIds": candidate_ids,
            "context": context.to_json()
        }),
    )?;

    let descriptor_failures = match ensure_candidate_descriptors(&app, &candidates).await {
        Ok(failures) => failures,
        Err(err) => {
            job.fail(0, candidates.len() as i64, &err)?;
            return Err(err);
        }
    };

    let handling = condition_handling(&model);
    let mut model_reasons: Vec<Message> = Vec::new();
    let (support_status, support) = validation_support(&model, &mut model_reasons);
    let multi_additive = model
        .domain
        .pointer("/conditions/single_additive_rows")
        .and_then(Value::as_i64)
        .map(|single| single < model.sample_count)
        .unwrap_or(!model.dataset_scope.single_additive_only);
    if multi_additive {
        model_reasons.push(
            Message::new(messages::DESIGN_MULTI_ADDITIVE_TRAINING).detail(
                "The model was fitted on formulations holding several additives; a row's target is the mixture's performance, not the molecule's own. Train with the single-additive scope for a molecule-level reading.",
            ),
        );
    }
    let context_conditions = context.conditions();
    let mut unmodelled = Vec::new();
    if !context_conditions.test_type.is_empty() && handling["testType"] == "coverageOnly" {
        unmodelled.push("testType");
    }
    if !context.base_oil_id.trim().is_empty() {
        unmodelled.push("baseOil");
    }
    if context.temperature_value.is_some() && handling["temperature"] == "coverageOnly" {
        unmodelled.push("temperature");
    }
    if context.load_value.is_some() && handling["load"] == "coverageOnly" {
        unmodelled.push("load");
    }
    if !context.other_components.trim().is_empty() {
        unmodelled.push("otherComponents");
    }
    if !unmodelled.is_empty() {
        model_reasons.push(
            Message::new(messages::DESIGN_CONDITION_NOT_MODELLED)
                .with("conditions", unmodelled.join(", "))
                .detail(format!(
                    "The model does not use {} as an input; each is recorded with the assessment and checked against training coverage only.",
                    unmodelled.join(", ")
                )),
        );
    }

    // Readiness per candidate. Only ready candidates reach the sidecar.
    let mut prepared: Vec<(usize, ReadyCandidate)> = Vec::new();
    let mut per_candidate_reasons: Vec<Vec<Message>> = Vec::new();
    for (index, candidate) in candidates.iter().enumerate() {
        let mut reasons = Vec::new();
        let ready = candidate_readiness(
            &connection,
            &model,
            candidate,
            &context,
            descriptor_failures.get(&candidate.id),
            &mut reasons,
        )?;
        if let Some(ready) = ready {
            prepared.push((index, ready));
        }
        per_candidate_reasons.push(reasons);
    }

    let mut evidence_by_index: BTreeMap<usize, Value> = BTreeMap::new();
    let mut model_evidence = Value::Null;
    let mut sidecar_warnings: Vec<Value> = Vec::new();
    if !prepared.is_empty() {
        let items: Vec<Value> = prepared
            .iter()
            .map(|(index, ready)| {
                json!({
                    "id": candidates[*index].id,
                    "label": candidates[*index].name,
                    "smiles": candidates[*index].smiles_canonical,
                    "features": ready.features
                })
            })
            .collect();
        let response = match run_sidecar_command(
            &app,
            "assess-candidates",
            json!({
                "model_path": model.path,
                "feature_schema_version": FEATURE_SCHEMA_VERSION,
                "items": items
            }),
        )
        .await
        {
            Ok(response) => response,
            Err(err) => {
                job.fail(0, candidates.len() as i64, &err)?;
                return Err(err);
            }
        };
        sidecar_warnings = response
            .get("warnings")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let data = response.get("data").cloned().unwrap_or_else(|| json!({}));
        model_evidence = data.get("model_evidence").cloned().unwrap_or(Value::Null);
        let by_id: BTreeMap<String, Value> = data
            .get("items")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item["id"].as_str().map(|id| (id.to_string(), item.clone())))
                    .collect()
            })
            .unwrap_or_default();
        for (index, _) in &prepared {
            if let Some(item) = by_id.get(&candidates[*index].id) {
                evidence_by_index.insert(*index, item.clone());
            }
        }
    }

    let now = Utc::now().to_rfc3339();
    let mut connection = connection;
    let tx = connection
        .transaction()
        .map_err(|err| format!("Failed to start the assessment transaction: {err}"))?;
    let mut results = Vec::new();
    let mut supported = 0_i64;
    let mut exploratory = 0_i64;
    let mut unavailable = 0_i64;
    let ready_index: BTreeMap<usize, &ReadyCandidate> = prepared
        .iter()
        .map(|(index, ready)| (*index, ready))
        .collect();
    for (index, candidate) in candidates.iter().enumerate() {
        let mut reasons: Vec<Message> = per_candidate_reasons[index].clone();
        let structural = json!({
            "status": if candidate.validation_status == "valid" { "compliant" } else { "rejected" },
            "template": candidate.template_id,
            "findings": candidate.validation.get("findings").cloned().unwrap_or_else(|| json!([]))
        });
        let ready = ready_index.get(&index);
        let evidence = evidence_by_index.get(&index);
        let (status, predicted, domain, coverage) = match (ready, evidence) {
            (Some(ready), Some(item)) => {
                let mut domain_reasons = Vec::new();
                let domain_state = domain_status(&item["evidence"], &mut domain_reasons);
                let mut coverage_reasons = Vec::new();
                let (all_covered, coverage) = condition_coverage(
                    &model,
                    &context,
                    ready.concentration,
                    &mut coverage_reasons,
                );
                reasons.extend(domain_reasons);
                reasons.extend(coverage_reasons);
                let status = if support_status == "unseenMolecules"
                    && domain_state == "within"
                    && all_covered
                    && !multi_additive
                {
                    "supported"
                } else {
                    "exploratory"
                };
                (
                    status,
                    item["value"].as_f64(),
                    json!({ "status": domain_state, "evidence": item["evidence"] }),
                    coverage,
                )
            }
            (Some(_), None) => {
                reasons.push(
                    Message::new(messages::DESIGN_FEATURES_MISSING)
                        .detail("The sidecar returned no result for this candidate."),
                );
                (
                    "unavailable",
                    None,
                    json!({ "status": "unknown" }),
                    Value::Null,
                )
            }
            (None, _) => (
                "unavailable",
                None,
                json!({ "status": "unknown" }),
                Value::Null,
            ),
        };
        match status {
            "supported" => supported += 1,
            "exploratory" => exploratory += 1,
            _ => unavailable += 1,
        }
        let readiness = json!({
            "status": if ready.is_some() { "ready" } else { "unavailable" },
            "model": { "id": model.id, "name": model.name, "featureSchemaVersion": model.feature_schema_version, "concentrationBasis": model.concentration_basis.as_str(), "datasetScope": model.dataset_scope.to_json() },
            "conditionHandling": handling,
            "reasons": messages::to_json_array(&per_candidate_reasons[index])
        });
        let all_reasons: Vec<Message> = model_reasons
            .iter()
            .cloned()
            .chain(reasons.iter().cloned())
            .collect();
        let assessment = json!({
            "status": status,
            "structural": structural,
            "readiness": readiness,
            "domain": domain,
            "conditionCoverage": coverage,
            "validationSupport": support,
            "modelReasons": messages::to_json_array(&model_reasons),
            "reasons": messages::to_json_array(&all_reasons),
            "synthesisFeasibility": { "status": "not_assessed" },
            "modelEvidence": model_evidence
        });
        let prediction_id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO design_predictions (
                id, candidate_id, job_id, model_id, model_name, model_version,
                feature_schema_version, target, unit, status, predicted_value, context_json,
                assessment_json, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                &prediction_id,
                &candidate.id,
                job.id(),
                &model.id,
                &model.name,
                &model.model_version,
                &model.feature_schema_version,
                &model.target,
                unit,
                status,
                predicted,
                context.to_json().to_string(),
                assessment.to_string(),
                &now
            ],
        )
        .map_err(|err| format!("Failed to record an assessment: {err}"))?;
        results.push(json!({
            "predictionId": prediction_id,
            "candidateId": candidate.id,
            "candidateName": candidate.name,
            "smilesCanonical": candidate.smiles_canonical,
            "status": status,
            "predictedValue": predicted,
            "target": model.target,
            "unit": unit,
            "label": label,
            "labelCode": crate::commands::analysis::metric_label_code(&model.target),
            "assessment": assessment,
            "createdAt": now
        }));
    }
    tx.commit()
        .map_err(|err| format!("Failed to commit the assessments: {err}"))?;

    let summary = json!({
        "jobId": job.id(),
        "modelId": model.id,
        "modelName": model.name,
        "target": model.target,
        "label": label,
        "labelCode": crate::commands::analysis::metric_label_code(&model.target),
        "unit": unit,
        "context": context.to_json(),
        "conditionHandling": handling,
        "validationSupport": support,
        "modelReasons": messages::to_json_array(&model_reasons),
        "modelEvidence": model_evidence,
        "counts": { "supported": supported, "exploratory": exploratory, "unavailable": unavailable },
        "descriptorFailures": descriptor_failures,
        "items": results,
        "warnings": sidecar_warnings,
        "mode": "real"
    });
    job.succeed(supported + exploratory, unavailable, &summary)?;
    ok("assess_design_candidates", summary)
}

// --- Promotion, verification, export ---------------------------------------------------------------

/// Copies one candidate into the molecule library, through the library's own save path.
///
/// The structure is re-standardised and its descriptors recalculated by the same sidecar command
/// the entry form uses, so a promoted molecule is indistinguishable in provenance quality from a
/// typed one — and its origin is written into its notes and source, not hidden.
#[tauri::command]
pub async fn promote_design_candidate(
    app: AppHandle,
    candidate_id: String,
    name: Option<String>,
    category: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<Value, String> {
    let connection = open(&app)?;
    let candidate = load_candidate_rows(&connection, std::slice::from_ref(&candidate_id), false)?
        .into_iter()
        .next()
        .ok_or_else(|| coded(errors::DESIGN_CANDIDATE_NOT_FOUND, "Candidate not found."))?;
    if candidate.validation_status != "valid" {
        return Err(coded(
            errors::DESIGN_PROMOTION_REFUSED,
            "The candidate failed structural validation and cannot enter the library.",
        ));
    }
    if !candidate.promoted_molecule_id.is_empty() {
        return Err(coded(
            errors::DESIGN_PROMOTION_REFUSED,
            format!(
                "The candidate was already promoted as molecule {}.",
                candidate.promoted_molecule_id
            ),
        ));
    }
    if let Some((existing_id, existing_name)) = find_existing_molecule(
        &connection,
        &candidate.inchi_key,
        &candidate.smiles_canonical,
    )? {
        connection
            .execute(
                "UPDATE design_candidates SET existing_molecule_id = ?2, updated_at = ?3 WHERE id = ?1",
                params![candidate.id, existing_id, Utc::now().to_rfc3339()],
            )
            .map_err(|err| format!("Failed to link the candidate to its library match: {err}"))?;
        return Err(coded(
            errors::DESIGN_PROMOTION_REFUSED,
            format!(
                "The library already holds this structure as '{existing_name}' ({existing_id})."
            ),
        ));
    }
    drop(connection);

    let notes = format!(
        "Generated by LMD molecular design. Template: {}; generator: {}; job: {}; candidate: {}; random seed: {}. Performance predictions recorded for this candidate are model outputs, not measurements.",
        candidate.template_id,
        candidate.generator_version,
        candidate.job_id,
        candidate.id,
        candidate
            .random_seed
            .map(|seed| seed.to_string())
            .unwrap_or_else(|| "none".to_string())
    );
    let payload = crate::commands::molecule::SaveMoleculePayload {
        name: name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| candidate.name.clone()),
        aliases: None,
        smiles: candidate.smiles_canonical.clone(),
        category: Some(category.unwrap_or_else(|| "candidate".to_string())),
        data_source: Some("molecular_design".to_string()),
        notes: Some(notes),
        additive_function_tags: tags,
    };
    let molecule =
        crate::commands::molecule::save_molecule_with_required_descriptors(app.clone(), payload)
            .await?;

    let connection = open(&app)?;
    connection
        .execute(
            "UPDATE design_candidates SET promoted_molecule_id = ?2, updated_at = ?3 WHERE id = ?1",
            params![candidate.id, molecule.id, Utc::now().to_rfc3339()],
        )
        .map_err(|err| format!("Failed to record the promotion: {err}"))?;
    let refreshed = load_candidate_rows(&connection, std::slice::from_ref(&candidate.id), false)?;
    ok(
        "promote_design_candidate",
        json!({
            "candidate": refreshed.first().map(candidate_to_json).unwrap_or(Value::Null),
            "moleculeId": molecule.id,
            "moleculeName": molecule.name
        }),
    )
}

/// Records whether a candidate has been tested. This is the only place experimental status is
/// written, and it never touches a prediction.
#[tauri::command]
pub fn update_design_candidate_verification(
    app: AppHandle,
    candidate_id: String,
    status: String,
    notes: Option<String>,
) -> Result<Value, String> {
    if !VERIFICATION_STATUSES.contains(&status.as_str()) {
        return Err(coded(
            errors::DESIGN_REQUEST_INVALID,
            format!(
                "Unknown verification status '{status}'. Use one of: {}.",
                VERIFICATION_STATUSES.join(", ")
            ),
        ));
    }
    let connection = open(&app)?;
    let changed = connection
        .execute(
            "UPDATE design_candidates SET verification_status = ?2, verification_notes = ?3,
                    updated_at = ?4 WHERE id = ?1",
            params![
                candidate_id,
                status,
                notes.unwrap_or_default(),
                Utc::now().to_rfc3339()
            ],
        )
        .map_err(|err| format!("Failed to update the verification status: {err}"))?;
    if changed == 0 {
        return Err(coded(
            errors::DESIGN_CANDIDATE_NOT_FOUND,
            format!("Candidate not found: {candidate_id}"),
        ));
    }
    let refreshed = load_candidate_rows(&connection, &[candidate_id], false)?;
    ok(
        "update_design_candidate_verification",
        json!({ "candidate": refreshed.first().map(candidate_to_json).unwrap_or(Value::Null) }),
    )
}

/// Writes the selected candidates, with their latest assessment, as a CSV in the workspace.
#[tauri::command]
pub fn export_design_candidates(
    app: AppHandle,
    candidate_ids: Vec<String>,
) -> Result<Value, String> {
    if candidate_ids.is_empty() {
        return Err(coded(
            errors::DESIGN_REQUEST_INVALID,
            "Select at least one candidate to export.",
        ));
    }
    let connection = open(&app)?;
    let candidates = load_candidate_rows(&connection, &candidate_ids, false)?;
    let headers = [
        "candidate_id",
        "name",
        "smiles_canonical",
        "inchi_key",
        "formula",
        "molecular_weight",
        "template_id",
        "chemical_classes",
        "substituents",
        "seed_ids",
        "generator_version",
        "random_seed",
        "job_id",
        "validation_status",
        "in_library",
        "existing_molecule_id",
        "promoted_molecule_id",
        "verification_status",
        "latest_prediction_status",
        "latest_prediction_target",
        "latest_prediction_value",
        "latest_prediction_unit",
        "latest_prediction_model",
        "synthesis_feasibility",
        "created_at",
    ]
    .iter()
    .map(ToString::to_string)
    .collect::<Vec<_>>();
    let mut lines = vec![crate::commands::export::csv_row(&headers)];
    for candidate in &candidates {
        let latest = &candidate.latest_assessment;
        let text = |value: &Value| match value {
            Value::Null => String::new(),
            Value::String(text) => text.clone(),
            other => other.to_string(),
        };
        let substituents = candidate
            .substituents
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item["smiles"].as_str())
                    .collect::<Vec<_>>()
                    .join("; ")
            })
            .unwrap_or_default();
        let classes = candidate
            .chemical_classes
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join("; ")
            })
            .unwrap_or_default();
        let seeds = candidate
            .seed_ids
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join("; ")
            })
            .unwrap_or_default();
        let fields = vec![
            candidate.id.clone(),
            candidate.name.clone(),
            candidate.smiles_canonical.clone(),
            candidate.inchi_key.clone(),
            candidate.formula.clone(),
            candidate
                .molecular_weight
                .map(|value| value.to_string())
                .unwrap_or_default(),
            candidate.template_id.clone(),
            classes,
            substituents,
            seeds,
            candidate.generator_version.clone(),
            candidate
                .random_seed
                .map(|seed| seed.to_string())
                .unwrap_or_default(),
            candidate.job_id.clone(),
            candidate.validation_status.clone(),
            (!candidate.existing_molecule_id.is_empty()
                || !candidate.promoted_molecule_id.is_empty())
            .to_string(),
            candidate.existing_molecule_id.clone(),
            candidate.promoted_molecule_id.clone(),
            candidate.verification_status.clone(),
            text(&latest["status"]),
            text(&latest["target"]),
            text(&latest["predictedValue"]),
            text(&latest["unit"]),
            text(&latest["modelName"]),
            "not_assessed".to_string(),
            candidate.created_at.clone(),
        ];
        lines.push(crate::commands::export::csv_row(&fields));
    }
    let path = crate::commands::export::export_path(
        &app,
        &crate::commands::export::timestamped("design-candidates"),
    )?;
    std::fs::write(&path, lines.join("\n"))
        .map_err(|err| format!("Failed to write the candidate export: {err}"))?;
    ok(
        "export_design_candidates",
        json!({
            "path": path,
            "row_count": candidates.len(),
            "column_count": headers.len(),
            "mode": "real"
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::INIT_SCHEMA_SQL;

    fn workspace() -> Connection {
        let connection = Connection::open_in_memory().expect("sqlite should open");
        connection
            .execute_batch(INIT_SCHEMA_SQL)
            .expect("schema should initialize");
        connection
            .execute_batch(
                "INSERT INTO jobs (id, job_type, status, created_at, updated_at)
                   VALUES ('job-1', 'design_generate', 'succeeded', '2026-01-01', '2026-01-01');
                 INSERT INTO molecules (id, name, smiles_canonical, inchi_key, created_at, updated_at)
                   VALUES ('mol-lib', 'Tributyl phosphate', 'CCCCOP(=O)(OCCCC)OCCCC', 'KEY-TBP', '2026-01-01', '2026-01-01');",
            )
            .expect("fixtures should insert");
        connection
    }

    fn insert_candidate(connection: &Connection, id: &str, smiles: &str, inchi_key: &str) {
        connection
            .execute(
                "INSERT INTO design_candidates (
                    id, job_id, name, smiles_canonical, inchi_key, template_id, template_family,
                    generator_version, validation_status, validation_json, created_at, updated_at
                 ) VALUES (?1, 'job-1', ?1, ?2, ?3, 'phosphate_triester', 'phosphate_ester',
                           'phosphate-template-1.0.0', 'valid', '{\"status\":\"valid\",\"findings\":[]}',
                           '2026-01-02', '2026-01-02')",
                params![id, smiles, inchi_key],
            )
            .expect("candidate should insert");
    }

    fn model(
        basis: ConcentrationBasis,
        feature_order: &[&str],
        scope: DatasetScope,
        domain: Value,
    ) -> StoredModel {
        StoredModel {
            id: "m-1".to_string(),
            name: "Wear model".to_string(),
            target: "wear_scar_diameter_value".to_string(),
            algorithm: "ridge".to_string(),
            model_version: "1".to_string(),
            trained_at: "2026-01-01".to_string(),
            split_method: crate::commands::model::split_method_for_tests("linked"),
            dataset_mode: "additive_component".to_string(),
            feature_schema_version: FEATURE_SCHEMA_VERSION.to_string(),
            concentration_basis: basis,
            feature_order: feature_order.iter().map(ToString::to_string).collect(),
            metrics: json!({ "validation": { "r2": 0.5, "mae": 0.1, "rmse": 0.2, "sample_count": 8, "molecule_count": 3 } }),
            sample_count: 30,
            molecule_count: 10,
            validated: true,
            dataset_scope: scope,
            domain,
            path: std::path::PathBuf::from("unused"),
        }
    }

    fn domain_with_conditions() -> Value {
        json!({
            "molecule_count": 10,
            "conditions": {
                "test_types": { "four-ball": 30 },
                "base_oils": [{ "id": "bo-1", "name": "PAO-6", "rows": 30 }],
                "concentration_range": [0.5, 2.0],
                "temperature_ranges": { "°C": [60.0, 100.0] },
                "load_ranges": { "N": [200.0, 400.0], "kgf": [20.0, 50.0] },
                "single_additive_rows": 30
            }
        })
    }

    #[test]
    fn a_generated_candidate_is_never_a_molecule_until_promoted() {
        let connection = workspace();
        insert_candidate(&connection, "cand-1", "CCOP(=O)(OCC)OCC", "KEY-TEP");

        let molecules: i64 = connection
            .query_row("SELECT COUNT(*) FROM molecules", [], |row| row.get(0))
            .expect("count");
        let candidates: i64 = connection
            .query_row("SELECT COUNT(*) FROM design_candidates", [], |row| {
                row.get(0)
            })
            .expect("count");
        assert_eq!((molecules, candidates), (1, 1));

        let rows = load_candidate_rows(&connection, &["cand-1".to_string()], false).expect("loads");
        assert_eq!(rows[0].promoted_molecule_id, "");
        assert_eq!(rows[0].existing_molecule_id, "");
        let json = candidate_to_json(&rows[0]);
        assert_eq!(json["inLibrary"], false);
        assert_eq!(json["synthesisFeasibility"]["status"], "not_assessed");
        assert_eq!(json["verificationStatus"], "not_verified");
    }

    #[test]
    fn an_existing_library_structure_is_recognised_by_inchi_key_or_smiles() {
        let connection = workspace();
        let by_key = find_existing_molecule(&connection, "KEY-TBP", "").expect("query");
        assert_eq!(by_key.map(|(id, _)| id), Some("mol-lib".to_string()));
        let by_smiles =
            find_existing_molecule(&connection, "", "CCCCOP(=O)(OCCCC)OCCCC").expect("query");
        assert!(by_smiles.is_some());
        let absent =
            find_existing_molecule(&connection, "KEY-NEW", "CCOP(=O)(OCC)OCC").expect("query");
        assert!(
            absent.is_none(),
            "absence from the workspace is all that is claimed"
        );
        // Blank keys must not match blank columns.
        assert!(find_existing_molecule(&connection, "", "")
            .expect("query")
            .is_none());
    }

    #[test]
    fn an_unknown_candidate_is_an_error_with_a_code() {
        let connection = workspace();
        let error = load_candidate_rows(&connection, &["missing".to_string()], false)
            .expect_err("unknown candidate");
        assert!(error.starts_with("[design.candidateNotFound]"), "{error}");
    }

    #[test]
    fn the_request_is_bounded_and_named() {
        let error = DesignRequest::parse(
            &json!({ "templateId": "phosphate_triester", "maxCandidates": 5000 }),
        )
        .expect_err("over the bound");
        assert!(error.starts_with("[design.requestInvalid]"), "{error}");
        let error = DesignRequest::parse(&json!({ "maxCandidates": 10 })).expect_err("no template");
        assert!(error.contains("template"), "{error}");
        let error = DesignRequest::parse(
            &json!({ "templateId": "x", "maxCandidates": 10, "targetMetric": "nonsense" }),
        )
        .expect_err("unknown metric");
        assert!(error.contains("Unsupported performance metric"), "{error}");

        let request = DesignRequest::parse(&json!({
            "templateId": "phosphate_triester",
            "maxCandidates": 10,
            "targetFunction": "antiwear",
            "targetMetric": "wear_scar_diameter_value",
            "context": { "baseOilId": "bo-1", "concentration": 1.0, "concentrationUnit": "wt%", "testType": "four-ball" }
        }))
        .expect("a well-formed request");
        let stored = request.to_json();
        // The three dimensions are stored apart; the function is intent, not a property.
        assert_eq!(stored["chemicalClass"]["templateId"], "phosphate_triester");
        assert_eq!(stored["targetFunction"]["function"], "antiwear");
        assert_eq!(stored["applicationContext"]["baseOilId"], "bo-1");
    }

    #[test]
    fn a_seed_request_does_not_require_a_template() {
        let request = DesignRequest::parse(&json!({
            "seeds": [{"source": "user", "smiles": "CCCOCC"}],
            "candidateConstraints": {"max_heavy_atoms": 12},
            "maxCandidates": 10
        }))
        .expect("seed-derived generation");
        let stored = request.to_json();
        assert_eq!(stored["chemicalClass"]["templateId"], "");
        assert_eq!(
            stored["chemicalClass"]["candidateConstraints"]["max_heavy_atoms"],
            12
        );
        assert_eq!(request.seeds.len(), 1);
    }

    #[test]
    fn seeds_are_resolved_from_the_library_or_taken_as_typed() {
        let connection = workspace();
        let seeds = resolve_seeds(
            &connection,
            &[
                SeedRequest {
                    source: "library".into(),
                    molecule_id: "mol-lib".into(),
                    ..SeedRequest::default()
                },
                SeedRequest {
                    source: "user".into(),
                    smiles: "CCCCCCCCO".into(),
                    label: "octanol".into(),
                    ..SeedRequest::default()
                },
            ],
        )
        .expect("resolves");
        assert_eq!(seeds[0]["smiles"], "CCCCOP(=O)(OCCCC)OCCCC");
        assert_eq!(seeds[0]["label"], "Tributyl phosphate");
        assert_eq!(seeds[1]["id"], "user:octanol");
        let error = resolve_seeds(
            &connection,
            &[SeedRequest {
                source: "library".into(),
                molecule_id: "nope".into(),
                ..SeedRequest::default()
            }],
        )
        .expect_err("unknown molecule");
        assert!(error.starts_with("[record.notFound]"), "{error}");
    }

    #[test]
    fn condition_handling_names_what_the_model_uses_and_what_it_only_covers() {
        let plain = model(
            ConcentrationBasis::MassPercent,
            &["rdkit_MolWt", "concentration"],
            DatasetScope::default(),
            json!({}),
        );
        let handling = condition_handling(&plain);
        assert_eq!(handling["concentration"], "feature");
        assert_eq!(handling["testType"], "coverageOnly");
        assert_eq!(handling["temperature"], "coverageOnly");
        assert_eq!(handling["baseOil"], "coverageOnly");
        assert_eq!(handling["otherComponents"], "recordedOnly");

        let scoped = model(
            ConcentrationBasis::None,
            &[
                "rdkit_MolWt",
                FEATURE_CONDITION_TEMPERATURE,
                FEATURE_CONDITION_LOAD,
            ],
            DatasetScope {
                test_type: "four-ball".into(),
                ..DatasetScope::default()
            },
            json!({}),
        );
        let handling = condition_handling(&scoped);
        assert_eq!(handling["concentration"], "notUsed");
        assert_eq!(handling["testType"], "scopeFilter");
        assert_eq!(handling["temperature"], "feature");
        assert_eq!(handling["load"], "feature");
    }

    #[test]
    fn condition_coverage_is_judged_against_the_training_records() {
        let fitted = model(
            ConcentrationBasis::MassPercent,
            &["rdkit_MolWt", "concentration"],
            DatasetScope::default(),
            domain_with_conditions(),
        );
        let context = ApplicationContext {
            base_oil_id: "bo-1".into(),
            base_oil_name: "PAO-6".into(),
            test_type: "four-ball".into(),
            temperature_value: Some(353.15),
            temperature_unit: "K".into(),
            load_value: Some(30.0),
            load_unit: "kgf".into(),
            ..ApplicationContext::default()
        };
        let mut reasons = Vec::new();
        let (covered, coverage) = condition_coverage(&fitted, &context, Some(1.0), &mut reasons);
        assert!(covered, "{coverage}");
        assert!(reasons.is_empty());
        assert_eq!(coverage["temperature"]["status"], "covered");
        assert_eq!(coverage["load"]["status"], "covered");

        let outside = ApplicationContext {
            base_oil_id: "bo-2".into(),
            base_oil_name: "Ester".into(),
            test_type: "SRV".into(),
            temperature_value: Some(150.0),
            temperature_unit: "°C".into(),
            ..ApplicationContext::default()
        };
        let mut reasons = Vec::new();
        let (covered, coverage) = condition_coverage(&fitted, &outside, Some(5.0), &mut reasons);
        assert!(!covered);
        let codes: Vec<&str> = reasons.iter().map(Message::code).collect();
        assert!(codes.contains(&messages::DESIGN_TEST_TYPE_NOT_COVERED));
        assert!(codes.contains(&messages::DESIGN_BASE_OIL_NOT_COVERED));
        assert!(codes.contains(&messages::DESIGN_CONCENTRATION_NOT_COVERED));
        assert!(codes.contains(&messages::DESIGN_CONDITION_NOT_COVERED));
        assert_eq!(coverage["load"]["status"], "notRequested");
    }

    #[test]
    fn a_model_without_recorded_domain_reports_coverage_as_not_recorded() {
        let old = model(
            ConcentrationBasis::MassPercent,
            &["rdkit_MolWt", "concentration"],
            DatasetScope::default(),
            json!({}),
        );
        let context = ApplicationContext {
            test_type: "SRV".into(),
            base_oil_id: "bo-1".into(),
            ..ApplicationContext::default()
        };
        let mut reasons = Vec::new();
        let (_, coverage) = condition_coverage(&old, &context, Some(1.0), &mut reasons);
        assert_eq!(coverage["recorded"], false);
        assert_eq!(coverage["testType"]["status"], "notRecorded");
        assert_eq!(coverage["concentration"]["status"], "notRecorded");
    }

    #[test]
    fn domain_status_reads_the_sidecar_evidence_without_inventing_a_number() {
        let mut reasons = Vec::new();
        assert_eq!(
            domain_status(&json!({ "domain_recorded": false }), &mut reasons),
            "unknown"
        );
        assert_eq!(reasons[0].code(), messages::DESIGN_DOMAIN_NOT_RECORDED);

        let mut reasons = Vec::new();
        let outside = json!({
            "domain_recorded": true,
            "feature_coverage": { "compared_features": 3, "outside_range_count": 1, "outside_range": [{ "feature": "rdkit_MolWt" }] },
            "nearest_training": { "identical_training_molecule": null }
        });
        assert_eq!(domain_status(&outside, &mut reasons), "outside");
        assert_eq!(reasons[0].code(), messages::DESIGN_DESCRIPTORS_OUT_OF_RANGE);

        let mut reasons = Vec::new();
        let within = json!({
            "domain_recorded": true,
            "feature_coverage": { "compared_features": 3, "outside_range_count": 0, "outside_range": [] },
            "nearest_training": { "identical_training_molecule": "mol-2" }
        });
        assert_eq!(domain_status(&within, &mut reasons), "within");
        assert_eq!(
            reasons[0].code(),
            messages::DESIGN_IDENTICAL_TRAINING_MOLECULE
        );
    }

    #[test]
    fn validation_support_distinguishes_unseen_molecule_evidence_from_weaker_splits() {
        let mut linked = model(
            ConcentrationBasis::MassPercent,
            &["rdkit_MolWt"],
            DatasetScope::default(),
            json!({}),
        );
        let mut reasons = Vec::new();
        assert_eq!(
            validation_support(&linked, &mut reasons).0,
            "unseenMolecules"
        );
        assert!(reasons.is_empty());

        linked.split_method = crate::commands::model::split_method_for_tests("formulation");
        let mut reasons = Vec::new();
        assert_eq!(
            validation_support(&linked, &mut reasons).0,
            "formulationsOnly"
        );
        assert_eq!(
            reasons[0].code(),
            messages::DESIGN_VALIDATION_NOT_MOLECULE_GROUPED
        );

        linked.validated = false;
        linked.metrics = json!({ "training_only": { "r2": 0.9 } });
        let mut reasons = Vec::new();
        assert_eq!(validation_support(&linked, &mut reasons).0, "none");
        assert_eq!(reasons[0].code(), messages::DESIGN_NO_HELD_OUT_VALIDATION);
    }

    #[test]
    fn readiness_refuses_before_any_number_is_computed() {
        let connection = workspace();
        insert_candidate(&connection, "cand-1", "CCOP(=O)(OCC)OCC", "KEY-TEP");
        let candidate = load_candidate_rows(&connection, &["cand-1".to_string()], false)
            .expect("loads")
            .remove(0);
        let fitted = model(
            ConcentrationBasis::MassPercent,
            &["rdkit_MolWt", "concentration"],
            DatasetScope::default(),
            json!({}),
        );

        // No descriptors yet.
        let mut reasons = Vec::new();
        let ready = candidate_readiness(
            &connection,
            &fitted,
            &candidate,
            &ApplicationContext::default(),
            None,
            &mut reasons,
        )
        .expect("runs");
        assert!(ready.is_none());
        assert_eq!(reasons[0].code(), messages::DESIGN_DESCRIPTORS_UNAVAILABLE);

        connection
            .execute(
                "INSERT INTO design_candidate_descriptors (id, candidate_id, descriptor_set, descriptors_json, descriptor_count, status, mode)
                 VALUES ('d-1', 'cand-1', 'rdkit', '{\"MolWt\": 182.0}', 1, 'calculated', 'real')",
                [],
            )
            .expect("descriptor inserts");

        // A wt% model with no concentration supplied: the basis is not met.
        let mut reasons = Vec::new();
        let ready = candidate_readiness(
            &connection,
            &fitted,
            &candidate,
            &ApplicationContext::default(),
            None,
            &mut reasons,
        )
        .expect("runs");
        assert!(ready.is_none());
        assert_eq!(
            reasons[0].code(),
            messages::DESIGN_CONCENTRATION_INCOMPATIBLE
        );

        // Supplied on the right basis: ready, with the columns in the model's order.
        let context = ApplicationContext {
            concentration: Some(1.5),
            concentration_unit: "wt%".into(),
            ..ApplicationContext::default()
        };
        let mut reasons = Vec::new();
        let ready = candidate_readiness(
            &connection,
            &fitted,
            &candidate,
            &context,
            None,
            &mut reasons,
        )
        .expect("runs")
        .expect("ready");
        assert!(reasons.is_empty());
        // `Map` keeps keys sorted; the sidecar orders columns by the model's feature order.
        let mut keys = ready.features.keys().cloned().collect::<Vec<_>>();
        keys.sort();
        assert_eq!(keys, vec!["concentration", "rdkit_MolWt"]);
        assert_eq!(ready.concentration, Some(1.5));

        // A condition-aware model without conditions supplied: unavailable, and says which.
        let conditioned = model(
            ConcentrationBasis::MassPercent,
            &[
                "rdkit_MolWt",
                "concentration",
                FEATURE_CONDITION_TEMPERATURE,
                FEATURE_CONDITION_LOAD,
            ],
            DatasetScope::default(),
            json!({}),
        );
        let mut reasons = Vec::new();
        let ready = candidate_readiness(
            &connection,
            &conditioned,
            &candidate,
            &context,
            None,
            &mut reasons,
        )
        .expect("runs");
        assert!(ready.is_none());
        assert_eq!(reasons[0].code(), messages::DESIGN_CONDITIONS_REQUIRED);

        // A scoped model asked about another test type: incompatible, not silently answered.
        let scoped = model(
            ConcentrationBasis::MassPercent,
            &["rdkit_MolWt", "concentration"],
            DatasetScope {
                test_type: "four-ball".into(),
                ..DatasetScope::default()
            },
            json!({}),
        );
        let srv = ApplicationContext {
            test_type: "SRV".into(),
            ..context.clone()
        };
        let mut reasons = Vec::new();
        let ready = candidate_readiness(&connection, &scoped, &candidate, &srv, None, &mut reasons)
            .expect("runs");
        assert!(ready.is_none());
        assert_eq!(reasons[0].code(), messages::DESIGN_TEST_TYPE_INCOMPATIBLE);

        // A descriptor failure reported by the sidecar is an input failure, named as such.
        let failure = "Invalid SMILES.".to_string();
        let mut reasons = Vec::new();
        let ready = candidate_readiness(
            &connection,
            &fitted,
            &candidate,
            &context,
            Some(&failure),
            &mut reasons,
        )
        .expect("runs");
        assert!(ready.is_none());
        assert_eq!(reasons[0].code(), messages::DESIGN_DESCRIPTORS_UNAVAILABLE);
    }

    #[test]
    fn verification_statuses_are_a_closed_set() {
        assert_eq!(
            VERIFICATION_STATUSES,
            ["not_verified", "planned", "verified", "refuted"]
        );
    }

    #[test]
    fn predictions_never_reach_the_training_join() {
        // The dataset builder reads performance_results only; a stored prediction is invisible to
        // it. Asserted structurally: the training query names no design table.
        let source = include_str!("model.rs");
        let query_start = source
            .find("FROM performance_results r")
            .expect("the training join");
        let query = &source[query_start..query_start + 600];
        assert!(!query.contains("design_predictions"));
        assert!(!query.contains("design_candidates"));
    }
}
