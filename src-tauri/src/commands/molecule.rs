use crate::app_paths::{default_database_path, default_workspace_dir};
use crate::commands::attachments;
use crate::commands::sidecar::prepare_molecule_with_sidecar;
use crate::db::open_database;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use tauri::AppHandle;
use uuid::Uuid;

const MOLECULE_LIST_ORDER: &str = "ORDER BY datetime(created_at) DESC, created_at DESC, id DESC";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveMoleculePayload {
    pub name: String,
    pub aliases: Option<String>,
    pub smiles: String,
    pub category: Option<String>,
    pub data_source: Option<String>,
    pub notes: Option<String>,
    pub additive_function_tags: Option<Vec<String>>,
}

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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MoleculePageDto {
    pub items: Vec<MoleculeDto>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckMoleculeDuplicatePayload {
    pub canonical_smiles: String,
    pub inchikey: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportNewMoleculePayload {
    pub name: String,
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
    pub original_smiles: String,
    pub canonical_smiles: String,
    pub molfile: Option<String>,
    pub formula: Option<String>,
    pub molecular_weight: Option<f64>,
    pub inchikey: Option<String>,
    pub descriptor_json: Option<Value>,
    pub duplicate_of: Option<String>,
    pub import_mode: Option<String>,
    pub source: Option<String>,
    pub notes: Option<String>,
}

#[tauri::command]
pub async fn list_molecules(
    app: AppHandle,
    filter: Option<Value>,
) -> Result<MoleculePageDto, String> {
    tauri::async_runtime::spawn_blocking(move || list_molecules_blocking(&app, filter))
        .await
        .map_err(|err| format!("Molecule list task failed: {err}"))?
}

fn list_molecules_blocking(
    app: &AppHandle,
    filter: Option<Value>,
) -> Result<MoleculePageDto, String> {
    let mut filter = filter
        .map(serde_json::from_value::<MoleculeListFilter>)
        .transpose()
        .map_err(|err| format!("Invalid molecule list filter: {err}"))?
        .unwrap_or_default();
    filter.page = filter.page.max(1);
    filter.page_size = if filter.page_size <= 0 {
        50
    } else {
        filter.page_size.min(200)
    };
    let search = if filter.search.trim().is_empty() {
        String::new()
    } else {
        format!("%{}%", filter.search.trim().to_ascii_lowercase())
    };
    let offset = (filter.page - 1) * filter.page_size;
    let conn = open_connection(app)?;
    // `datetime()` truncates to whole seconds, so a bulk import writes hundreds of rows that
    // share a sort key. The raw timestamp and then the id give LIMIT/OFFSET a total order,
    // without which pages can repeat or drop rows.
    //
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
            "SELECT id, name, aliases, smiles_raw, smiles_canonical, inchi, inchi_key, formula,
                    molecular_weight, category, tags, molfile, duplicate_of, import_mode, source,
                    structure_svg_path, mol_file_path, sdf_file_path, pdb_file_path,
                    rdkit_descriptor_status, mordred_descriptor_status, descriptor_ready, source_id, notes,
                    created_at, updated_at
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
            |row| row_to_molecule(row, None),
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

#[tauri::command]
pub fn get_molecule(app: AppHandle, id: String) -> Result<Option<MoleculeDto>, String> {
    let conn = open_connection(&app)?;
    let workspace = default_workspace_dir(&app)?;
    conn.query_row(
        "SELECT id, name, aliases, smiles_raw, smiles_canonical, inchi, inchi_key, formula,
                molecular_weight, category, tags, molfile, duplicate_of, import_mode, source,
                structure_svg_path, mol_file_path, sdf_file_path, pdb_file_path,
                rdkit_descriptor_status, mordred_descriptor_status, descriptor_ready, source_id, notes,
                created_at, updated_at
         FROM molecules
         WHERE id = ?1",
        params![id],
        |row| row_to_molecule(row, Some(&workspace)),
    )
    .optional()
    .map_err(|err| format!("Failed to get molecule: {err}"))
}

#[tauri::command]
pub fn delete_molecule(app: AppHandle, id: String) -> Result<Value, String> {
    let workspace = default_workspace_dir(&app)?;
    let mut conn = open_connection(&app)?;
    let file_paths = conn
        .query_row(
            "SELECT structure_svg_path, mol_file_path, sdf_file_path, pdb_file_path
             FROM molecules
             WHERE id = ?1",
            params![&id],
            |row| {
                Ok([
                    row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                ])
            },
        )
        .optional()
        .map_err(|err| format!("Failed to read molecule files before delete: {err}"))?;

    // Foreign keys are enforced, so deleting a referenced molecule would otherwise fail deep in
    // SQLite with "FOREIGN KEY constraint failed". Name what is holding it instead — silently
    // destroying the dependent additive or formulation would be worse than refusing.
    let references = molecule_references(&conn, &id)?;
    if !references.is_empty() {
        return Err(format!(
            "This molecule is still referenced by {}. Remove those records first.",
            references.join(", ")
        ));
    }

    // Files are moved aside before the transaction and only deleted once it commits, so a failed
    // delete leaves both the rows and the files intact. A file that cannot be moved aside stops
    // the delete outright rather than leaving an untracked orphan on disk.
    let attachment_paths = attachments::attachment_paths(&conn, attachments::ENTITY_MOLECULE, &id)?;
    let owned_files: Vec<String> = file_paths
        .iter()
        .flatten()
        .chain(attachment_paths.iter())
        .filter(|relative| !relative.trim().is_empty())
        .cloned()
        .collect();

    let (
        (deleted_descriptors, deleted_attachments, deleted_molecules),
        removed_files,
        cleanup_failures,
    ) = attachments::delete_with_files(&workspace, &owned_files, || {
        let tx = conn
            .transaction()
            .map_err(|err| format!("Failed to start molecule delete transaction: {err}"))?;
        let deleted_descriptors = tx
            .execute(
                "DELETE FROM molecule_descriptors WHERE molecule_id = ?1",
                params![&id],
            )
            .map_err(|err| format!("Failed to delete molecule descriptors: {err}"))?;
        let deleted_attachments =
            attachments::delete_attachment_rows(&tx, attachments::ENTITY_MOLECULE, &id)?;
        // `duplicate_of` carries no foreign key, so dangling pointers have to be cleared by hand.
        tx.execute(
            "UPDATE molecules SET duplicate_of = NULL WHERE duplicate_of = ?1",
            params![&id],
        )
        .map_err(|err| format!("Failed to clear duplicate references: {err}"))?;
        let deleted_molecules = tx
            .execute("DELETE FROM molecules WHERE id = ?1", params![&id])
            .map_err(|err| format!("Failed to delete molecule: {err}"))?;
        tx.commit()
            .map_err(|err| format!("Failed to commit molecule delete transaction: {err}"))?;
        Ok((deleted_descriptors, deleted_attachments, deleted_molecules))
    })?;

    Ok(json!({
        "success": deleted_molecules > 0,
        "deleted": deleted_molecules > 0,
        "id": id,
        "deletedDescriptors": deleted_descriptors,
        "deletedAttachments": deleted_attachments,
        "removedFiles": removed_files,
        // Reported rather than swallowed: the rows are gone but the disk may not be clean.
        "cleanupFailures": cleanup_failures
    }))
}

#[tauri::command]
pub fn check_molecule_duplicate(
    app: AppHandle,
    payload: CheckMoleculeDuplicatePayload,
) -> Result<Value, String> {
    let conn = open_connection(&app)?;
    let canonical = payload.canonical_smiles.trim().to_string();
    let inchikey = payload.inchikey.unwrap_or_default();
    let mut statement = conn
        .prepare(
            "SELECT id, smiles_canonical, inchi_key FROM molecules
             WHERE (?1 <> '' AND smiles_canonical = ?1) OR (?2 <> '' AND inchi_key = ?2)
             ORDER BY datetime(created_at) ASC, created_at ASC, id ASC
             LIMIT 1",
        )
        .map_err(|err| format!("Failed to prepare duplicate check: {err}"))?;
    let existing = statement
        .query_row(params![canonical, inchikey], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            ))
        })
        .optional()
        .map_err(|err| format!("Failed to check duplicate molecule: {err}"))?;

    let Some((id, matched_smiles, matched_inchikey)) = existing else {
        return Ok(json!({ "duplicate": false }));
    };
    let matched_by = match (
        !canonical.is_empty() && matched_smiles == canonical,
        !inchikey.is_empty() && matched_inchikey == inchikey,
    ) {
        (true, true) => "both",
        (true, false) => "canonical_smiles",
        (false, true) => "inchikey",
        (false, false) => "unknown",
    };
    Ok(json!({
        "duplicate": true,
        "existing_molecule_id": id,
        "matched_by": matched_by
    }))
}

