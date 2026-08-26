use crate::app_paths::default_database_path;
use crate::commands::attachments;
use crate::commands::pagination::{self, EntityOption, Page, PageRequest, MAX_SEARCH_RESULTS};
use crate::commands::patch;
use crate::commands::validation;
use crate::db::open_database;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use tauri::AppHandle;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulationComponentDto {
    pub id: String,
    pub formulation_id: String,
    pub component_role: String,
    pub molecule_id: String,
    pub base_oil_id: String,
    pub additive_id: String,
    /// Resolved display names, so a comparison shows what a component is rather than its id.
    pub molecule_name: String,
    pub base_oil_name: String,
    pub additive_name: String,
    pub concentration_value: Option<f64>,
    pub concentration_unit: String,
    pub concentration_standard_value: Option<f64>,
    pub concentration_standard_unit: String,
    pub notes: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulationDto {
    pub id: String,
    pub name: String,
    pub base_oil: String,
    pub additive_count: i64,
    pub components: Vec<FormulationComponentDto>,
    pub components_summary: String,
    pub preparation_method: String,
    pub preparation_temperature: Option<f64>,
    pub preparation_temperature_unit: String,
    pub preparation_time: Option<f64>,
    pub preparation_time_unit: String,
    pub stability_observation: String,
    pub experiment_count: i64,
    pub best_average_friction_coefficient: Option<f64>,
    pub best_wear_scar_diameter: Option<f64>,
    pub highest_oxidation_temperature: Option<f64>,
    pub best_extreme_pressure_value: Option<f64>,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

/// One component of a blend, as the entry screen and the CSV importer both describe it.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulationComponentRequest {
    #[serde(default, deserialize_with = "validation::optional_text")]
    pub id: Option<String>,
    #[serde(
        default,
        alias = "component_role",
        deserialize_with = "validation::optional_text"
    )]
    pub component_role: Option<String>,
    #[serde(
        default,
        alias = "molecule_id",
        deserialize_with = "validation::optional_text"
    )]
    pub molecule_id: Option<String>,
    #[serde(
        default,
        alias = "base_oil_id",
        deserialize_with = "validation::optional_text"
    )]
    pub base_oil_id: Option<String>,
    #[serde(
        default,
        alias = "additive_id",
        deserialize_with = "validation::optional_text"
    )]
    pub additive_id: Option<String>,
    #[serde(
        default,
        alias = "concentration_value",
        deserialize_with = "validation::optional_number"
    )]
    pub concentration_value: Option<f64>,
    #[serde(
        default,
        alias = "concentration_unit",
        deserialize_with = "validation::optional_text"
    )]
    pub concentration_unit: Option<String>,
    #[serde(
        default,
        alias = "concentration_standard_value",
        deserialize_with = "validation::optional_number"
    )]
    pub concentration_standard_value: Option<f64>,
    #[serde(
        default,
        alias = "concentration_standard_unit",
        deserialize_with = "validation::optional_text"
    )]
    pub concentration_standard_unit: Option<String>,
    #[serde(default, deserialize_with = "validation::optional_text")]
    pub notes: Option<String>,
}

/// A whole blend: its preparation and every component in it.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormulationWriteRequest {
    #[serde(default, deserialize_with = "validation::optional_text")]
    pub id: Option<String>,
    #[serde(default, deserialize_with = "validation::optional_text")]
    pub name: Option<String>,
    #[serde(default)]
    pub components: Option<Vec<FormulationComponentRequest>>,
    #[serde(
        default,
        alias = "preparation_method",
        deserialize_with = "validation::optional_text"
    )]
    pub preparation_method: Option<String>,
    #[serde(
        default,
        alias = "preparation_temperature",
        deserialize_with = "validation::optional_number"
    )]
    pub preparation_temperature: Option<f64>,
    #[serde(
        default,
        alias = "preparation_temperature_unit",
        deserialize_with = "validation::optional_text"
    )]
    pub preparation_temperature_unit: Option<String>,
    #[serde(
        default,
        alias = "preparation_time",
        deserialize_with = "validation::optional_number"
    )]
    pub preparation_time: Option<f64>,
    #[serde(
        default,
        alias = "preparation_time_unit",
        deserialize_with = "validation::optional_text"
    )]
    pub preparation_time_unit: Option<String>,
    #[serde(
        default,
        alias = "stability_observation",
        deserialize_with = "validation::optional_text"
    )]
    pub stability_observation: Option<String>,
    #[serde(default, deserialize_with = "validation::optional_text")]
    pub notes: Option<String>,
}

