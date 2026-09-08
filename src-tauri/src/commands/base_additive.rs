use crate::app_paths::default_database_path;
use crate::commands::errors;
use crate::commands::pagination::{self, EntityOption, Page, PageRequest, MAX_SEARCH_RESULTS};
use crate::commands::patch;
use crate::commands::references::{self, ComponentLink, DeletionOutcome};
use crate::commands::validation;
use crate::db::open_database;
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use uuid::Uuid;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseOilDto {
    pub commercial_product_id: Option<String>,
    pub id: String,
    pub name: String,
    pub base_oil_type: String,
    pub representative_molecule_id: String,
    pub viscosity_40c: Option<f64>,
    pub viscosity_100c: Option<f64>,
    pub viscosity_index: Option<f64>,
    pub density: Option<f64>,
    pub pour_point: Option<f64>,
    pub flash_point: Option<f64>,
    pub supplier: String,
    pub batch_number: String,
    pub formulation_count: i64,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdditiveDto {
    pub commercial_product_id: Option<String>,
    pub id: String,
    pub molecule_id: String,
    pub molecule_name: String,
    pub function_types: Vec<String>,
    pub active_elements: Vec<String>,
    pub typical_concentration_min: f64,
    pub typical_concentration_max: f64,
    pub concentration_unit: String,
    pub compatible_base_oils: Vec<String>,
    pub formulation_count: i64,
    pub best_friction_coefficient: Option<f64>,
    pub best_wear_scar_diameter: Option<f64>,
    pub application_notes: String,
    pub created_at: String,
    pub updated_at: String,
}

/// A base-oil record, as the library screen and the CSV importer both describe it.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseOilWriteRequest {
    #[serde(default, deserialize_with = "validation::optional_text")]
    pub id: Option<String>,
    #[serde(default, deserialize_with = "validation::optional_text")]
    pub name: Option<String>,
    #[serde(
        default,
        alias = "base_oil_type",
        deserialize_with = "validation::optional_text"
    )]
    pub base_oil_type: Option<String>,
    #[serde(
        default,
        alias = "representative_molecule_id",
        deserialize_with = "validation::optional_text"
    )]
    pub representative_molecule_id: Option<String>,
    #[serde(
        default,
        alias = "viscosity_40c",
        deserialize_with = "validation::optional_number"
    )]
    pub viscosity40c: Option<f64>,
    #[serde(
        default,
        alias = "viscosity_100c",
        deserialize_with = "validation::optional_number"
    )]
    pub viscosity100c: Option<f64>,
    #[serde(
        default,
        alias = "viscosity_index",
        deserialize_with = "validation::optional_number"
    )]
    pub viscosity_index: Option<f64>,
    #[serde(default, deserialize_with = "validation::optional_number")]
    pub density: Option<f64>,
    #[serde(
        default,
        alias = "pour_point",
        deserialize_with = "validation::optional_number"
    )]
    pub pour_point: Option<f64>,
    #[serde(
        default,
        alias = "flash_point",
        deserialize_with = "validation::optional_number"
    )]
    pub flash_point: Option<f64>,
    #[serde(default, deserialize_with = "validation::optional_text")]
    pub supplier: Option<String>,
    #[serde(
        default,
        alias = "batch_number",
        deserialize_with = "validation::optional_text"
    )]
    pub batch_number: Option<String>,
    #[serde(default, deserialize_with = "validation::optional_text")]
    pub notes: Option<String>,
}

/// A base-oil record that has passed every rule.
#[derive(Debug)]
pub struct ValidatedBaseOil {
    pub id: String,
    pub name: String,
    pub base_oil_type: Option<String>,
    pub representative_molecule_id: Option<String>,
    pub viscosity40c: Option<f64>,
    pub viscosity100c: Option<f64>,
    pub viscosity_index: Option<f64>,
    pub density: Option<f64>,
    pub pour_point: Option<f64>,
    pub flash_point: Option<f64>,
    pub supplier: String,
    pub batch_number: String,
    pub notes: String,
}

impl BaseOilWriteRequest {
    /// A name and finite physical properties. There is deliberately no default base-oil type:
    /// "Group III" was previously filled in for a blank form, which recorded a classification
    /// nobody had made.
    pub fn validate(self) -> Result<ValidatedBaseOil, String> {
        Ok(ValidatedBaseOil {
            id: self.id.unwrap_or_else(|| Uuid::new_v4().to_string()),
            name: validation::require_name(self.name.as_deref(), "The base oil name")?,
            base_oil_type: self.base_oil_type,
            representative_molecule_id: self.representative_molecule_id,
            // A viscosity of zero or below is not a fluid; the others may legitimately be
            // negative (a pour point) so they are only checked for finiteness.
            viscosity40c: validation::require_positive_concentration(
                self.viscosity40c,
                "The viscosity at 40 C",
            )?,
            viscosity100c: validation::require_positive_concentration(
                self.viscosity100c,
                "The viscosity at 100 C",
            )?,
            viscosity_index: validation::require_finite(
                self.viscosity_index,
                "The viscosity index",
            )?,
            density: validation::require_positive_concentration(self.density, "The density")?,
            pour_point: validation::require_finite(self.pour_point, "The pour point")?,
            flash_point: validation::require_finite(self.flash_point, "The flash point")?,
            supplier: self.supplier.unwrap_or_default(),
            batch_number: self.batch_number.unwrap_or_default(),
            notes: self.notes.unwrap_or_default(),
        })
    }
}