#[tauri::command]
pub async fn import_new_molecule(
    app: AppHandle,
    payload: ImportNewMoleculePayload,
) -> Result<Value, String> {
    let input_smiles = payload.canonical_smiles.trim().to_string();
    if input_smiles.is_empty() {
        return Ok(
            json!({ "success": false, "error": "SMILES is required. Please generate a valid canonical SMILES first." }),
        );
    }
    // One sidecar process for the whole sequence. This used to be four — standardize, visualize,
    // smiles-to-molfile, generate-3d — each paying the full cost of starting a one-file PyInstaller
    // bundle and importing RDKit before doing any chemistry.
    let prepared = prepare_molecule_with_sidecar(&app, &input_smiles, true).await?;
    let std_data = &prepared.identifiers;
    let vis_data = &prepared.visualization;
    let molfile_data = &prepared.molfile;
    let generated_3d_data = &prepared.three_d;
    let canonical_smiles = std_data
        .get("smiles_canonical")
        .or_else(|| std_data.get("canonical_smiles"))
        .and_then(Value::as_str)
        .unwrap_or(&input_smiles)
        .to_string();
    if canonical_smiles.trim().is_empty() {
        return Ok(
            json!({ "success": false, "error": "SMILES is required. Please generate a valid canonical SMILES first." }),
        );
    }

    let molecule_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let workspace = default_workspace_dir(&app)?;
    let svg = vis_data
        .get("svg")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let generated_mol_block = generated_3d_data
        .get("mol_block")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let molfile = payload
        .molfile
        .clone()
        .or_else(|| {
            molfile_data
                .get("molfile")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        })
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| generated_mol_block.clone());
    let sdf_block = generated_3d_data
        .get("sdf_block")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let pdb_block = generated_3d_data
        .get("pdb_block")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let structure_svg_path = write_structure_file(
        &workspace,
        &format!("files/structures/{molecule_id}.svg"),
        &svg,
        "SVG",
    )?;
    let mol_file_path = write_structure_file(
        &workspace,
        &format!("files/structures/{molecule_id}.mol"),
        if generated_mol_block.trim().is_empty() {
            &molfile
        } else {
            &generated_mol_block
        },
        "MOL",
    )?;
    let sdf_file_path = write_structure_file(
        &workspace,
        &format!("files/structures/{molecule_id}.sdf"),
        &sdf_block,
        "SDF",
    )?;
    let pdb_file_path = write_structure_file(
        &workspace,
        &format!("files/structures/{molecule_id}.pdb"),
        &pdb_block,
        "PDB",
    )?;
    let tags = payload.tags.unwrap_or_default();
    let descriptor_json = payload.descriptor_json.unwrap_or_else(|| json!({}));
    let rdkit_status = descriptor_json
        .get("rdkit_status")
        .and_then(Value::as_str)
        .unwrap_or_else(|| {
            if descriptor_json.get("descriptors").is_some() {
                "calculated"
            } else {
                "failed"
            }
        })
        .to_string();
    let mordred_status = descriptor_json
        .get("mordred_status")
        .and_then(Value::as_str)
        .unwrap_or(&rdkit_status)
        .to_string();
    // Only real calculations count as ready. Treating "mock" as ready made the dashboard's
    // "Molecules Ready" tally and the library's green Ready tag include placeholder values.
    let descriptor_ready = rdkit_status == "calculated" && mordred_status == "calculated";
    let duplicate_of = payload.duplicate_of.unwrap_or_default();
    let import_mode = payload.import_mode.unwrap_or_else(|| {
        if duplicate_of.is_empty() {
            "new_import".to_string()
        } else {
            "new_copy".to_string()
        }
    });
    let source = payload.source.unwrap_or_else(|| "ketcher".to_string());

    let mut conn = open_connection(&app)?;
    let tx = conn
        .transaction()
        .map_err(|err| format!("Failed to start SQLite transaction: {err}"))?;
    tx.execute(
        "INSERT INTO molecules (
            id, name, aliases, smiles_raw, smiles_canonical, inchi, inchi_key, formula, molecular_weight,
            category, tags, molfile, descriptor_json, duplicate_of, import_mode, source,
            structure_svg_path, mol_file_path, sdf_file_path, pdb_file_path,
            rdkit_descriptor_status, mordred_descriptor_status, descriptor_ready, source_id, notes,
            created_at, updated_at
         ) VALUES (?1, ?2, '', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?15, ?24, ?23, ?23)",
        params![
            &molecule_id,
            &payload.name,
            if payload.original_smiles.trim().is_empty() { &canonical_smiles } else { &payload.original_smiles },
            &canonical_smiles,
            std_data.get("inchi").and_then(Value::as_str).unwrap_or_default(),
            std_data.get("inchi_key").and_then(Value::as_str).unwrap_or(payload.inchikey.as_deref().unwrap_or_default()),
            std_data.get("formula").and_then(Value::as_str).unwrap_or(payload.formula.as_deref().unwrap_or_default()),
            std_data.get("molecular_weight").and_then(Value::as_f64).or(payload.molecular_weight).unwrap_or_default(),
            &payload.category.unwrap_or_else(|| "candidate".to_string()),
            serde_json::to_string(&tags).map_err(|err| format!("Failed to serialize molecule tags: {err}"))?,
            &molfile,
            serde_json::to_string(&descriptor_json).map_err(|err| format!("Failed to serialize descriptor JSON: {err}"))?,
            &duplicate_of,
            &import_mode,
            &source,
            &structure_svg_path,
            &mol_file_path,
            &sdf_file_path,
            &pdb_file_path,
            &rdkit_status,
            &mordred_status,
            if descriptor_ready { 1 } else { 0 },
            &now,
            payload.notes.as_deref().unwrap_or_default()
        ],
    )
    .map_err(|err| format!("Failed to import molecule: {err}"))?;

    if let Some(rdkit) = descriptor_json
        .get("descriptors")
        .and_then(|value| value.get("rdkit"))
    {
        insert_descriptor(
            &tx,
            &molecule_id,
            "rdkit",
            rdkit,
            &rdkit_status,
            descriptor_mode(rdkit).as_str(),
            &now,
        )?;
    }
    if let Some(mordred) = descriptor_json
        .get("descriptors")
        .and_then(|value| value.get("mordred"))
    {
        insert_descriptor(
            &tx,
            &molecule_id,
            "mordred",
            mordred,
            &mordred_status,
            descriptor_mode(mordred).as_str(),
            &now,
        )?;
    }
    tx.commit()
        .map_err(|err| format!("Failed to commit molecule import transaction: {err}"))?;

    Ok(json!({
        "success": true,
        "molecule_id": molecule_id,
        "duplicate": !duplicate_of.is_empty(),
        "duplicate_of": duplicate_of
    }))
}