/// A component that has passed every rule, with the one entity it references resolved.
#[derive(Debug)]
pub struct ValidatedComponent {
    pub id: String,
    pub role: String,
    pub reference: validation::ComponentReference,
    pub concentration_value: Option<f64>,
    pub concentration_unit: Option<String>,
    pub concentration_standard_value: Option<f64>,
    pub concentration_standard_unit: Option<String>,
    pub notes: String,
}

impl ValidatedComponent {
    fn molecule_id(&self) -> Option<&str> {
        match &self.reference {
            validation::ComponentReference::Molecule(id) => Some(id),
            _ => None,
        }
    }
    fn base_oil_id(&self) -> Option<&str> {
        match &self.reference {
            validation::ComponentReference::BaseOil(id) => Some(id),
            _ => None,
        }
    }
    fn additive_id(&self) -> Option<&str> {
        match &self.reference {
            validation::ComponentReference::Additive(id) => Some(id),
            _ => None,
        }
    }
}

/// A blend that has passed every rule.
#[derive(Debug)]
pub struct ValidatedFormulation {
    pub id: String,
    pub name: String,
    pub components: Vec<ValidatedComponent>,
    pub preparation_method: String,
    pub preparation_temperature: Option<f64>,
    pub preparation_temperature_unit: Option<String>,
    pub preparation_time: Option<f64>,
    pub preparation_time_unit: Option<String>,
    pub stability_observation: String,
    pub notes: String,
}

impl FormulationComponentRequest {
    fn validate(self) -> Result<ValidatedComponent, String> {
        // The role first: every later rule is stated in terms of it.
        let role = validation::require_component_role(self.component_role.as_deref())?;
        let reference = validation::require_single_reference(
            &role,
            self.base_oil_id.as_deref(),
            self.additive_id.as_deref(),
            self.molecule_id.as_deref(),
        )?;
        Ok(ValidatedComponent {
            id: self.id.unwrap_or_else(|| Uuid::new_v4().to_string()),
            role,
            reference,
            concentration_value: validation::require_positive_concentration(
                self.concentration_value,
                "The component concentration",
            )?,
            concentration_unit: validation::require_concentration_unit(
                self.concentration_unit.as_deref(),
                validation::CONCENTRATION_UNITS,
                "concentration unit",
            )?,
            concentration_standard_value: validation::require_positive_concentration(
                self.concentration_standard_value,
                "The standardized concentration",
            )?,
            concentration_standard_unit: validation::require_concentration_unit(
                self.concentration_standard_unit.as_deref(),
                validation::CONCENTRATION_UNITS,
                "standardized concentration unit",
            )?,
            notes: self.notes.unwrap_or_default(),
        })
    }
}

impl FormulationWriteRequest {
    /// Checks the whole blend before a statement is prepared.
    ///
    /// Every component is validated, and the *first* failure aborts the whole request. A blend
    /// whose third component is nonsense is not a blend with two good components: writing the
    /// first two would record a mixture nobody mixed.
    pub fn validate(self) -> Result<ValidatedFormulation, String> {
        let name = validation::require_name(self.name.as_deref(), "The formulation name")?;
        let components = self.components.unwrap_or_default();
        if components.is_empty() {
            return Err(crate::commands::errors::coded(
                crate::commands::errors::VALIDATION_PAYLOAD_EMPTY,
                "A formulation needs at least one component.",
            ));
        }
        let components = components
            .into_iter()
            .map(FormulationComponentRequest::validate)
            .collect::<Result<Vec<_>, _>>()?;
        if !components
            .iter()
            .any(|component| component.role == "base_oil")
        {
            return Err(crate::commands::errors::coded(
                crate::commands::errors::VALIDATION_COMPONENT_REFERENCE,
                "A formulation requires one base oil component.",
            ));
        }
        Ok(ValidatedFormulation {
            id: self.id.unwrap_or_else(|| Uuid::new_v4().to_string()),
            name,
            components,
            preparation_method: self.preparation_method.unwrap_or_default(),
            preparation_temperature: validation::require_finite(
                self.preparation_temperature,
                "The preparation temperature",
            )?,
            preparation_temperature_unit: self.preparation_temperature_unit,
            // A blend cannot have been stirred for minus four minutes.
            preparation_time: validation::require_non_negative(
                self.preparation_time,
                "The preparation time",
            )?,
            preparation_time_unit: self.preparation_time_unit,
            stability_observation: self.stability_observation.unwrap_or_default(),
            notes: self.notes.unwrap_or_default(),
        })
    }
}