#[tauri::command]
pub fn create_base_oil(app: AppHandle, payload: Value) -> Result<BaseOilDto, String> {
    let request: BaseOilWriteRequest = serde_json::from_value(payload).map_err(|err| {
        errors::coded(
            errors::VALIDATION_PAYLOAD_EMPTY,
            format!("The base oil payload could not be read: {err}"),
        )
    })?;
    let base_oil = request.validate()?;
    let now = Utc::now().to_rfc3339();
    let connection = open_connection(&app)?;
    if let Some(molecule_id) = base_oil.representative_molecule_id.as_deref() {
        if !row_exists(&connection, "molecules", molecule_id)? {
            return Err(errors::coded(
                errors::RECORD_NOT_FOUND,
                format!("Molecule not found: {molecule_id}"),
            ));
        }
    }
    connection
        .execute(
            "INSERT INTO base_oils (
                id, name, base_oil_type, representative_molecule_id, viscosity_40c,
                viscosity_100c, viscosity_index, density, pour_point, flash_point,
                supplier, batch_number, notes, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14)",
            params![
                &base_oil.id,
                &base_oil.name,
                base_oil.base_oil_type.as_deref(),
                base_oil.representative_molecule_id.as_deref(),
                base_oil.viscosity40c,
                base_oil.viscosity100c,
                base_oil.viscosity_index,
                base_oil.density,
                base_oil.pour_point,
                base_oil.flash_point,
                &base_oil.supplier,
                &base_oil.batch_number,
                &base_oil.notes,
                &now
            ],
        )
        .map_err(|err| format!("Failed to create base oil: {err}"))?;
    get_base_oil(&connection, &base_oil.id)
}

/// The columns every base-oil read selects, with the usage count joined rather than counted per
/// row.
///
/// The previous list ran `SELECT COUNT(DISTINCT formulation_id) …` once for every oil returned:
/// one query to list them and N more to say how often each is used. The grouped subquery answers
/// the same question for the whole table in one pass, and `idx_formulation_components_base_oil_id`
/// is what makes that pass cheap.
pub const BASE_OIL_SELECT: &str =
    "SELECT b.id, b.name, b.base_oil_type, b.representative_molecule_id,
            b.viscosity_40c, b.viscosity_100c, b.viscosity_index, b.density, b.pour_point,
            b.flash_point, b.supplier, b.batch_number, b.notes, b.created_at, b.updated_at,
            COALESCE(usage.formulation_count, 0), b.commercial_product_id
     FROM base_oils b
     LEFT JOIN (
       SELECT base_oil_id, COUNT(DISTINCT formulation_id) AS formulation_count
       FROM formulation_components
       WHERE base_oil_id IS NOT NULL
       GROUP BY base_oil_id
     ) usage ON usage.base_oil_id = b.id";

/// Deterministic to the last row: `created_at` alone ties for records written in the same second.
pub const BASE_OIL_ORDER: &str =
    " ORDER BY datetime(b.created_at) DESC, b.created_at DESC, b.id DESC";

fn read_base_oil_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<BaseOilDto> {
    Ok(BaseOilDto {
        id: row.get(0)?,
        name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        base_oil_type: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
        representative_molecule_id: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
        viscosity_40c: row.get(4)?,
        viscosity_100c: row.get(5)?,
        viscosity_index: row.get(6)?,
        density: row.get(7)?,
        pour_point: row.get(8)?,
        flash_point: row.get(9)?,
        supplier: row.get::<_, Option<String>>(10)?.unwrap_or_default(),
        batch_number: row.get::<_, Option<String>>(11)?.unwrap_or_default(),
        notes: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
        formulation_count: row.get(15)?,
        commercial_product_id: row.get(16)?,
    })
}

#[tauri::command]
pub fn list_base_oils(app: AppHandle, _filter: Option<Value>) -> Result<Vec<BaseOilDto>, String> {
    let connection = open_connection(&app)?;
    let sql = format!("{BASE_OIL_SELECT}{BASE_OIL_ORDER}");
    let mut statement = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare base oil list query: {err}"))?;
    let rows = statement
        .query_map([], read_base_oil_row)
        .map_err(|err| format!("Failed to query base oils: {err}"))?;
    collect_rows(rows, "base oil")
}