#[tauri::command]
pub async fn save_molecule_with_required_descriptors(
    app: AppHandle,
    payload: SaveMoleculePayload,
) -> Result<MoleculeDto, String> {
    if payload.smiles.trim().is_empty() {
        return Err("SMILES is required.".to_string());
    }
    let smiles = payload.smiles.trim().to_string();

    // One sidecar process for the whole sequence. This used to be five — standardize, visualize,
    // smiles-to-molfile, generate-3d, calculate-required-descriptors — and the process start
    // dominated the wait every time, because a one-file bundle unpacks and imports RDKit, Mordred,
    // NumPy and pandas before the first line of chemistry runs.
    //
    // The descriptor policy is unchanged: a required set that cannot be calculated still fails the
    // whole save rather than storing a molecule with a gap where its descriptors should be.
    let prepared = prepare_molecule_with_sidecar(&app, &smiles, true)
        .await
        .map_err(|err| {
            if err.contains("Mordred descriptors are required")
                || err.contains("Mordred is not installed")
            {
                "Mordred descriptors are required. Please install Mordred or check the Python sidecar environment.".to_string()
            } else {
                err
            }
        })?;

    let std_data = &prepared.identifiers;
    let vis_data = &prepared.visualization;
    let molfile_data = &prepared.molfile;
    let generated_3d_data = &prepared.three_d;
    let req_data = &prepared.descriptors;
    let rdkit = req_data
        .get("rdkit")
        .ok_or_else(|| "Python sidecar did not return RDKit descriptors.".to_string())?;
    let mordred = req_data
        .get("mordred")
        .ok_or_else(|| "Python sidecar did not return Mordred descriptors.".to_string())?;

    let molecule_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let workspace = default_workspace_dir(&app)?;
    let svg = vis_data
        .get("svg")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mol_block = generated_3d_data
        .get("mol_block")
        .and_then(Value::as_str)
        .or_else(|| molfile_data.get("molfile").and_then(Value::as_str))
        .unwrap_or_default()
        .to_string();
    let sdf_block = generated_3d_data
        .get("sdf_block")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let pdb_block = generated_3d_data
        .get("pdb_block")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let structure_svg_path = write_structure_file(
        &workspace,
        &format!("files/structures/{molecule_id}.svg"),
        &svg,
        "SVG",
    )?;
    let mol_file_path = write_structure_file(
        &workspace,
        &format!("files/structures/{molecule_id}.mol"),
        &mol_block,
        "MOL",
    )?;
    let sdf_file_path = write_structure_file(
        &workspace,
        &format!("files/structures/{molecule_id}.sdf"),
        &sdf_block,
        "SDF",
    )?;
    let pdb_file_path = write_structure_file(
        &workspace,
        &format!("files/structures/{molecule_id}.pdb"),
        &pdb_block,
        "PDB",
    )?;

    let rdkit_mode = descriptor_mode(rdkit);
    let mordred_mode = descriptor_mode(mordred);
    let rdkit_status = descriptor_status(rdkit);
    let mordred_status = descriptor_status(mordred);
    // Only real calculations count as ready. Treating "mock" as ready made the dashboard's
    // "Molecules Ready" tally and the library's green Ready tag include placeholder values.
    let descriptor_ready = rdkit_status == "calculated" && mordred_status == "calculated";
    let save_tags = payload.additive_function_tags.clone().unwrap_or_default();

    let molecule = MoleculeDto {
        id: molecule_id.clone(),
        name: if payload.name.trim().is_empty() {
            std_data
                .get("smiles_canonical")
                .and_then(Value::as_str)
                .unwrap_or("Unnamed molecule")
                .to_string()
        } else {
            payload.name.trim().to_string()
        },
        aliases: payload.aliases.unwrap_or_default(),
        smiles_raw: std_data
            .get("smiles_raw")
            .and_then(Value::as_str)
            .unwrap_or(&payload.smiles)
            .to_string(),
        smiles_canonical: std_data
            .get("smiles_canonical")
            .or_else(|| req_data.get("smiles_canonical"))
            .and_then(Value::as_str)
            .unwrap_or(&payload.smiles)
            .to_string(),
        inchi: std_data
            .get("inchi")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        inchi_key: std_data
            .get("inchi_key")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        formula: std_data
            .get("formula")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        molecular_weight: std_data
            .get("molecular_weight")
            .and_then(Value::as_f64)
            .unwrap_or_default(),
        category: payload.category.unwrap_or_else(|| "candidate".to_string()),
        additive_function_tags: save_tags.clone(),
        tags: save_tags,
        molfile: mol_block.clone(),
        duplicate_of: String::new(),
        import_mode: "manual_save".to_string(),
        source: payload
            .data_source
            .clone()
            .unwrap_or_else(|| "smiles_input".to_string()),
        structure_svg_path,
        structure_svg: svg,
        mol_file_path,
        sdf_file_path,
        pdb_file_path,
        mol_block,
        sdf_block,
        pdb_block,
        rdkit_descriptor_status: rdkit_status.clone(),
        mordred_descriptor_status: mordred_status.clone(),
        descriptor_ready,
        source_id: payload.data_source.clone().unwrap_or_default(),
        data_source: payload.data_source.unwrap_or_default(),
        notes: payload.notes.unwrap_or_default(),
        created_at: now.clone(),
        updated_at: now.clone(),
    };

    let mut conn = open_connection(&app)?;
    let tx = conn
        .transaction()
        .map_err(|err| format!("Failed to start SQLite transaction: {err}"))?;
    // `tags`, `import_mode` and `source` have to be written here: the DTO returned to the UI
    // reports them, so leaving them out of the INSERT silently discarded the function tags the
    // entry form had just collected.
    let tags_json = serde_json::to_string(&molecule.additive_function_tags)
        .map_err(|err| format!("Failed to serialize molecule tags: {err}"))?;
    tx.execute(
        "INSERT INTO molecules (
            id, name, aliases, smiles_raw, smiles_canonical, inchi, inchi_key, formula, molecular_weight,
            category, tags, molfile, structure_svg_path, mol_file_path, sdf_file_path, pdb_file_path,
            rdkit_descriptor_status, mordred_descriptor_status, descriptor_ready, import_mode, source,
            source_id, notes, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25)",
        params![
            &molecule.id,
            &molecule.name,
            &molecule.aliases,
            &molecule.smiles_raw,
            &molecule.smiles_canonical,
            &molecule.inchi,
            &molecule.inchi_key,
            &molecule.formula,
            molecule.molecular_weight,
            &molecule.category,
            &tags_json,
            &molecule.molfile,
            &molecule.structure_svg_path,
            &molecule.mol_file_path,
            &molecule.sdf_file_path,
            &molecule.pdb_file_path,
            &molecule.rdkit_descriptor_status,
            &molecule.mordred_descriptor_status,
            if molecule.descriptor_ready { 1 } else { 0 },
            &molecule.import_mode,
            &molecule.source,
            &molecule.source_id,
            &molecule.notes,
            &molecule.created_at,
            &molecule.updated_at
        ],
    )
    .map_err(|err| format!("Failed to insert molecule. It may be a duplicate InChIKey: {err}"))?;

    insert_descriptor(
        &tx,
        &molecule_id,
        "rdkit",
        rdkit,
        &rdkit_status,
        &rdkit_mode,
        &now,
    )?;
    insert_descriptor(
        &tx,
        &molecule_id,
        "mordred",
        mordred,
        &mordred_status,
        &mordred_mode,
        &now,
    )?;
    tx.commit()
        .map_err(|err| format!("Failed to commit molecule save transaction: {err}"))?;

    Ok(molecule)
}