/// Writes a validated blend and every component, or nothing at all.
///
/// Separated from the command so the transactional behaviour can be tested without a Tauri
/// application. Each referenced entity is confirmed to exist *inside* the transaction: doing it
/// outside would leave a window in which the record could be deleted between check and insert, and
/// leaving it to the foreign key would report a bare SQLite message instead of naming the record.
pub fn write_formulation(
    connection: &mut Connection,
    request: &ValidatedFormulation,
    now: &str,
) -> Result<String, String> {
    let transaction = connection
        .transaction()
        .map_err(|err| format!("Failed to start formulation create transaction: {err}"))?;

    for component in &request.components {
        let (table, label) = match &component.reference {
            validation::ComponentReference::BaseOil(_) => ("base_oils", "Base oil"),
            validation::ComponentReference::Additive(_) => ("additives", "Additive"),
            validation::ComponentReference::Molecule(_) => ("molecules", "Molecule"),
        };
        let exists: bool = transaction
            .query_row(
                &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id = ?1)"),
                params![component.reference.id()],
                |row| row.get(0),
            )
            .map_err(|err| format!("Failed to verify a formulation component: {err}"))?;
        if !exists {
            return Err(crate::commands::errors::coded(
                crate::commands::errors::RECORD_NOT_FOUND,
                format!("{label} does not exist: {}", component.reference.id()),
            ));
        }
    }

    transaction
        .execute(
            "INSERT INTO formulations (
                id, name, preparation_method, preparation_temperature, preparation_temperature_unit,
                preparation_time, preparation_time_unit, stability_observation, notes, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
            params![
                &request.id,
                &request.name,
                &request.preparation_method,
                request.preparation_temperature,
                request.preparation_temperature_unit.as_deref(),
                request.preparation_time,
                request.preparation_time_unit.as_deref(),
                &request.stability_observation,
                &request.notes,
                now
            ],
        )
        .map_err(|err| format!("Failed to create formulation: {err}"))?;

    for component in &request.components {
        transaction
            .execute(
                "INSERT INTO formulation_components (
                    id, formulation_id, component_role, molecule_id, base_oil_id, additive_id,
                    concentration_value, concentration_unit, concentration_standard_value,
                    concentration_standard_unit, notes
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    &component.id,
                    &request.id,
                    &component.role,
                    component.molecule_id(),
                    component.base_oil_id(),
                    component.additive_id(),
                    component.concentration_value,
                    component.concentration_unit.as_deref(),
                    component.concentration_standard_value,
                    component.concentration_standard_unit.as_deref(),
                    &component.notes
                ],
            )
            .map_err(|err| format!("Failed to create formulation component: {err}"))?;
    }

    transaction
        .commit()
        .map_err(|err| format!("Failed to commit formulation create transaction: {err}"))?;
    Ok(request.id.clone())
}

#[tauri::command]
pub fn create_formulation(app: AppHandle, payload: Value) -> Result<FormulationDto, String> {
    let request: FormulationWriteRequest = serde_json::from_value(payload).map_err(|err| {
        crate::commands::errors::coded(
            crate::commands::errors::VALIDATION_PAYLOAD_EMPTY,
            format!("The formulation payload could not be read: {err}"),
        )
    })?;
    let validated = request.validate()?;
    let now = Utc::now().to_rfc3339();
    let mut connection = open_connection(&app)?;
    let id = write_formulation(&mut connection, &validated, &now)?;
    get_formulation_by_id(&connection, &id)
}

/// The formulation columns plus every aggregate, joined once for the whole result set.
///
/// The list this replaced ran five extra queries for every formulation it returned — the base-oil
/// name, the additive count, the component summary, the component list, and the performance
/// summary. Twenty formulations meant a hundred and one queries to render one page. Here the
/// performance figures arrive as a grouped join and the components as a single second query
/// covering every formulation on the page.
pub const FORMULATION_SELECT: &str =
    "SELECT f.id, f.name, f.preparation_method, f.preparation_temperature,
            f.preparation_temperature_unit, f.preparation_time, f.preparation_time_unit,
            f.stability_observation, f.notes, f.created_at, f.updated_at,
            COALESCE(perf.experiment_count, 0), perf.best_friction, perf.best_wear,
            perf.highest_oxidation, perf.best_extreme_pressure
     FROM formulations f
     LEFT JOIN (
       SELECT e.formulation_id,
              COUNT(DISTINCT e.id) AS experiment_count,
              MIN(pr.average_friction_coefficient) AS best_friction,
              MIN(pr.wear_scar_diameter_value) AS best_wear,
              MAX(pr.initial_oxidation_temperature_value) AS highest_oxidation,
              MAX(pr.extreme_pressure_value) AS best_extreme_pressure
       FROM experiments e
       LEFT JOIN performance_results pr ON pr.experiment_id = e.id
       GROUP BY e.formulation_id
     ) perf ON perf.formulation_id = f.id";