/// One bounded page of base oils, filtered and counted in the database.
#[tauri::command]
pub fn list_base_oils_page(
    app: AppHandle,
    request: Option<PageRequest>,
) -> Result<Page<BaseOilDto>, String> {
    let request = request.unwrap_or_default();
    let resolved = request.resolve();
    let connection = open_connection(&app)?;
    let pattern = request.like_pattern();

    let (filter, count_filter) = match pattern {
        Some(_) => (
            " WHERE b.name LIKE ?3 ESCAPE '\\' OR b.supplier LIKE ?3 ESCAPE '\\'",
            " WHERE name LIKE ?1 ESCAPE '\\' OR supplier LIKE ?1 ESCAPE '\\'",
        ),
        None => ("", ""),
    };

    let total: i64 = match &pattern {
        Some(value) => connection.query_row(
            &format!("SELECT COUNT(*) FROM base_oils{count_filter}"),
            params![value],
            |row| row.get(0),
        ),
        None => connection.query_row("SELECT COUNT(*) FROM base_oils", [], |row| row.get(0)),
    }
    .map_err(|err| format!("Failed to count base oils: {err}"))?;

    let sql = format!("{BASE_OIL_SELECT}{filter}{BASE_OIL_ORDER} LIMIT ?1 OFFSET ?2");
    let mut statement = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare the base oil page query: {err}"))?;
    let items = match &pattern {
        Some(value) => statement.query_map(
            params![resolved.limit, resolved.offset, value],
            read_base_oil_row,
        ),
        None => statement.query_map(params![resolved.limit, resolved.offset], read_base_oil_row),
    }
    .map_err(|err| format!("Failed to query the base oil page: {err}"))?;
    Ok(Page::new(collect_rows(items, "base oil")?, total, resolved))
}

/// A selector's worth of base oils: ids and labels, never whole records.
#[tauri::command]
pub fn search_base_oils(
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
            "SELECT id, name, COALESCE(base_oil_type, '')
             FROM base_oils
             WHERE name LIKE ?1 ESCAPE '\\' OR COALESCE(base_oil_type, '') LIKE ?1 ESCAPE '\\'
             ORDER BY name COLLATE NOCASE, id
             LIMIT ?2",
        )
        .map_err(|err| format!("Failed to prepare the base oil search: {err}"))?;
    let rows = statement
        .query_map(params![pattern, limit], |row| {
            Ok(EntityOption {
                id: row.get(0)?,
                label: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                detail: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            })
        })
        .map_err(|err| format!("Failed to search base oils: {err}"))?;
    collect_rows(rows, "base oil option")
}

#[tauri::command]
pub fn update_base_oil(app: AppHandle, id: String, payload: Value) -> Result<BaseOilDto, String> {
    let connection = open_connection(&app)?;
    if !row_exists(&connection, "base_oils", &id)? {
        return Err(format!("Base oil not found: {id}"));
    }
    // The representative molecule is a foreign key; report the missing record instead of letting
    // SQLite raise a bare constraint error.
    let representative_molecule_id = field_string(&payload, "representativeMoleculeId")
        .or_else(|| field_string(&payload, "representative_molecule_id"));
    if let Some(molecule_id) = &representative_molecule_id {
        if !row_exists(&connection, "molecules", molecule_id)? {
            return Err(format!("Molecule not found: {molecule_id}"));
        }
    }
    let now = Utc::now().to_rfc3339();
    apply_base_oil_patch(
        &connection,
        &id,
        &payload,
        representative_molecule_id.as_deref(),
        &now,
    )?;
    get_base_oil(&connection, &id)
}

/// Reads a base-oil patch and applies it, returning how many rows changed.
///
/// Every field is validated before a single one is bound: a payload carrying `"12a"` for a
/// viscosity is refused outright rather than partly applied, so a rejected update leaves the stored
/// row exactly as it was.
///
/// Each field is bound twice — a "keep" flag and the new value — which lets an explicit null or
/// empty string clear a field, something `COALESCE` alone cannot express.
pub fn apply_base_oil_patch(
    connection: &Connection,
    id: &str,
    payload: &Value,
    representative_molecule_id: Option<&str>,
    now: &str,
) -> Result<usize, String> {
    let name = patch::required_text(payload, "name", "name", "The base oil name")?;
    let base_oil_type = patch::text(payload, "baseOilType", "base_oil_type")?;
    let viscosity_40c = patch::number(payload, "viscosity40c", "viscosity_40c")?;
    let viscosity_100c = patch::number(payload, "viscosity100c", "viscosity_100c")?;
    let viscosity_index = patch::number(payload, "viscosityIndex", "viscosity_index")?;
    let density = patch::number(payload, "density", "density")?;
    let pour_point = patch::number(payload, "pourPoint", "pour_point")?;
    let flash_point = patch::number(payload, "flashPoint", "flash_point")?;
    let supplier = patch::text(payload, "supplier", "supplier")?;
    let batch_number = patch::text(payload, "batchNumber", "batch_number")?;
    let notes = patch::text(payload, "notes", "notes")?;
    let molecule_patch = match representative_molecule_id {
        Some(value) => patch::FieldPatch::Set(value.to_string()),
        None => patch::text(
            payload,
            "representativeMoleculeId",
            "representative_molecule_id",
        )?,
    };

    connection
        .execute(
            "UPDATE base_oils SET
                name = CASE WHEN ?2 THEN name ELSE ?3 END,
                base_oil_type = CASE WHEN ?4 THEN base_oil_type ELSE ?5 END,
                representative_molecule_id =
                    CASE WHEN ?6 THEN representative_molecule_id ELSE ?7 END,
                viscosity_40c = CASE WHEN ?8 THEN viscosity_40c ELSE ?9 END,
                viscosity_100c = CASE WHEN ?10 THEN viscosity_100c ELSE ?11 END,
                viscosity_index = CASE WHEN ?12 THEN viscosity_index ELSE ?13 END,
                density = CASE WHEN ?14 THEN density ELSE ?15 END,
                pour_point = CASE WHEN ?16 THEN pour_point ELSE ?17 END,
                flash_point = CASE WHEN ?18 THEN flash_point ELSE ?19 END,
                supplier = CASE WHEN ?20 THEN supplier ELSE ?21 END,
                batch_number = CASE WHEN ?22 THEN batch_number ELSE ?23 END,
                notes = CASE WHEN ?24 THEN notes ELSE ?25 END,
                updated_at = ?26
             WHERE id = ?1",
            params![
                id,
                name.is_unchanged(),
                patch::Patched(name),
                base_oil_type.is_unchanged(),
                patch::Patched(base_oil_type),
                molecule_patch.is_unchanged(),
                patch::Patched(molecule_patch),
                viscosity_40c.is_unchanged(),
                patch::Patched(viscosity_40c),
                viscosity_100c.is_unchanged(),
                patch::Patched(viscosity_100c),
                viscosity_index.is_unchanged(),
                patch::Patched(viscosity_index),
                density.is_unchanged(),
                patch::Patched(density),
                pour_point.is_unchanged(),
                patch::Patched(pour_point),
                flash_point.is_unchanged(),
                patch::Patched(flash_point),
                supplier.is_unchanged(),
                patch::Patched(supplier),
                batch_number.is_unchanged(),
                patch::Patched(batch_number),
                notes.is_unchanged(),
                patch::Patched(notes),
                now
            ],
        )
        .map_err(|err| format!("Failed to update base oil: {err}"))
}

