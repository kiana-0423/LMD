//! The molecule library, as a use case over one workspace database.
//!
//! Everything here takes the connection it reads from. Which workspace that connection belongs to
//! is the caller's decision: the desktop command resolves the active local workspace, and a later
//! host can resolve it some other way without this module changing.
//!
//! Structure files on disk are deliberately not read here. A listing never returned them, and the
//! single-molecule view that does attaches them in the desktop command layer, which owns workspace
//! files.
//!
//! The SQL is SQLite's: `datetime()`, `GLOB`, `substr(x, -n)` and `?N` parameters. It is not
//! portable to another database as written, and a different backend gets its own implementation
//! held to the same behavioural tests (`tests/support/molecule_listing.rs`).

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// `datetime()` truncates to whole seconds, so a bulk import writes hundreds of rows that share a
/// sort key. The raw timestamp and then the id give LIMIT/OFFSET a total order, without which pages
/// can repeat or drop rows.
pub const MOLECULE_LIST_ORDER: &str =
    "ORDER BY datetime(created_at) DESC, created_at DESC, id DESC";

/// The columns `molecule_from_row` reads, in the order it reads them.
pub const MOLECULE_COLUMNS: &str =
    "id, name, aliases, smiles_raw, smiles_canonical, inchi, inchi_key, formula,
     molecular_weight, category, tags, molfile, duplicate_of, import_mode, source,
     structure_svg_path, mol_file_path, sdf_file_path, pdb_file_path,
     rdkit_descriptor_status, mordred_descriptor_status, descriptor_ready, source_id, notes,
     created_at, updated_at";