pub const FORMULATION_ORDER: &str =
    " ORDER BY datetime(f.created_at) DESC, f.created_at DESC, f.id DESC";

/// The scalar half of a formulation row, before its components are attached.
struct FormulationShell {
    id: String,
    name: String,
    preparation_method: String,
    preparation_temperature: Option<f64>,
    preparation_temperature_unit: String,
    preparation_time: Option<f64>,
    preparation_time_unit: String,
    stability_observation: String,
    notes: String,
    created_at: String,
    updated_at: String,
    experiment_count: i64,
    best_average_friction_coefficient: Option<f64>,
    best_wear_scar_diameter: Option<f64>,
    highest_oxidation_temperature: Option<f64>,
    best_extreme_pressure_value: Option<f64>,
}

fn read_formulation_shell(row: &rusqlite::Row<'_>) -> rusqlite::Result<FormulationShell> {
    Ok(FormulationShell {
        id: row.get(0)?,
        name: row.get(1)?,
        preparation_method: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
        preparation_temperature: row.get(3)?,
        preparation_temperature_unit: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
        preparation_time: row.get(5)?,
        preparation_time_unit: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
        stability_observation: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
        notes: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
        experiment_count: row.get(11)?,
        best_average_friction_coefficient: row.get(12)?,
        best_wear_scar_diameter: row.get(13)?,
        highest_oxidation_temperature: row.get(14)?,
        best_extreme_pressure_value: row.get(15)?,
    })
}

/// One component, plus the name the summary line uses for it.
///
/// The summary name is computed in SQL rather than reconstructed in Rust so it stays identical to
/// what the per-formulation query produced: base oil, else the molecule (its own or its
/// additive's), else the additive's id, else the bare role.
struct SummarizedComponent {
    component: FormulationComponentDto,
    summary_name: String,
}

/// Loads every component of every named formulation in one query.
fn load_components_for(
    connection: &Connection,
    ids: &[String],
) -> Result<HashMap<String, Vec<SummarizedComponent>>, String> {
    let mut grouped: HashMap<String, Vec<SummarizedComponent>> = HashMap::new();
    if ids.is_empty() {
        return Ok(grouped);
    }
    // One placeholder per id: the ids come from the page query, never from a caller.
    let placeholders = (1..=ids.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!(
        "SELECT c.id, c.formulation_id, c.component_role, c.molecule_id, c.base_oil_id,
                c.additive_id, c.concentration_value, c.concentration_unit,
                c.concentration_standard_value, c.concentration_standard_unit, c.notes,
                COALESCE(m.name, ''), COALESCE(b.name, ''), COALESCE(am.name, ''),
                COALESCE(b.name, sm.name, a.id, c.component_role)
         FROM formulation_components c
         LEFT JOIN molecules m ON m.id = c.molecule_id
         LEFT JOIN base_oils b ON b.id = c.base_oil_id
         LEFT JOIN additives a ON a.id = c.additive_id
         LEFT JOIN molecules am ON am.id = a.molecule_id
         LEFT JOIN molecules sm ON sm.id = COALESCE(c.molecule_id, a.molecule_id)
         WHERE c.formulation_id IN ({placeholders})
         ORDER BY c.formulation_id, c.id"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare the component query: {err}"))?;
    let parameters = rusqlite::params_from_iter(ids.iter());
    let rows = statement
        .query_map(parameters, |row| {
            Ok(SummarizedComponent {
                component: FormulationComponentDto {
                    id: row.get(0)?,
                    formulation_id: row.get(1)?,
                    component_role: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    molecule_id: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    base_oil_id: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    additive_id: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    concentration_value: row.get(6)?,
                    concentration_unit: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                    concentration_standard_value: row.get(8)?,
                    concentration_standard_unit: row
                        .get::<_, Option<String>>(9)?
                        .unwrap_or_default(),
                    notes: row.get::<_, Option<String>>(10)?.unwrap_or_default(),
                    molecule_name: row.get::<_, Option<String>>(11)?.unwrap_or_default(),
                    base_oil_name: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
                    additive_name: row.get::<_, Option<String>>(13)?.unwrap_or_default(),
                },
                summary_name: row.get::<_, Option<String>>(14)?.unwrap_or_default(),
            })
        })
        .map_err(|err| format!("Failed to load formulation components: {err}"))?;
    for row in rows {
        let row = row.map_err(|err| format!("Failed to read a component row: {err}"))?;
        grouped
            .entry(row.component.formulation_id.clone())
            .or_default()
            .push(row);
    }
    Ok(grouped)
}