fn open_connection(app: &AppHandle) -> Result<Connection, String> {
    open_database(default_database_path(app)?)
        .map_err(|err| format!("Failed to open SQLite database: {err}"))
}

fn write_structure_file(
    workspace: &std::path::Path,
    relative: &str,
    content: &str,
    label: &str,
) -> Result<String, String> {
    if content.trim().is_empty() {
        return Ok(String::new());
    }
    // Resolved rather than joined, so a caller-supplied name can never write outside the
    // workspace or follow a symlink out of it.
    let absolute = crate::commands::attachments::resolve_in_workspace(workspace, relative)?;
    if let Some(parent) = absolute.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create structure directory: {err}"))?;
    }
    fs::write(&absolute, content.as_bytes())
        .map_err(|err| format!("Failed to write {label} structure file: {err}"))?;
    Ok(relative.to_string())
}

/// Describes what still points at a molecule, so a refused delete can say why.
fn molecule_references(connection: &Connection, id: &str) -> Result<Vec<String>, String> {
    let mut references = Vec::new();
    for (label, sql) in [
        (
            "additive records",
            "SELECT COUNT(*) FROM additives WHERE molecule_id = ?1",
        ),
        (
            "base oil records",
            "SELECT COUNT(*) FROM base_oils WHERE representative_molecule_id = ?1",
        ),
        (
            "formulation components",
            "SELECT COUNT(*) FROM formulation_components WHERE molecule_id = ?1",
        ),
    ] {
        let count: i64 = connection
            .query_row(sql, params![id], |row| row.get(0))
            .map_err(|err| format!("Failed to check {label} for molecule {id}: {err}"))?;
        if count > 0 {
            references.push(format!("{count} {label}"));
        }
    }
    Ok(references)
}