#[tauri::command]
pub fn update_additive(app: AppHandle, id: String, payload: Value) -> Result<AdditiveDto, String> {
    let connection = open_connection(&app)?;
    if !row_exists(&connection, "additives", &id)? {
        return Err(format!("Additive not found: {id}"));
    }
    let molecule_id =
        field_string(&payload, "moleculeId").or_else(|| field_string(&payload, "molecule_id"));
    if let Some(molecule_id) = &molecule_id {
        if !row_exists(&connection, "molecules", molecule_id)? {
            return Err(format!("Molecule not found: {molecule_id}"));
        }
    }
    let now = Utc::now().to_rfc3339();
    // Molecule-backed records may replace their molecule; commercial sources remain linked.
    let molecule_patch = match &molecule_id {
        Some(value) => patch::FieldPatch::Set(value.clone()),
        None => patch::FieldPatch::Unchanged,
    };
    let function_types = patch::list(&payload, "functionTypes", "function_types")?;
    let active_elements = patch::list(&payload, "activeElements", "active_elements")?;
    let concentration_min = patch::number(
        &payload,
        "typicalConcentrationMin",
        "typical_concentration_min",
    )?;
    let concentration_max = patch::number(
        &payload,
        "typicalConcentrationMax",
        "typical_concentration_max",
    )?;
    let concentration_unit = patch::text(&payload, "concentrationUnit", "concentration_unit")?;
    let compatible_base_oils = patch::list(&payload, "compatibleBaseOils", "compatible_base_oils")?;
    let application_notes = patch::text(&payload, "applicationNotes", "application_notes")?;

    connection
        .execute(
            "UPDATE additives SET
                molecule_id = CASE WHEN ?2 THEN molecule_id ELSE ?3 END,
                function_types = CASE WHEN ?4 THEN function_types ELSE ?5 END,
                active_elements = CASE WHEN ?6 THEN active_elements ELSE ?7 END,
                typical_concentration_min =
                    CASE WHEN ?8 THEN typical_concentration_min ELSE ?9 END,
                typical_concentration_max =
                    CASE WHEN ?10 THEN typical_concentration_max ELSE ?11 END,
                concentration_unit = CASE WHEN ?12 THEN concentration_unit ELSE ?13 END,
                compatible_base_oils = CASE WHEN ?14 THEN compatible_base_oils ELSE ?15 END,
                application_notes = CASE WHEN ?16 THEN application_notes ELSE ?17 END,
                updated_at = ?18
             WHERE id = ?1",
            params![
                &id,
                molecule_patch.is_unchanged(),
                patch::Patched(molecule_patch),
                function_types.is_unchanged(),
                patch::Patched(function_types),
                active_elements.is_unchanged(),
                patch::Patched(active_elements),
                concentration_min.is_unchanged(),
                patch::Patched(concentration_min),
                concentration_max.is_unchanged(),
                patch::Patched(concentration_max),
                concentration_unit.is_unchanged(),
                patch::Patched(concentration_unit),
                compatible_base_oils.is_unchanged(),
                patch::Patched(compatible_base_oils),
                application_notes.is_unchanged(),
                patch::Patched(application_notes),
                &now
            ],
        )
        .map_err(|err| format!("Failed to update additive: {err}"))?;
    get_additive(&connection, &id)
}