/// Assembles the full DTO from its scalar half and its components.
///
/// The derived fields — the base oil's name, the additive count, the summary line — are computed
/// from the components already in hand rather than by asking the database again.
fn assemble_formulation(
    shell: FormulationShell,
    components: Vec<SummarizedComponent>,
) -> FormulationDto {
    let base_oil = components
        .iter()
        .find(|item| item.component.component_role == "base_oil")
        .map(|item| {
            if item.component.base_oil_name.is_empty() {
                item.component.molecule_name.clone()
            } else {
                item.component.base_oil_name.clone()
            }
        })
        .unwrap_or_default();
    let additive_count = components
        .iter()
        .filter(|item| item.component.component_role == "additive")
        .count() as i64;
    let components_summary = components
        .iter()
        .filter_map(|item| {
            let name = item.summary_name.trim();
            if name.is_empty() {
                return None;
            }
            Some(
                match (
                    item.component.concentration_value,
                    item.component.concentration_unit.as_str(),
                ) {
                    (Some(value), unit) if !unit.is_empty() => format!("{name} {value} {unit}"),
                    (Some(value), _) => format!("{name} {value}"),
                    (None, _) => name.to_string(),
                },
            )
        })
        .collect::<Vec<_>>()
        .join(" + ");

    FormulationDto {
        id: shell.id,
        name: shell.name,
        base_oil,
        additive_count,
        components: components.into_iter().map(|item| item.component).collect(),
        components_summary,
        preparation_method: shell.preparation_method,
        preparation_temperature: shell.preparation_temperature,
        preparation_temperature_unit: shell.preparation_temperature_unit,
        preparation_time: shell.preparation_time,
        preparation_time_unit: shell.preparation_time_unit,
        stability_observation: shell.stability_observation,
        experiment_count: shell.experiment_count,
        best_average_friction_coefficient: shell.best_average_friction_coefficient,
        best_wear_scar_diameter: shell.best_wear_scar_diameter,
        highest_oxidation_temperature: shell.highest_oxidation_temperature,
        best_extreme_pressure_value: shell.best_extreme_pressure_value,
        notes: shell.notes,
        created_at: shell.created_at,
        updated_at: shell.updated_at,
    }
}

/// Turns a set of shells into full DTOs with exactly one extra query, whatever the count.
fn attach_components(
    connection: &Connection,
    shells: Vec<FormulationShell>,
) -> Result<Vec<FormulationDto>, String> {
    let ids: Vec<String> = shells.iter().map(|shell| shell.id.clone()).collect();
    let mut grouped = load_components_for(connection, &ids)?;
    Ok(shells
        .into_iter()
        .map(|shell| {
            let components = grouped.remove(&shell.id).unwrap_or_default();
            assemble_formulation(shell, components)
        })
        .collect())
}

fn read_shells(
    connection: &Connection,
    sql: &str,
    parameters: &[&dyn rusqlite::ToSql],
) -> Result<Vec<FormulationShell>, String> {
    let mut statement = connection
        .prepare(sql)
        .map_err(|err| format!("Failed to prepare formulation query: {err}"))?;
    let rows = statement
        .query_map(parameters, read_formulation_shell)
        .map_err(|err| format!("Failed to query formulations: {err}"))?;
    let mut shells = Vec::new();
    for row in rows {
        shells.push(row.map_err(|err| format!("Failed to read formulation row: {err}"))?);
    }
    Ok(shells)
}

#[tauri::command]
pub fn list_formulations(
    app: AppHandle,
    _filter: Option<Value>,
) -> Result<Vec<FormulationDto>, String> {
    let connection = open_connection(&app)?;
    let sql = format!("{FORMULATION_SELECT}{FORMULATION_ORDER}");
    let shells = read_shells(&connection, &sql, &[])?;
    attach_components(&connection, shells)
}

