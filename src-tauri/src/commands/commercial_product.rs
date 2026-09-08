use crate::app_paths::default_database_path;
use crate::commands::{
    errors,
    pagination::{Page, PageRequest},
    validation,
};
use crate::db::open_database;
use chrono::{NaiveDate, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use uuid::Uuid;

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MaterialProperty {
    pub name: String,
    pub value: String,
    pub unit: String,
    pub conditions: String,
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MaterialProperties {
    pub viscosity40c: Option<f64>,
    pub viscosity100c: Option<f64>,
    pub viscosity_index: Option<f64>,
    pub density: Option<f64>,
    pub pour_point: Option<f64>,
    pub flash_point: Option<f64>,
    pub appearance: String,
    pub solubility: String,
    pub conditions: String,
    pub custom: Vec<MaterialProperty>,
}

impl MaterialProperties {
    fn validate(&mut self) -> Result<(), String> {
        for value in [self.viscosity40c, self.viscosity100c, self.density]
            .into_iter()
            .flatten()
        {
            if !value.is_finite() || value <= 0.0 {
                return Err(errors::coded(
                    "product.invalidProperties",
                    "Viscosity and density must be positive finite values.",
                ));
            }
        }
        for value in [self.viscosity_index, self.pour_point, self.flash_point]
            .into_iter()
            .flatten()
        {
            if !value.is_finite() {
                return Err(errors::coded(
                    "product.invalidProperties",
                    "Material properties must be finite.",
                ));
            }
        }
        for value in [
            &mut self.appearance,
            &mut self.solubility,
            &mut self.conditions,
        ] {
            *value = value.trim().to_string();
        }
        for property in &mut self.custom {
            for value in [
                &mut property.name,
                &mut property.value,
                &mut property.unit,
                &mut property.conditions,
            ] {
                *value = value.trim().to_string();
            }
            if property.name.is_empty() || property.value.is_empty() {
                return Err(errors::coded(
                    "product.invalidProperties",
                    "Each custom property needs a name and a value.",
                ));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProductWrite {
    pub name: String,
    pub category: String,
    pub general_formula: String,
    pub manufacturer: String,
    pub production_date: String,
    pub batch_number: String,
    pub product_number: String,
    pub supplier: String,
    pub notes: String,
    pub material_properties: MaterialProperties,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductDto {
    pub id: String,
    #[serde(flatten)]
    pub data: ProductWrite,
    pub created_at: String,
    pub updated_at: String,
    pub base_oil_id: Option<String>,
    pub additive_id: Option<String>,
}

const SELECT: &str = "SELECT p.id, p.name, p.category, p.general_formula, p.manufacturer,
    p.production_date, p.batch_number, p.product_number, p.supplier, p.notes,
    p.created_at, p.updated_at, b.id, a.id, p.material_properties_json FROM commercial_products p
    LEFT JOIN base_oils b ON b.commercial_product_id = p.id
    LEFT JOIN additives a ON a.commercial_product_id = p.id";

fn read_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ProductDto> {
    Ok(ProductDto {
        id: row.get(0)?,
        data: ProductWrite {
            name: row.get(1)?,
            category: row.get(2)?,
            general_formula: row.get(3)?,
            manufacturer: row.get(4)?,
            production_date: row.get(5)?,
            batch_number: row.get(6)?,
            product_number: row.get(7)?,
            supplier: row.get(8)?,
            notes: row.get(9)?,
            material_properties: serde_json::from_str(&row.get::<_, String>(14)?).map_err(
                |err| {
                    rusqlite::Error::FromSqlConversionFailure(
                        14,
                        rusqlite::types::Type::Text,
                        Box::new(err),
                    )
                },
            )?,
        },
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        base_oil_id: row.get(12)?,
        additive_id: row.get(13)?,
    })
}

fn open(app: &AppHandle) -> Result<Connection, String> {
    open_database(default_database_path(app)?).map_err(|err| err.to_string())
}

pub fn get_product(connection: &Connection, id: &str) -> Result<ProductDto, String> {
    connection
        .query_row(&format!("{SELECT} WHERE p.id = ?1"), [id], read_row)
        .optional()
        .map_err(|err| err.to_string())?
        .ok_or_else(|| errors::coded(errors::RECORD_NOT_FOUND, id))
}

#[tauri::command]
pub fn get_commercial_product(app: AppHandle, id: String) -> Result<ProductDto, String> {
    get_product(&open(&app)?, &id)
}

pub fn list_products(
    connection: &Connection,
    request: PageRequest,
    category: Option<String>,
) -> Result<Page<ProductDto>, String> {
    let resolved = request.resolve();
    let pattern = request.like_pattern().unwrap_or_else(|| "%".to_string());
    let category = category.unwrap_or_default();
    let filter = "WHERE (?2 = '' OR p.category = ?2) AND
        (p.name LIKE ?1 ESCAPE '\\' OR p.manufacturer LIKE ?1 ESCAPE '\\'
        OR p.product_number LIKE ?1 ESCAPE '\\' OR p.batch_number LIKE ?1 ESCAPE '\\'
        OR p.general_formula LIKE ?1 ESCAPE '\\' OR p.supplier LIKE ?1 ESCAPE '\\')";
    let total = connection
        .query_row(
            &format!("SELECT COUNT(*) FROM commercial_products p {filter}"),
            params![pattern, category],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;
    let mut statement = connection
        .prepare(&format!(
            "{SELECT} {filter} ORDER BY p.created_at DESC, p.id DESC LIMIT ?3 OFFSET ?4"
        ))
        .map_err(|err| err.to_string())?;
    let items = statement
        .query_map(
            params![pattern, category, resolved.limit, resolved.offset],
            read_row,
        )
        .map_err(|err| err.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    Ok(Page::new(items, total, resolved))
}

#[tauri::command]
pub fn list_commercial_products_page(
    app: AppHandle,
    request: Option<PageRequest>,
    category: Option<String>,
) -> Result<Page<ProductDto>, String> {
    list_products(&open(&app)?, request.unwrap_or_default(), category)
}

pub fn save_product(
    connection: &Connection,
    id: Option<&str>,
    mut payload: ProductWrite,
) -> Result<ProductDto, String> {
    payload.name = validation::require_name(Some(&payload.name), "The commercial product name")?;
    for value in [
        &mut payload.category,
        &mut payload.general_formula,
        &mut payload.manufacturer,
        &mut payload.production_date,
        &mut payload.batch_number,
        &mut payload.product_number,
        &mut payload.supplier,
        &mut payload.notes,
    ] {
        *value = value.trim().to_string();
    }
    if !["", "base_oil", "additive"].contains(&payload.category.as_str()) {
        return Err(errors::coded("product.invalidCategory", &payload.category));
    }
    if !payload.production_date.is_empty()
        && (NaiveDate::parse_from_str(&payload.production_date, "%Y-%m-%d")
            .map(|date| date.format("%Y-%m-%d").to_string() != payload.production_date)
            .unwrap_or(true))
    {
        return Err(errors::coded(
            "product.invalidDate",
            &payload.production_date,
        ));
    }
    payload.material_properties.validate()?;
    let properties_json =
        serde_json::to_string(&payload.material_properties).map_err(|err| err.to_string())?;
    let now = Utc::now().to_rfc3339();
    let transaction = connection
        .unchecked_transaction()
        .map_err(|err| err.to_string())?;
    let record_id = match id {
        Some(id) => {
            get_product(&transaction, id)?;
            id.to_string()
        }
        None => Uuid::new_v4().to_string(),
    };
    transaction.execute("INSERT INTO commercial_products
        (id, name, category, general_formula, manufacturer, production_date, batch_number,
            product_number, supplier, notes, created_at, updated_at, material_properties_json)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name, category=excluded.category,
            general_formula=excluded.general_formula, manufacturer=excluded.manufacturer,
            production_date=excluded.production_date, batch_number=excluded.batch_number,
            product_number=excluded.product_number, supplier=excluded.supplier, notes=excluded.notes,
            updated_at=excluded.updated_at, material_properties_json=excluded.material_properties_json",
        params![record_id, payload.name, payload.category, payload.general_formula, payload.manufacturer,
            payload.production_date, payload.batch_number, payload.product_number, payload.supplier, payload.notes, now, properties_json])
        .map_err(|err| err.to_string())?;
    let record = get_product(&transaction, &record_id)?;
    transaction.commit().map_err(|err| err.to_string())?;
    Ok(record)
}

#[tauri::command]
pub fn save_commercial_product(
    app: AppHandle,
    id: Option<String>,
    payload: ProductWrite,
) -> Result<ProductDto, String> {
    save_product(&open(&app)?, id.as_deref(), payload)
}

pub fn delete_product(connection: &Connection, id: &str) -> Result<(), String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|err| err.to_string())?;
    let product = get_product(&transaction, id)?;
    if product.base_oil_id.is_some() || product.additive_id.is_some() {
        return Err(errors::coded("product.inUse", id));
    }
    transaction
        .execute("DELETE FROM commercial_products WHERE id = ?1", [id])
        .map_err(|err| err.to_string())?;
    transaction.commit().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn delete_commercial_product(app: AppHandle, id: String) -> Result<(), String> {
    delete_product(&open(&app)?, &id)
}

/// Register a source once per role. Repeated clicks return the existing registration.
pub fn register_product(
    connection: &Connection,
    id: &str,
    role: &str,
) -> Result<ProductDto, String> {
    let transaction = connection
        .unchecked_transaction()
        .map_err(|err| err.to_string())?;
    let product = get_product(&transaction, id)?;
    let now = Utc::now().to_rfc3339();
    let record_id = Uuid::new_v4().to_string();
    match role {
        "base_oil" if product.base_oil_id.is_none() => {
            let label: String = transaction
                .query_row(
                    "SELECT name FROM commercial_product_labels WHERE id = ?1",
                    [id],
                    |row| row.get(0),
                )
                .map_err(|err| err.to_string())?;
            let properties = &product.data.material_properties;
            transaction.execute("INSERT INTO base_oils (id, name, commercial_product_id, supplier, batch_number, created_at, updated_at,
                viscosity_40c, viscosity_100c, viscosity_index, density, pour_point, flash_point)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
                params![record_id, label, id, product.data.supplier, product.data.batch_number, now,
                    properties.viscosity40c, properties.viscosity100c, properties.viscosity_index,
                    properties.density, properties.pour_point, properties.flash_point])
                .map_err(|err| err.to_string())?;
        }
        "additive" if product.additive_id.is_none() => {
            transaction.execute("INSERT INTO additives (id, commercial_product_id, function_types, active_elements,
                compatible_base_oils, concentration_unit, created_at, updated_at)
                VALUES (?1, ?2, '[]', '[]', '[]', 'wt%', ?3, ?3)", params![record_id, id, now])
                .map_err(|err| err.to_string())?;
        }
        "base_oil" | "additive" => {}
        _ => return Err(errors::coded("product.invalidCategory", role)),
    }
    let result = get_product(&transaction, id)?;
    transaction.commit().map_err(|err| err.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn register_commercial_product(
    app: AppHandle,
    id: String,
    role: String,
) -> Result<ProductDto, String> {
    register_product(&open(&app)?, &id, &role)
}