fn row_exists(connection: &Connection, table: &str, id: &str) -> Result<bool, String> {
    let sql = match table {
        "base_oils" => "SELECT EXISTS(SELECT 1 FROM base_oils WHERE id = ?1)",
        "additives" => "SELECT EXISTS(SELECT 1 FROM additives WHERE id = ?1)",
        "molecules" => "SELECT EXISTS(SELECT 1 FROM molecules WHERE id = ?1)",
        other => return Err(format!("Unsupported existence check for {other}.")),
    };
    connection
        .query_row(sql, params![id], |row| row.get::<_, i64>(0))
        .map(|found| found == 1)
        .map_err(|err| format!("Failed to look up {table} {id}: {err}"))
}

/// Deletes a base oil, refusing while any formulation still references it.
///
/// The previous implementation removed the referencing `formulation_components` rows first. That
/// left every affected blend describing a mixture with no base oil — a silent, unreportable change
/// to somebody's recorded science. Now the references are named and the row is left alone.
#[tauri::command]
pub fn delete_base_oil(app: AppHandle, id: String) -> Result<DeletionOutcome, String> {
    let connection = open_connection(&app)?;
    delete_catalogue_record(&connection, ComponentLink::BaseOil, "base_oils", &id)
}

/// Deletes a base oil *and* the formulation components that reference it.
///
/// Separate from `delete_base_oil` on purpose: the destructive behaviour has to be asked for by
/// name. `confirm_cascade` is the second acknowledgement — the first is the interface's own
/// confirmation — and without it the command reports what it would remove and stops.
#[tauri::command]
pub fn delete_base_oil_with_components(
    app: AppHandle,
    id: String,
    confirm_cascade: bool,
) -> Result<DeletionOutcome, String> {
    let mut connection = open_connection(&app)?;
    cascade_delete_catalogue_record(
        &mut connection,
        ComponentLink::BaseOil,
        "base_oils",
        &id,
        confirm_cascade,
    )
}

/// An additive record: a molecule, what it does, and the range it is normally used at.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdditiveWriteRequest {
    #[serde(default, deserialize_with = "validation::optional_text")]
    pub id: Option<String>,
    #[serde(
        default,
        alias = "molecule_id",
        deserialize_with = "validation::optional_text"
    )]
    pub molecule_id: Option<String>,
    #[serde(default, alias = "function_types")]
    pub function_types: Option<Value>,
    #[serde(default, alias = "active_elements")]
    pub active_elements: Option<Value>,
    #[serde(
        default,
        alias = "typical_concentration_min",
        deserialize_with = "validation::optional_number"
    )]
    pub typical_concentration_min: Option<f64>,
    #[serde(
        default,
        alias = "typical_concentration_max",
        deserialize_with = "validation::optional_number"
    )]
    pub typical_concentration_max: Option<f64>,
    #[serde(
        default,
        alias = "concentration_unit",
        deserialize_with = "validation::optional_text"
    )]
    pub concentration_unit: Option<String>,
    #[serde(default, alias = "compatible_base_oils")]
    pub compatible_base_oils: Option<Value>,
    #[serde(
        default,
        alias = "application_notes",
        deserialize_with = "validation::optional_text"
    )]
    pub application_notes: Option<String>,
}

/// An additive record that has passed every rule.
#[derive(Debug)]
pub struct ValidatedAdditive {
    pub id: String,
    pub molecule_id: String,
    pub function_types: String,
    pub active_elements: String,
    pub typical_concentration_min: Option<f64>,
    pub typical_concentration_max: Option<f64>,
    pub concentration_unit: Option<String>,
    pub compatible_base_oils: String,
    pub application_notes: String,
}

impl AdditiveWriteRequest {
    pub fn validate(self) -> Result<ValidatedAdditive, String> {
        let molecule_id = validation::require_name(
            self.molecule_id.as_deref(),
            "A representative molecule for the additive",
        )?;
        let minimum = validation::require_positive_concentration(
            self.typical_concentration_min,
            "The minimum typical concentration",
        )?;
        let maximum = validation::require_positive_concentration(
            self.typical_concentration_max,
            "The maximum typical concentration",
        )?;
        // A range that runs backwards describes no usable dose.
        validation::require_ordered_range(minimum, maximum)?;
        Ok(ValidatedAdditive {
            id: self.id.unwrap_or_else(|| Uuid::new_v4().to_string()),
            molecule_id,
            function_types: normalize_list(self.function_types.as_ref()),
            active_elements: normalize_list(self.active_elements.as_ref()),
            typical_concentration_min: minimum,
            typical_concentration_max: maximum,
            concentration_unit: validation::require_concentration_unit(
                self.concentration_unit.as_deref(),
                validation::ADDITIVE_CONCENTRATION_UNITS,
                "concentration unit",
            )?,
            compatible_base_oils: normalize_list(self.compatible_base_oils.as_ref()),
            application_notes: self.application_notes.unwrap_or_default(),
        })
    }
}