/// One bounded page of formulations, with the same aggregates the full list carries.
#[tauri::command]
pub fn list_formulations_page(
    app: AppHandle,
    request: Option<PageRequest>,
) -> Result<Page<FormulationDto>, String> {
    let request = request.unwrap_or_default();
    let resolved = request.resolve();
    let connection = open_connection(&app)?;
    let pattern = request.like_pattern();

    let total: i64 = match &pattern {
        Some(value) => connection.query_row(
            "SELECT COUNT(*) FROM formulations WHERE name LIKE ?1 ESCAPE '\\'",
            params![value],
            |row| row.get(0),
        ),
        None => connection.query_row("SELECT COUNT(*) FROM formulations", [], |row| row.get(0)),
    }
    .map_err(|err| format!("Failed to count formulations: {err}"))?;

    let filter = match pattern {
        Some(_) => " WHERE f.name LIKE ?3 ESCAPE '\\'",
        None => "",
    };
    let sql = format!("{FORMULATION_SELECT}{filter}{FORMULATION_ORDER} LIMIT ?1 OFFSET ?2");
    let shells = match &pattern {
        Some(value) => read_shells(
            &connection,
            &sql,
            &[&resolved.limit, &resolved.offset, value],
        ),
        None => read_shells(&connection, &sql, &[&resolved.limit, &resolved.offset]),
    }?;
    Ok(Page::new(
        attach_components(&connection, shells)?,
        total,
        resolved,
    ))
}

/// A selector's worth of formulations: id, name, and the blend's one-line composition.
#[tauri::command]
pub fn search_formulations(
    app: AppHandle,
    query: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<EntityOption>, String> {
    let connection = open_connection(&app)?;
    let limit = i64::from(
        limit
            .unwrap_or(MAX_SEARCH_RESULTS)
            .clamp(1, MAX_SEARCH_RESULTS),
    );
    let pattern = query
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| format!("%{}%", pagination::escape_like(text)))
        .unwrap_or_else(|| "%".to_string());
    let mut statement = connection
        .prepare(
            "SELECT f.id, f.name, COALESCE(f.preparation_method, '')
             FROM formulations f
             WHERE f.name LIKE ?1 ESCAPE '\\'
             ORDER BY f.name COLLATE NOCASE, f.id
             LIMIT ?2",
        )
        .map_err(|err| format!("Failed to prepare the formulation search: {err}"))?;
    let rows = statement
        .query_map(params![pattern, limit], |row| {
            Ok(EntityOption {
                id: row.get(0)?,
                label: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                detail: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            })
        })
        .map_err(|err| format!("Failed to search formulations: {err}"))?;
    let mut options = Vec::new();
    for row in rows {
        options.push(row.map_err(|err| format!("Failed to read a formulation option: {err}"))?);
    }
    Ok(options)
}

/// Duplicates a formulation and every one of its components in a single transaction.
///
/// Experiments and performance results are deliberately not copied: they are measurements of the
/// original mixture, and attaching them to a copy would invent data.
#[tauri::command]
pub fn copy_formulation(
    app: AppHandle,
    id: String,
    name: Option<String>,
) -> Result<FormulationDto, String> {
    let mut connection = open_connection(&app)?;
    let source = connection
        .query_row(
            "SELECT name, preparation_method, preparation_temperature,
                    preparation_temperature_unit, preparation_time, preparation_time_unit,
                    stability_observation, notes
             FROM formulations WHERE id = ?1",
            params![&id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<f64>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<f64>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            },
        )
        .optional()
        .map_err(|err| format!("Failed to read formulation {id}: {err}"))?;
    let Some(source) = source else {
        return Err(format!("Formulation not found: {id}"));
    };

    let copy_id = Uuid::new_v4().to_string();
    // A supplied name must be usable; only an omitted name falls back to the derived default.
    let copy_name = match name {
        Some(value) if value.trim().is_empty() => {
            return Err("The name for the copy cannot be empty.".to_string())
        }
        Some(value) => value.trim().to_string(),
        None => format!("{} Copy", source.0),
    };
    let now = Utc::now().to_rfc3339();

    let transaction = connection
        .transaction()
        .map_err(|err| format!("Failed to start the formulation copy transaction: {err}"))?;
    transaction
        .execute(
            "INSERT INTO formulations (
                id, name, preparation_method, preparation_temperature,
                preparation_temperature_unit, preparation_time, preparation_time_unit,
                stability_observation, notes, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
            params![
                &copy_id, &copy_name, source.1, source.2, source.3, source.4, source.5, source.6,
                source.7, &now
            ],
        )
        .map_err(|err| format!("Failed to create the formulation copy: {err}"))?;

    // Copy the components with fresh ids, inside the same transaction so a failure leaves
    // nothing behind.
    let mut statement = transaction
        .prepare("SELECT id FROM formulation_components WHERE formulation_id = ?1 ORDER BY id")
        .map_err(|err| format!("Failed to prepare the component copy query: {err}"))?;
    let component_ids: Vec<String> = statement
        .query_map(params![&id], |row| row.get::<_, String>(0))
        .map_err(|err| format!("Failed to read the source components: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read a source component: {err}"))?;
    drop(statement);
    for component_id in &component_ids {
        transaction
            .execute(
                "INSERT INTO formulation_components (
                    id, formulation_id, component_role, molecule_id, base_oil_id, additive_id,
                    concentration_value, concentration_unit, concentration_standard_value,
                    concentration_standard_unit, notes
                 )
                 SELECT ?1, ?2, component_role, molecule_id, base_oil_id, additive_id,
                        concentration_value, concentration_unit, concentration_standard_value,
                        concentration_standard_unit, notes
                 FROM formulation_components WHERE id = ?3",
                params![Uuid::new_v4().to_string(), &copy_id, component_id],
            )
            .map_err(|err| format!("Failed to copy formulation component {component_id}: {err}"))?;
    }
    transaction
        .commit()
        .map_err(|err| format!("Failed to commit the formulation copy: {err}"))?;

    get_formulation_by_id(&connection, &copy_id)
}