fn read_structure_file(workspace: &std::path::Path, relative: &str) -> String {
    if relative.trim().is_empty() {
        return String::new();
    }
    crate::commands::attachments::resolve_in_workspace(workspace, relative)
        .ok()
        .and_then(|absolute| fs::read_to_string(absolute).ok())
        .unwrap_or_default()
}

fn row_to_molecule(
    row: &rusqlite::Row<'_>,
    workspace: Option<&std::path::Path>,
) -> rusqlite::Result<MoleculeDto> {
    let tags_text: String = row.get::<_, Option<String>>(10)?.unwrap_or_default();
    let tags: Vec<String> = serde_json::from_str(&tags_text).unwrap_or_default();
    let molfile: String = row.get::<_, Option<String>>(11)?.unwrap_or_default();
    let duplicate_of: String = row.get::<_, Option<String>>(12)?.unwrap_or_default();
    let import_mode: String = row
        .get::<_, Option<String>>(13)?
        .unwrap_or_else(|| "manual_save".to_string());
    let source: String = row.get::<_, Option<String>>(14)?.unwrap_or_default();
    let structure_svg_path: String = row.get::<_, Option<String>>(15)?.unwrap_or_default();
    let mol_file_path: String = row.get::<_, Option<String>>(16)?.unwrap_or_default();
    let sdf_file_path: String = row.get::<_, Option<String>>(17)?.unwrap_or_default();
    let pdb_file_path: String = row.get::<_, Option<String>>(18)?.unwrap_or_default();
    let source_id: String = row.get::<_, Option<String>>(22)?.unwrap_or_default();
    let structure_svg = workspace
        .map(|path| read_structure_file(path, &structure_svg_path))
        .unwrap_or_default();
    let mol_block = workspace
        .map(|path| {
            if molfile.trim().is_empty() {
                read_structure_file(path, &mol_file_path)
            } else {
                molfile.clone()
            }
        })
        .unwrap_or_default();
    let sdf_block = workspace
        .map(|path| read_structure_file(path, &sdf_file_path))
        .unwrap_or_default();
    let pdb_block = workspace
        .map(|path| read_structure_file(path, &pdb_file_path))
        .unwrap_or_default();
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
        molfile,
        duplicate_of,
        import_mode,
        source: if source.is_empty() {
            source_id.clone()
        } else {
            source
        },
        structure_svg_path,
        structure_svg,
        mol_file_path,
        sdf_file_path,
        pdb_file_path,
        mol_block,
        sdf_block,
        pdb_block,
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

fn descriptor_mode(descriptor: &Value) -> String {
    descriptor
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("real")
        .to_string()
}

fn descriptor_status(descriptor: &Value) -> String {
    if descriptor_mode(descriptor) == "mock" {
        "mock".to_string()
    } else {
        "calculated".to_string()
    }
}

fn descriptor_count(descriptor: &Value) -> i64 {
    descriptor
        .get("descriptor_count")
        .and_then(Value::as_i64)
        .or_else(|| {
            descriptor
                .get("descriptors")
                .and_then(Value::as_object)
                .map(|obj| obj.len() as i64)
        })
        .unwrap_or_default()
}

fn insert_descriptor(
    tx: &rusqlite::Transaction<'_>,
    molecule_id: &str,
    descriptor_set: &str,
    descriptor: &Value,
    status: &str,
    mode: &str,
    calculated_at: &str,
) -> Result<(), String> {
    let descriptors_json = descriptor
        .get("descriptors")
        .cloned()
        .unwrap_or_else(|| json!({}));
    tx.execute(
        "INSERT INTO molecule_descriptors (
            id, molecule_id, descriptor_set, descriptor_version, descriptors_json, descriptor_count,
            status, mode, error_message, calculated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            Uuid::new_v4().to_string(),
            molecule_id,
            descriptor_set,
            descriptor
                .get("descriptor_version")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            serde_json::to_string(&descriptors_json).map_err(|err| format!(
                "Failed to serialize {descriptor_set} descriptors: {err}"
            ))?,
            descriptor_count(descriptor),
            status,
            mode,
            descriptor
                .get("error_message")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            calculated_at
        ],
    )
    .map_err(|err| format!("Failed to insert {descriptor_set} descriptor record: {err}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::schema::INIT_SCHEMA_SQL;
    use std::collections::HashSet;

    fn seed_molecules_in_one_second(connection: &Connection, count: usize) {
        for index in 0..count {
            // Distinct sub-second timestamps that all collapse to the same `datetime()` value,
            // exactly what a bulk import produces.
            let created_at = format!("2026-08-20T09:00:00.{:09}+00:00", index);
            connection
                .execute(
                    "INSERT INTO molecules (id, name, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?3)",
                    params![
                        format!("molecule-{index:03}"),
                        format!("Molecule {index}"),
                        created_at
                    ],
                )
                .expect("molecule should be inserted");
        }
    }

    fn page_ids(connection: &Connection, page_size: i64, offset: i64) -> Vec<String> {
        let mut statement = connection
            .prepare(&format!(
                "SELECT id FROM molecules {MOLECULE_LIST_ORDER} LIMIT ?1 OFFSET ?2"
            ))
            .expect("paged query should prepare");
        statement
            .query_map(params![page_size, offset], |row| row.get::<_, String>(0))
            .expect("paged query should run")
            .collect::<Result<Vec<_>, _>>()
            .expect("paged rows should read")
    }

    #[test]
    fn pagination_never_repeats_or_drops_rows_created_in_the_same_second() {
        let connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        connection
            .execute_batch(INIT_SCHEMA_SQL)
            .expect("schema should initialize");
        seed_molecules_in_one_second(&connection, 25);

        let mut seen = Vec::new();
        for page in 0..5 {
            seen.extend(page_ids(&connection, 5, page * 5));
        }

        assert_eq!(seen.len(), 25);
        assert_eq!(seen.iter().collect::<HashSet<_>>().len(), 25);
    }

    #[test]
    fn molecule_list_order_is_stable_across_identical_queries() {
        let connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        connection
            .execute_batch(INIT_SCHEMA_SQL)
            .expect("schema should initialize");
        seed_molecules_in_one_second(&connection, 10);

        let first = page_ids(&connection, 10, 0);
        let second = page_ids(&connection, 10, 0);

        assert_eq!(first, second);
        assert_eq!(first.first().map(String::as_str), Some("molecule-009"));
        assert_eq!(first.last().map(String::as_str), Some("molecule-000"));
    }

    fn seed_formulas(connection: &Connection, formulas: &[(&str, &str)]) {
        for (index, (id, formula)) in formulas.iter().enumerate() {
            connection
                .execute(
                    "INSERT INTO molecules (id, name, formula, created_at, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?4)",
                    params![
                        id,
                        id,
                        formula,
                        format!("2026-08-20T09:00:00.{index:09}+00:00")
                    ],
                )
                .expect("molecule should be inserted");
        }
    }

    fn element_matches(connection: &Connection, element: &str) -> Vec<String> {
        let mut statement = connection
            .prepare(
                "SELECT id FROM molecules
                 WHERE ?1 = ''
                    OR formula GLOB ('*' || ?1 || '[0-9A-Z]*')
                    OR substr(formula, -length(?1)) = ?1
                 ORDER BY id",
            )
            .expect("element query should prepare");
        statement
            .query_map(params![element], |row| row.get::<_, String>(0))
            .expect("element query should run")
            .collect::<Result<Vec<_>, _>>()
            .expect("rows should read")
    }

    #[test]
    fn element_filter_does_not_match_a_longer_symbol_with_the_same_first_letter() {
        let connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        connection
            .execute_batch(INIT_SCHEMA_SQL)
            .expect("schema should initialize");
        seed_formulas(
            &connection,
            &[
                ("brominated", "C20H42BrNO2"),
                ("silicone", "C10H22SiO"),
                ("sodium", "C8H18NaO"),
                ("borate", "BF3"),
                ("ends-with-boron", "C6H5B"),
                ("thiophosphate", "C6H15O3PS2"),
            ],
        );

        // Boron must not pick up bromine, sulfur must not pick up silicon, nitrogen must not
        // pick up sodium.
        assert_eq!(
            element_matches(&connection, "B"),
            vec!["borate".to_string(), "ends-with-boron".to_string()]
        );
        assert_eq!(
            element_matches(&connection, "S"),
            vec!["thiophosphate".to_string()]
        );
        assert_eq!(
            element_matches(&connection, "N"),
            vec!["brominated".to_string()]
        );
        assert_eq!(
            element_matches(&connection, "P"),
            vec!["thiophosphate".to_string()]
        );
    }

    #[test]
    fn molecule_references_names_every_record_still_pointing_at_the_molecule() {
        let connection = Connection::open_in_memory().expect("in-memory sqlite should open");
        connection
            .execute_batch(INIT_SCHEMA_SQL)
            .expect("schema should initialize");
        seed_formulas(&connection, &[("mol-1", "C2H6O"), ("mol-2", "CH4")]);
        connection
            .execute(
                "INSERT INTO additives (id, molecule_id, created_at, updated_at)
                 VALUES ('add-1', 'mol-1', '2026-01-01', '2026-01-01')",
                [],
            )
            .expect("additive should be inserted");

        assert_eq!(
            molecule_references(&connection, "mol-1").expect("reference check should work"),
            vec!["1 additive records".to_string()]
        );
        assert!(molecule_references(&connection, "mol-2")
            .expect("reference check should work")
            .is_empty());
    }
}