#[tauri::command]
pub fn create_additive(app: AppHandle, payload: Value) -> Result<AdditiveDto, String> {
    let request: AdditiveWriteRequest = serde_json::from_value(payload).map_err(|err| {
        errors::coded(
            errors::VALIDATION_PAYLOAD_EMPTY,
            format!("The additive payload could not be read: {err}"),
        )
    })?;
    let additive = request.validate()?;
    let now = Utc::now().to_rfc3339();
    let connection = open_connection(&app)?;
    if !row_exists(&connection, "molecules", &additive.molecule_id)? {
        return Err(errors::coded(
            errors::RECORD_NOT_FOUND,
            format!(
                "Representative molecule does not exist: {}",
                additive.molecule_id
            ),
        ));
    }
    connection
        .execute(
            "INSERT INTO additives (
                id, molecule_id, function_types, active_elements, typical_concentration_min,
                typical_concentration_max, concentration_unit, compatible_base_oils, application_notes,
                created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
            params![
                &additive.id,
                &additive.molecule_id,
                &additive.function_types,
                &additive.active_elements,
                additive.typical_concentration_min,
                additive.typical_concentration_max,
                additive.concentration_unit.as_deref(),
                &additive.compatible_base_oils,
                &additive.application_notes,
                &now
            ],
        )
        .map_err(|err| format!("Failed to create additive: {err}"))?;
    get_additive(&connection, &additive.id)
}

/// Every additive column, with its usage count and its best measured results joined once for the
/// whole table.
///
/// The previous list asked two extra questions per row — how many formulations use this additive,
/// and what is the best friction and wear it has ever produced — so listing forty additives ran
/// eighty-one queries, the last eighty of them each joining `experiments` and
/// `performance_results`.
pub const ADDITIVE_SELECT: &str =
    "SELECT a.id, a.molecule_id, COALESCE(m.name, p.name, ''), a.function_types,
            a.active_elements, a.typical_concentration_min, a.typical_concentration_max,
            a.concentration_unit, a.compatible_base_oils, a.application_notes, a.created_at,
            a.updated_at, COALESCE(usage.formulation_count, 0),
            best.best_friction, best.best_wear, a.commercial_product_id
     FROM additives a
     LEFT JOIN molecules m ON m.id = a.molecule_id
     LEFT JOIN commercial_product_labels p ON p.id = a.commercial_product_id
     LEFT JOIN (
       SELECT additive_id, COUNT(DISTINCT formulation_id) AS formulation_count
       FROM formulation_components
       WHERE additive_id IS NOT NULL
       GROUP BY additive_id
     ) usage ON usage.additive_id = a.id
     LEFT JOIN (
       SELECT fc.additive_id,
              MIN(pr.average_friction_coefficient) AS best_friction,
              MIN(pr.wear_scar_diameter_value) AS best_wear
       FROM formulation_components fc
       JOIN experiments e ON e.formulation_id = fc.formulation_id
       JOIN performance_results pr ON pr.experiment_id = e.id
       WHERE fc.additive_id IS NOT NULL
       GROUP BY fc.additive_id
     ) best ON best.additive_id = a.id";

pub const ADDITIVE_ORDER: &str =
    " ORDER BY datetime(a.created_at) DESC, a.created_at DESC, a.id DESC";

fn read_additive_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AdditiveDto> {
    Ok(AdditiveDto {
        id: row.get(0)?,
        molecule_id: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
        molecule_name: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
        function_types: parse_string_list(row.get::<_, Option<String>>(3)?.unwrap_or_default()),
        active_elements: parse_string_list(row.get::<_, Option<String>>(4)?.unwrap_or_default()),
        typical_concentration_min: row.get::<_, Option<f64>>(5)?.unwrap_or_default(),
        typical_concentration_max: row.get::<_, Option<f64>>(6)?.unwrap_or_default(),
        concentration_unit: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
        compatible_base_oils: parse_string_list(
            row.get::<_, Option<String>>(8)?.unwrap_or_default(),
        ),
        application_notes: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        formulation_count: row.get(12)?,
        best_friction_coefficient: row.get(13)?,
        best_wear_scar_diameter: row.get(14)?,
        commercial_product_id: row.get(15)?,
    })
}

#[tauri::command]
pub fn list_additives(app: AppHandle, _filter: Option<Value>) -> Result<Vec<AdditiveDto>, String> {
    let connection = open_connection(&app)?;
    let sql = format!("{ADDITIVE_SELECT}{ADDITIVE_ORDER}");
    let mut statement = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare additive list query: {err}"))?;
    let rows = statement
        .query_map([], read_additive_row)
        .map_err(|err| format!("Failed to query additives: {err}"))?;
    collect_rows(rows, "additive")
}