/// Loads the selected formulations together with their measured experiment summaries.
#[tauri::command]
pub fn compare_formulations(
    app: AppHandle,
    ids: Vec<String>,
) -> Result<Vec<FormulationDto>, String> {
    if ids.len() < 2 {
        return Err("Select at least two formulations to compare.".to_string());
    }
    let connection = open_connection(&app)?;
    let mut found = Vec::new();
    let mut missing = Vec::new();
    for id in &ids {
        match get_formulation_by_id(&connection, id) {
            Ok(formulation) => found.push(formulation),
            // A row deleted in another window should name itself rather than abort the whole
            // comparison.
            Err(error) if error.contains("Query returned no rows") => missing.push(id.clone()),
            Err(error) => return Err(error),
        }
    }
    if !missing.is_empty() {
        return Err(format!(
            "These formulations are no longer in the database: {}",
            missing.join(", ")
        ));
    }
    Ok(found)
}

#[tauri::command]
pub fn delete_formulation(app: AppHandle, id: String) -> Result<Value, String> {
    let workspace = attachments::workspace_dir(&app)?;
    let mut connection = open_connection(&app)?;

    // A formulation owns its own attachments and, indirectly, those of its experiments. Both sets
    // are moved aside before the transaction so nothing is lost if the delete fails.
    let mut paths =
        attachments::attachment_paths(&connection, attachments::ENTITY_FORMULATION, &id)?;
    paths.extend(attachments::experiment_attachment_paths_for_formulation(
        &connection,
        &id,
    )?);
    // A file that is present but cannot be moved aside stops the delete before any row goes, so
    // the workspace never gains a file nothing references.
    let ((deleted, deleted_attachments), removed_files, cleanup_failures) =
        attachments::delete_with_files(&workspace, &paths, || {
            let transaction = connection
                .transaction()
                .map_err(|err| format!("Failed to start formulation delete transaction: {err}"))?;
            transaction
                .execute(
                    "DELETE FROM attachments
                     WHERE linked_entity_type = 'experiment'
                       AND linked_entity_id IN (SELECT id FROM experiments WHERE formulation_id = ?1)",
                    params![&id],
                )
                .map_err(|err| format!("Failed to delete experiment attachments: {err}"))?;
            let deleted_attachments = attachments::delete_attachment_rows(
                &transaction,
                attachments::ENTITY_FORMULATION,
                &id,
            )?;
            transaction
                .execute(
                    "DELETE FROM performance_results
                     WHERE experiment_id IN (SELECT id FROM experiments WHERE formulation_id = ?1)",
                    params![&id],
                )
                .map_err(|err| {
                    format!("Failed to delete formulation performance results: {err}")
                })?;
            transaction
                .execute(
                    "DELETE FROM experiments WHERE formulation_id = ?1",
                    params![&id],
                )
                .map_err(|err| format!("Failed to delete formulation experiments: {err}"))?;
            transaction
                .execute(
                    "DELETE FROM formulation_components WHERE formulation_id = ?1",
                    params![&id],
                )
                .map_err(|err| format!("Failed to delete formulation components: {err}"))?;
            let deleted = transaction
                .execute("DELETE FROM formulations WHERE id = ?1", params![&id])
                .map_err(|err| format!("Failed to delete formulation: {err}"))?;
            transaction
                .commit()
                .map_err(|err| format!("Failed to commit formulation delete transaction: {err}"))?;
            Ok((deleted, deleted_attachments))
        })?;

    Ok(json!({
        "success": deleted > 0,
        "deleted": deleted > 0,
        "id": id,
        "deletedAttachments": deleted_attachments,
        "removedFiles": removed_files,
        "cleanupFailures": cleanup_failures
    }))
}