pub const DEFAULT_PAGE_SIZE: i64 = 50;
pub const MAX_PAGE_SIZE: i64 = 200;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoleculeDto {
    pub id: String,
    pub name: String,
    pub aliases: String,
    pub smiles_raw: String,
    pub smiles_canonical: String,
    pub inchi: String,
    pub inchi_key: String,
    pub formula: String,
    pub molecular_weight: f64,
    pub category: String,
    pub additive_function_tags: Vec<String>,
    pub tags: Vec<String>,
    pub molfile: String,
    pub duplicate_of: String,
    pub import_mode: String,
    pub source: String,
    pub structure_svg_path: String,
    pub structure_svg: String,
    pub mol_file_path: String,
    pub sdf_file_path: String,
    pub pdb_file_path: String,
    pub mol_block: String,
    pub sdf_block: String,
    pub pdb_block: String,
    pub rdkit_descriptor_status: String,
    pub mordred_descriptor_status: String,
    pub descriptor_ready: bool,
    pub source_id: String,
    pub data_source: String,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MoleculeListFilter {
    pub search: String,
    pub category: String,
    pub source: String,
    pub import_mode: String,
    pub duplicate_status: String,
    pub element: String,
    pub page: i64,
    pub page_size: i64,
}

impl MoleculeListFilter {
    /// Reads a filter as a caller sends it. An absent filter means "no filter"; missing fields take
    /// their defaults. (The desktop command receives a JSON `null` as `None` already.)
    pub fn from_json(filter: Option<Value>) -> Result<Self, String> {
        Ok(filter
            .map(serde_json::from_value::<MoleculeListFilter>)
            .transpose()
            .map_err(|err| format!("Invalid molecule list filter: {err}"))?
            .unwrap_or_default())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoleculePageDto {
    pub items: Vec<MoleculeDto>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

/// One page of the molecule library, filtered, with the total that matches the filter.
///
/// A page below 1 is read as the first page; a page size of zero or less means the default, and
/// anything above the maximum is capped to it. The page and page size returned are the ones used.
pub fn list_molecules(
    conn: &Connection,
    mut filter: MoleculeListFilter,
) -> Result<MoleculePageDto, String> {
    filter.page = filter.page.max(1);
    filter.page_size = if filter.page_size <= 0 {
        DEFAULT_PAGE_SIZE
    } else {
        filter.page_size.min(MAX_PAGE_SIZE)
    };
    let search = if filter.search.trim().is_empty() {
        String::new()
    } else {
        format!("%{}%", filter.search.trim().to_ascii_lowercase())
    };
    let offset = (filter.page - 1) * filter.page_size;
    // The element filter must not match a longer symbol that merely starts with the same letter:
    // a plain substring test reports boron for C20H42BrNO2 and sulfur for C10H22SiO. An element
    // occurrence ends at a digit, at the next capital, or at the end of the formula.
    let where_sql =
        "WHERE (?1 = '' OR lower(name) LIKE ?1 OR lower(smiles_canonical) LIKE ?1 OR lower(inchi_key) LIKE ?1)
           AND (?2 = '' OR category = ?2)
           AND (?3 = '' OR source = ?3 OR source_id = ?3)
           AND (?4 = '' OR import_mode = ?4)
           AND (
             ?5 = ''
             OR (?5 = 'duplicate' AND COALESCE(duplicate_of, '') <> '')
             OR (?5 = 'original' AND COALESCE(duplicate_of, '') = '')
           )
           AND (
             ?6 = ''
             OR formula GLOB ('*' || ?6 || '[0-9A-Z]*')
             OR substr(formula, -length(?6)) = ?6
           )";
    let total: i64 = conn
        .query_row(
            &format!("SELECT COUNT(*) FROM molecules {where_sql}"),
            params![
                &search,
                &filter.category,
                &filter.source,
                &filter.import_mode,
                &filter.duplicate_status,
                &filter.element
            ],
            |row| row.get(0),
        )
        .map_err(|err| format!("Failed to count filtered molecules: {err}"))?;
    let mut statement = conn
        .prepare(&format!(
            "SELECT {MOLECULE_COLUMNS}
             FROM molecules
             {where_sql}
             {MOLECULE_LIST_ORDER}
             LIMIT ?7 OFFSET ?8"
        ))
        .map_err(|err| format!("Failed to prepare molecule list query: {err}"))?;
    let rows = statement
        .query_map(
            params![
                &search,
                &filter.category,
                &filter.source,
                &filter.import_mode,
                &filter.duplicate_status,
                &filter.element,
                filter.page_size,
                offset
            ],
            molecule_from_row,
        )
        .map_err(|err| format!("Failed to query molecules: {err}"))?;
    let mut molecules = Vec::new();
    for row in rows {
        molecules.push(row.map_err(|err| format!("Failed to read molecule row: {err}"))?);
    }
    Ok(MoleculePageDto {
        items: molecules,
        total,
        page: filter.page,
        page_size: filter.page_size,
    })
}

/// Maps a row selected with `MOLECULE_COLUMNS`.
///
/// The structure blocks read from workspace files (`structure_svg`, `mol_block`, `sdf_block`,
/// `pdb_block`) are left empty; the caller that owns the workspace fills them when it needs them.
pub fn molecule_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MoleculeDto> {
    let tags_text: String = row.get::<_, Option<String>>(10)?.unwrap_or_default();
    let tags: Vec<String> = serde_json::from_str(&tags_text).unwrap_or_default();
    let source: String = row.get::<_, Option<String>>(14)?.unwrap_or_default();
    let source_id: String = row.get::<_, Option<String>>(22)?.unwrap_or_default();
    Ok(MoleculeDto {
        id: row.get(0)?,
        name: row.get(1)?,
        aliases: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
        smiles_raw: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
        smiles_canonical: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
        inchi: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
        inchi_key: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
        formula: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
        molecular_weight: row.get::<_, Option<f64>>(8)?.unwrap_or_default(),
        category: row
            .get::<_, Option<String>>(9)?
            .unwrap_or_else(|| "candidate".to_string()),
        additive_function_tags: tags.clone(),
        tags,
        molfile: row.get::<_, Option<String>>(11)?.unwrap_or_default(),
        duplicate_of: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
        import_mode: row
            .get::<_, Option<String>>(13)?
            .unwrap_or_else(|| "manual_save".to_string()),
        source: if source.is_empty() {
            source_id.clone()
        } else {
            source
        },
        structure_svg_path: row.get::<_, Option<String>>(15)?.unwrap_or_default(),
        structure_svg: String::new(),
        mol_file_path: row.get::<_, Option<String>>(16)?.unwrap_or_default(),
        sdf_file_path: row.get::<_, Option<String>>(17)?.unwrap_or_default(),
        pdb_file_path: row.get::<_, Option<String>>(18)?.unwrap_or_default(),
        mol_block: String::new(),
        sdf_block: String::new(),
        pdb_block: String::new(),
        rdkit_descriptor_status: row
            .get::<_, Option<String>>(19)?
            .unwrap_or_else(|| "pending".to_string()),
        mordred_descriptor_status: row
            .get::<_, Option<String>>(20)?
            .unwrap_or_else(|| "pending".to_string()),
        descriptor_ready: row.get::<_, Option<i64>>(21)?.unwrap_or_default() == 1,
        source_id: source_id.clone(),
        data_source: source_id,
        notes: row.get::<_, Option<String>>(23)?.unwrap_or_default(),
        created_at: row.get(24)?,
        updated_at: row.get(25)?,
    })
}