/// One bounded page of additives, searched by the molecule that represents them.
#[tauri::command]
pub fn list_additives_page(
    app: AppHandle,
    request: Option<PageRequest>,
) -> Result<Page<AdditiveDto>, String> {
    let request = request.unwrap_or_default();
    let resolved = request.resolve();
    let connection = open_connection(&app)?;
    let pattern = request.like_pattern();

    let total: i64 = match &pattern {
        Some(value) => connection.query_row(
            "SELECT COUNT(*) FROM additives a LEFT JOIN molecules m ON m.id = a.molecule_id
             LEFT JOIN commercial_product_labels p ON p.id = a.commercial_product_id
             WHERE COALESCE(m.name, p.name, '') LIKE ?1 ESCAPE '\\'
                OR COALESCE(a.function_types, '') LIKE ?1 ESCAPE '\\'",
            params![value],
            |row| row.get(0),
        ),
        None => connection.query_row("SELECT COUNT(*) FROM additives", [], |row| row.get(0)),
    }
    .map_err(|err| format!("Failed to count additives: {err}"))?;

    let filter = match pattern {
        Some(_) => {
            " WHERE COALESCE(m.name, p.name, '') LIKE ?3 ESCAPE '\\'               OR COALESCE(a.function_types, '') LIKE ?3 ESCAPE '\\'"
        }
        None => "",
    };
    let sql = format!("{ADDITIVE_SELECT}{filter}{ADDITIVE_ORDER} LIMIT ?1 OFFSET ?2");
    let mut statement = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare the additive page query: {err}"))?;
    let items = match &pattern {
        Some(value) => statement.query_map(
            params![resolved.limit, resolved.offset, value],
            read_additive_row,
        ),
        None => statement.query_map(params![resolved.limit, resolved.offset], read_additive_row),
    }
    .map_err(|err| format!("Failed to query the additive page: {err}"))?;
    Ok(Page::new(collect_rows(items, "additive")?, total, resolved))
}

/// A selector's worth of additives.
#[tauri::command]
pub fn search_additives(
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
            "SELECT a.id, COALESCE(m.name, p.name, a.id), COALESCE(a.function_types, '')
             FROM additives a
             LEFT JOIN molecules m ON m.id = a.molecule_id
             LEFT JOIN commercial_product_labels p ON p.id = a.commercial_product_id
             WHERE COALESCE(m.name, p.name, '') LIKE ?1 ESCAPE '\\'
                OR COALESCE(a.function_types, '') LIKE ?1 ESCAPE '\\'
             ORDER BY COALESCE(m.name, p.name, a.id) COLLATE NOCASE, a.id
             LIMIT ?2",
        )
        .map_err(|err| format!("Failed to prepare the additive search: {err}"))?;
    let rows = statement
        .query_map(params![pattern, limit], |row| {
            Ok(EntityOption {
                id: row.get(0)?,
                label: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                // The stored value is a JSON array; the label a selector shows is its contents.
                detail: parse_string_list(row.get::<_, Option<String>>(2)?.unwrap_or_default())
                    .join(", "),
            })
        })
        .map_err(|err| format!("Failed to search additives: {err}"))?;
    collect_rows(rows, "additive option")
}

/// Deletes an additive, refusing while any formulation still references it. See
/// `delete_base_oil` for why the cascade is not the default.
#[tauri::command]
pub fn delete_additive(app: AppHandle, id: String) -> Result<DeletionOutcome, String> {
    let connection = open_connection(&app)?;
    delete_catalogue_record(&connection, ComponentLink::Additive, "additives", &id)
}

/// Deletes an additive *and* the formulation components that reference it, on explicit request.
#[tauri::command]
pub fn delete_additive_with_components(
    app: AppHandle,
    id: String,
    confirm_cascade: bool,
) -> Result<DeletionOutcome, String> {
    let mut connection = open_connection(&app)?;
    cascade_delete_catalogue_record(
        &mut connection,
        ComponentLink::Additive,
        "additives",
        &id,
        confirm_cascade,
    )
}

/// The shared body of both safe deletes.
///
/// `table` is never caller-supplied: both call sites pass a literal, and the two literals are the
/// only values this function is ever given.
fn delete_catalogue_record(
    connection: &Connection,
    link: ComponentLink,
    table: &'static str,
    id: &str,
) -> Result<DeletionOutcome, String> {
    let affected = references::affected_formulations(connection, link, id)?;
    if !affected.is_empty() {
        return Ok(DeletionOutcome::blocked(id, affected));
    }
    let deleted = connection
        .execute(&format!("DELETE FROM {table} WHERE id = ?1"), params![id])
        .map_err(|err| format!("Failed to delete {}: {err}", link.label()))?;
    Ok(DeletionOutcome::deleted(id, deleted > 0))
}

/// The shared body of both cascading deletes.
fn cascade_delete_catalogue_record(
    connection: &mut Connection,
    link: ComponentLink,
    table: &'static str,
    id: &str,
    confirm_cascade: bool,
) -> Result<DeletionOutcome, String> {
    let affected = references::affected_formulations(connection, link, id)?;
    // Nothing references it, so there is no cascade to confirm; this is the plain delete.
    if affected.is_empty() {
        return delete_catalogue_record(connection, link, table, id);
    }
    references::require_cascade_confirmation(confirm_cascade, link, &affected)?;

    let column = match link {
        ComponentLink::BaseOil => "base_oil_id",
        ComponentLink::Additive => "additive_id",
        ComponentLink::Molecule => "molecule_id",
    };
    let transaction = connection
        .transaction()
        .map_err(|err| format!("Failed to start the cascading delete transaction: {err}"))?;
    let removed_components = transaction
        .execute(
            &format!("DELETE FROM formulation_components WHERE {column} = ?1"),
            params![id],
        )
        .map_err(|err| format!("Failed to remove referencing components: {err}"))?;
    let deleted = transaction
        .execute(&format!("DELETE FROM {table} WHERE id = ?1"), params![id])
        .map_err(|err| format!("Failed to delete {}: {err}", link.label()))?;
    transaction
        .commit()
        .map_err(|err| format!("Failed to commit the cascading delete: {err}"))?;

    Ok(DeletionOutcome {
        id: id.to_string(),
        deleted: deleted > 0,
        success: deleted > 0,
        blocked: false,
        // Reported, not discarded: the caller asked to damage these formulations and is entitled
        // to a list of exactly which ones, after the fact as well as before it.
        blocked_by: affected,
        removed_components: removed_components as i64,
    })
}