#[tauri::command]
pub fn update_formulation(
    app: AppHandle,
    id: String,
    payload: Value,
) -> Result<FormulationDto, String> {
    let connection = open_connection(&app)?;
    let exists: i64 = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM formulations WHERE id = ?1)",
            params![&id],
            |row| row.get(0),
        )
        .map_err(|err| format!("Failed to look up formulation {id}: {err}"))?;
    if exists != 1 {
        return Err(format!("Formulation not found: {id}"));
    }
    let now = Utc::now().to_rfc3339();
    // Every optional field can be cleared: a "keep" flag decides whether the stored value or the
    // supplied one wins, so an explicit null or empty string really empties the column.
    let name = patch::required_text(&payload, "name", "name", "The formulation name")?;
    let method = patch::text(&payload, "preparationMethod", "preparation_method")?;
    let temperature = patch::number(
        &payload,
        "preparationTemperature",
        "preparation_temperature",
    )?;
    let temperature_unit = patch::text(
        &payload,
        "preparationTemperatureUnit",
        "preparation_temperature_unit",
    )?;
    let time = patch::number(&payload, "preparationTime", "preparation_time")?;
    let time_unit = patch::text(&payload, "preparationTimeUnit", "preparation_time_unit")?;
    let stability = patch::text(&payload, "stabilityObservation", "stability_observation")?;
    let notes = patch::text(&payload, "notes", "notes")?;

    connection
        .execute(
            "UPDATE formulations SET
                name = CASE WHEN ?2 THEN name ELSE ?3 END,
                preparation_method = CASE WHEN ?4 THEN preparation_method ELSE ?5 END,
                preparation_temperature = CASE WHEN ?6 THEN preparation_temperature ELSE ?7 END,
                preparation_temperature_unit =
                    CASE WHEN ?8 THEN preparation_temperature_unit ELSE ?9 END,
                preparation_time = CASE WHEN ?10 THEN preparation_time ELSE ?11 END,
                preparation_time_unit = CASE WHEN ?12 THEN preparation_time_unit ELSE ?13 END,
                stability_observation = CASE WHEN ?14 THEN stability_observation ELSE ?15 END,
                notes = CASE WHEN ?16 THEN notes ELSE ?17 END,
                updated_at = ?18
             WHERE id = ?1",
            params![
                &id,
                name.is_unchanged(),
                patch::Patched(name),
                method.is_unchanged(),
                patch::Patched(method),
                temperature.is_unchanged(),
                patch::Patched(temperature),
                temperature_unit.is_unchanged(),
                patch::Patched(temperature_unit),
                time.is_unchanged(),
                patch::Patched(time),
                time_unit.is_unchanged(),
                patch::Patched(time_unit),
                stability.is_unchanged(),
                patch::Patched(stability),
                notes.is_unchanged(),
                patch::Patched(notes),
                &now
            ],
        )
        .map_err(|err| format!("Failed to update formulation: {err}"))?;
    get_formulation_by_id(&connection, &id)
}

fn open_connection(app: &AppHandle) -> Result<Connection, String> {
    open_database(default_database_path(app)?)
        .map_err(|err| format!("Failed to open SQLite database: {err}"))
}

fn get_formulation_by_id(connection: &Connection, id: &str) -> Result<FormulationDto, String> {
    let sql = format!("{FORMULATION_SELECT} WHERE f.id = ?1");
    let mut shells = read_shells(connection, &sql, &[&id])?;
    if shells.is_empty() {
        // The callers distinguish "no rows" from a real failure by this wording; changing it
        // would turn a missing formulation into an error dialogue.
        return Err("Failed to load formulation: Query returned no rows".to_string());
    }
    let shell = shells.remove(0);
    let components = load_components_for(connection, std::slice::from_ref(&shell.id))?
        .remove(&shell.id)
        .unwrap_or_default();
    Ok(assemble_formulation(shell, components))
}