fn open_connection(app: &AppHandle) -> Result<Connection, String> {
    open_database(default_database_path(app)?)
        .map_err(|err| format!("Failed to open SQLite database: {err}"))
}

fn get_base_oil(connection: &Connection, id: &str) -> Result<BaseOilDto, String> {
    connection
        .query_row(
            "SELECT id, name, base_oil_type, representative_molecule_id, viscosity_40c,
                    viscosity_100c, viscosity_index, density, pour_point, flash_point,
                    supplier, batch_number, notes, created_at, updated_at, commercial_product_id
             FROM base_oils
             WHERE id = ?1",
            params![id],
            |row| {
                Ok(BaseOilDto {
                    commercial_product_id: row.get(15)?,
                    id: row.get(0)?,
                    name: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    base_oil_type: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    representative_molecule_id: row
                        .get::<_, Option<String>>(3)?
                        .unwrap_or_default(),
                    viscosity_40c: row.get(4)?,
                    viscosity_100c: row.get(5)?,
                    viscosity_index: row.get(6)?,
                    density: row.get(7)?,
                    pour_point: row.get(8)?,
                    flash_point: row.get(9)?,
                    supplier: row.get::<_, Option<String>>(10)?.unwrap_or_default(),
                    batch_number: row.get::<_, Option<String>>(11)?.unwrap_or_default(),
                    formulation_count: 0,
                    notes: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
                    created_at: row.get(13)?,
                    updated_at: row.get(14)?,
                })
            },
        )
        .map_err(|err| format!("Failed to load created base oil: {err}"))
}

fn get_additive(connection: &Connection, id: &str) -> Result<AdditiveDto, String> {
    connection
        .query_row(
            "SELECT a.id, a.molecule_id, COALESCE(m.name, p.name, ''), a.function_types, a.active_elements,
                    a.typical_concentration_min, a.typical_concentration_max, a.concentration_unit,
                    a.compatible_base_oils, a.application_notes, a.created_at, a.updated_at, a.commercial_product_id
             FROM additives a
             LEFT JOIN molecules m ON m.id = a.molecule_id
             LEFT JOIN commercial_product_labels p ON p.id = a.commercial_product_id
             WHERE a.id = ?1",
            params![id],
            |row| {
                Ok(AdditiveDto {
                    commercial_product_id: row.get(12)?,
                    id: row.get(0)?,
                    molecule_id: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    molecule_name: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    function_types: parse_string_list(
                        row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    ),
                    active_elements: parse_string_list(
                        row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                    ),
                    typical_concentration_min: row.get::<_, Option<f64>>(5)?.unwrap_or_default(),
                    typical_concentration_max: row.get::<_, Option<f64>>(6)?.unwrap_or_default(),
                    concentration_unit: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                    compatible_base_oils: parse_string_list(
                        row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                    ),
                    formulation_count: 0,
                    best_friction_coefficient: None,
                    best_wear_scar_diameter: None,
                    application_notes: row.get::<_, Option<String>>(9)?.unwrap_or_default(),
                    created_at: row.get(10)?,
                    updated_at: row.get(11)?,
                })
            },
        )
        .map_err(|err| format!("Failed to load created additive: {err}"))
}

fn collect_rows<T>(
    rows: rusqlite::MappedRows<'_, impl FnMut(&rusqlite::Row<'_>) -> rusqlite::Result<T>>,
    label: &str,
) -> Result<Vec<T>, String> {
    let mut items = Vec::new();
    for row in rows {
        items.push(row.map_err(|err| format!("Failed to read {label} row: {err}"))?);
    }
    Ok(items)
}

fn parse_string_list(value: String) -> Vec<String> {
    if value.trim().is_empty() {
        return Vec::new();
    }
    if let Ok(items) = serde_json::from_str::<Vec<String>>(&value) {
        return items;
    }
    value
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn field_string(payload: &Value, key: &str) -> Option<String> {
    payload.get(key).and_then(|value| match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    })
}

/// Normalizes a list field to the JSON array the column stores.
///
/// Accepts the array the interface sends and the delimited string a spreadsheet import produces,
/// so both arrive in the database in one shape.
fn normalize_list(value: Option<&Value>) -> String {
    let items = match value {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| match item {
                Value::String(text) => {
                    let trimmed = text.trim();
                    (!trimmed.is_empty()).then(|| trimmed.to_string())
                }
                Value::Number(number) => Some(number.to_string()),
                _ => None,
            })
            .collect::<Vec<_>>(),
        Some(Value::String(text)) => text
            .split([';', ',', '|'])
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(ToOwned::to_owned)
            .collect::<Vec<_>>(),
        _ => Vec::new(),
    };
    serde_json::to_string(&items).unwrap_or_else(|_| "[]".to_string())
}
