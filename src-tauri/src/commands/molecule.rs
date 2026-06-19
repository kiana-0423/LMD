use crate::app_paths::{default_database_path, default_workspace_dir};
use crate::commands::ok;
use crate::commands::sidecar::run_sidecar_command;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use tauri::AppHandle;
use uuid::Uuid;

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
    pub allow_mock: Option<bool>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckMoleculeDuplicatePayload {
    pub canonical_smiles: String,
    pub inchikey: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMoleculePayload {
    pub name: Option<String>,
    pub aliases: Option<String>,
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
    pub notes: Option<String>,
    pub data_source: Option<String>,
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
}

#[tauri::command]
pub fn create_molecule(
    app: AppHandle,
    payload: SaveMoleculePayload,
) -> Result<MoleculeDto, String> {
    if payload.smiles.trim().is_empty() {
        return Err("SMILES is required.".to_string());
    }

    let standardized =
        run_sidecar_command("standardize", json!({ "smiles": payload.smiles.trim() }))?;
    let std_data = data(&standardized)?;
    let molecule_id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let tags = payload.additive_function_tags.unwrap_or_default();
    let tags_json = serde_json::to_string(&tags)
        .map_err(|err| format!("Failed to serialize molecule tags: {err}"))?;
    let name = if payload.name.trim().is_empty() {
        std_data
            .get("smiles_canonical")
            .and_then(Value::as_str)
            .unwrap_or(payload.smiles.trim())
            .to_string()
    } else {
        payload.name.trim().to_string()
    };
    let data_source = payload.data_source.unwrap_or_default();

    let conn = open_connection(&app)?;
    conn.execute(
        "INSERT INTO molecules (
            id, name, aliases, smiles_raw, smiles_canonical, inchi, inchi_key, formula, molecular_weight,
            category, tags, molfile, descriptor_json, duplicate_of, import_mode, source,
            structure_svg_path, mol_file_path, sdf_file_path, pdb_file_path,
            rdkit_descriptor_status, mordred_descriptor_status, descriptor_ready, source_id, notes,
            created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, '', '{}', '', 'manual_save', ?12,
                   '', '', '', '', 'pending', 'pending', 0, ?12, ?13, ?14, ?14)",
        params![
            &molecule_id,
            &name,
            payload.aliases.unwrap_or_default(),
            payload.smiles.trim(),
            std_data
                .get("smiles_canonical")
                .and_then(Value::as_str)
                .unwrap_or(payload.smiles.trim()),
            std_data.get("inchi").and_then(Value::as_str).unwrap_or_default(),
            std_data
                .get("inchi_key")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            std_data
                .get("formula")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            std_data
                .get("molecular_weight")
                .and_then(Value::as_f64)
                .unwrap_or_default(),
            payload.category.unwrap_or_else(|| "candidate".to_string()),
            tags_json,
            data_source,
            payload.notes.unwrap_or_default(),
            &now
        ],
    )
    .map_err(|err| format!("Failed to create molecule: {err}"))?;

    get_molecule(app, molecule_id)?
        .ok_or_else(|| "Created molecule could not be loaded.".to_string())
}

#[tauri::command]
pub fn list_molecules(app: AppHandle, filter: Option<Value>) -> Result<Vec<MoleculeDto>, String> {
    let conn = open_connection(&app)?;
    let mut statement = conn
        .prepare(
            "SELECT id, name, aliases, smiles_raw, smiles_canonical, inchi, inchi_key, formula,
                    molecular_weight, category, tags, molfile, duplicate_of, import_mode, source,
                    structure_svg_path, mol_file_path, sdf_file_path, pdb_file_path,
                    rdkit_descriptor_status, mordred_descriptor_status, descriptor_ready, source_id, notes,
                    created_at, updated_at
             FROM molecules
             ORDER BY datetime(created_at) DESC",
        )
        .map_err(|err| format!("Failed to prepare molecule list query: {err}"))?;
    let workspace = default_workspace_dir(&app)?;
    let rows = statement
        .query_map([], |row| row_to_molecule(row, &workspace))
        .map_err(|err| format!("Failed to query molecules: {err}"))?;
    let mut molecules = Vec::new();
    for row in rows {
        molecules.push(row.map_err(|err| format!("Failed to read molecule row: {err}"))?);
    }
    if molecules.is_empty() && filter.is_none() {
        return Ok(Vec::new());
    }
    Ok(molecules)
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
        |row| row_to_molecule(row, &workspace),
    )
    .optional()
    .map_err(|err| format!("Failed to get molecule: {err}"))
}

#[tauri::command]
pub fn update_molecule(
    app: AppHandle,
    id: String,
    payload: UpdateMoleculePayload,
) -> Result<MoleculeDto, String> {
    let existing = get_molecule(app.clone(), id.clone())?
        .ok_or_else(|| format!("Molecule not found: {id}"))?;
    let now = Utc::now().to_rfc3339();
    let tags = payload.tags.unwrap_or(existing.tags);
    let tags_json = serde_json::to_string(&tags)
        .map_err(|err| format!("Failed to serialize molecule tags: {err}"))?;
    let data_source = payload.data_source.unwrap_or(existing.data_source);
    let conn = open_connection(&app)?;
    let updated = conn
        .execute(
            "UPDATE molecules
             SET name = ?1,
                 aliases = ?2,
                 category = ?3,
                 tags = ?4,
                 source = ?5,
                 source_id = ?5,
                 notes = ?6,
                 updated_at = ?7
             WHERE id = ?8",
            params![
                payload.name.unwrap_or(existing.name),
                payload.aliases.unwrap_or(existing.aliases),
                payload.category.unwrap_or(existing.category),
                tags_json,
                data_source,
                payload.notes.unwrap_or(existing.notes),
                &now,
                &id
            ],
        )
        .map_err(|err| format!("Failed to update molecule: {err}"))?;
    if updated == 0 {
        return Err(format!("Molecule not found: {id}"));
    }
    get_molecule(app, id)?.ok_or_else(|| "Updated molecule could not be loaded.".to_string())
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

    let tx = conn
        .transaction()
        .map_err(|err| format!("Failed to start molecule delete transaction: {err}"))?;
    let deleted_descriptors = tx
        .execute(
            "DELETE FROM molecule_descriptors WHERE molecule_id = ?1",
            params![&id],
        )
        .map_err(|err| format!("Failed to delete molecule descriptors: {err}"))?;
    let deleted_molecules = tx
        .execute("DELETE FROM molecules WHERE id = ?1", params![&id])
        .map_err(|err| format!("Failed to delete molecule: {err}"))?;
    tx.commit()
        .map_err(|err| format!("Failed to commit molecule delete transaction: {err}"))?;

    if deleted_molecules > 0 {
        if let Some(paths) = file_paths {
            for relative in paths {
                if !relative.trim().is_empty() {
                    let _ = fs::remove_file(workspace.join(relative));
                }
            }
        }
    }

    Ok(json!({
        "success": deleted_molecules > 0,
        "deleted": deleted_molecules > 0,
        "id": id,
        "deleted_descriptors": deleted_descriptors
    }))
}

#[tauri::command]
pub fn check_duplicate_molecule(
    app: AppHandle,
    payload: CheckMoleculeDuplicatePayload,
) -> Result<Value, String> {
    let conn = open_connection(&app)?;
    let canonical = payload.canonical_smiles.trim().to_string();
    let inchikey = payload.inchikey.unwrap_or_default();
    let existing = conn
        .query_row(
            "SELECT id, smiles_canonical, inchi_key FROM molecules
             WHERE (?1 <> '' AND smiles_canonical = ?1) OR (?2 <> '' AND inchi_key = ?2)
             ORDER BY datetime(created_at) ASC
             LIMIT 1",
            params![canonical, inchikey],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                ))
            },
        )
        .optional()
        .map_err(|err| format!("Failed to check duplicate molecule: {err}"))?;
    let Some((id, matched_smiles, matched_inchikey)) = existing else {
        return ok("check_duplicate_molecule", json!({ "duplicate": false }));
    };
    let matched_by = match (
        matched_smiles == payload.canonical_smiles,
        !inchikey.is_empty() && matched_inchikey == inchikey,
    ) {
        (true, true) => "both",
        (true, false) => "canonical_smiles",
        (false, true) => "inchikey",
        _ => "canonical_smiles",
    };
    ok(
        "check_duplicate_molecule",
        json!({ "duplicate": true, "molecule_id": id, "existing_molecule_id": id, "matched_by": matched_by }),
    )
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
             ORDER BY datetime(created_at) ASC
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
        matched_smiles == payload.canonical_smiles,
        !inchikey.is_empty() && matched_inchikey == inchikey,
    ) {
        (true, true) => "both",
        (true, false) => "canonical_smiles",
        (false, true) => "inchikey",
        _ => "canonical_smiles",
    };
    Ok(json!({
        "duplicate": true,
        "existing_molecule_id": id,
        "matched_by": matched_by
    }))
}

#[tauri::command]
pub fn import_new_molecule(
    app: AppHandle,
    payload: ImportNewMoleculePayload,
) -> Result<Value, String> {
    let input_smiles = payload.canonical_smiles.trim().to_string();
    if input_smiles.is_empty() {
        return Ok(
            json!({ "success": false, "error": "SMILES is required. Please generate a valid canonical SMILES first." }),
        );
    }
    let standardized = run_sidecar_command("standardize", json!({ "smiles": &input_smiles }))?;
    let visualized = run_sidecar_command("visualize", json!({ "smiles": &input_smiles }))?;
    let molfile_result =
        run_sidecar_command("smiles-to-molfile", json!({ "smiles": &input_smiles }))?;
    let generated_3d = run_sidecar_command(
        "generate-3d",
        json!({ "smiles": &input_smiles, "add_hydrogens": true, "optimize": true, "force_field": "MMFF" }),
    )?;
    let std_data = data(&standardized)?;
    let vis_data = data(&visualized)?;
    let molfile_data = data(&molfile_result)?;
    let generated_3d_data = data(&generated_3d)?;
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
    let descriptor_ready = matches!(rdkit_status.as_str(), "calculated" | "mock")
        && matches!(mordred_status.as_str(), "calculated" | "mock");
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
         ) VALUES (?1, ?2, '', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?15, '', ?23, ?23)",
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
            &now
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
pub fn save_molecule_with_required_descriptors(
    app: AppHandle,
    payload: SaveMoleculePayload,
) -> Result<MoleculeDto, String> {
    if payload.smiles.trim().is_empty() {
        return Err("SMILES is required.".to_string());
    }
    let allow_mock = payload.allow_mock.unwrap_or(false);
    let smiles = payload.smiles.trim().to_string();

    let standardized = run_sidecar_command("standardize", json!({ "smiles": &smiles }))?;
    let visualized = run_sidecar_command("visualize", json!({ "smiles": &smiles }))?;
    let molfile_result = run_sidecar_command("smiles-to-molfile", json!({ "smiles": &smiles }))?;
    let generated_3d = run_sidecar_command(
        "generate-3d",
        json!({ "smiles": &smiles, "add_hydrogens": true, "optimize": true, "force_field": "MMFF" }),
    )?;
    let required = run_sidecar_command(
        "calculate-required-descriptors",
        json!({
            "smiles": &smiles,
            "require_rdkit": true,
            "require_mordred": true,
            "allow_mock": allow_mock
        }),
    )
    .map_err(|err| {
        if err.contains("Mordred descriptors are required") || err.contains("Mordred is not installed") {
            "Mordred descriptors are required. Please install Mordred or check the Python sidecar environment.".to_string()
        } else {
            err
        }
    })?;

    let std_data = data(&standardized)?;
    let vis_data = data(&visualized)?;
    let molfile_data = data(&molfile_result)?;
    let generated_3d_data = data(&generated_3d)?;
    let req_data = data(&required)?;
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
    let descriptor_ready = matches!(rdkit_status.as_str(), "calculated" | "mock")
        && matches!(mordred_status.as_str(), "calculated" | "mock");

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
        additive_function_tags: payload.additive_function_tags.unwrap_or_default(),
        tags: Vec::new(),
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
    tx.execute(
        "INSERT INTO molecules (
            id, name, aliases, smiles_raw, smiles_canonical, inchi, inchi_key, formula, molecular_weight,
            category, molfile, structure_svg_path, mol_file_path, sdf_file_path, pdb_file_path,
            rdkit_descriptor_status, mordred_descriptor_status, descriptor_ready, source_id, notes,
            created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
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
            &molecule.molfile,
            &molecule.structure_svg_path,
            &molecule.mol_file_path,
            &molecule.sdf_file_path,
            &molecule.pdb_file_path,
            &molecule.rdkit_descriptor_status,
            &molecule.mordred_descriptor_status,
            if molecule.descriptor_ready { 1 } else { 0 },
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
    Connection::open(default_database_path(app)?)
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
    let absolute = workspace.join(relative);
    if let Some(parent) = absolute.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Failed to create structure directory: {err}"))?;
    }
    fs::write(&absolute, content.as_bytes())
        .map_err(|err| format!("Failed to write {label} structure file: {err}"))?;
    Ok(relative.to_string())
}

fn read_structure_file(workspace: &std::path::Path, relative: &str) -> String {
    if relative.trim().is_empty() {
        return String::new();
    }
    fs::read_to_string(workspace.join(relative)).unwrap_or_default()
}

fn row_to_molecule(
    row: &rusqlite::Row<'_>,
    workspace: &std::path::Path,
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
    let structure_svg = read_structure_file(workspace, &structure_svg_path);
    let mol_block = if molfile.trim().is_empty() {
        read_structure_file(workspace, &mol_file_path)
    } else {
        molfile.clone()
    };
    let sdf_block = read_structure_file(workspace, &sdf_file_path);
    let pdb_block = read_structure_file(workspace, &pdb_file_path);
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

fn data(value: &Value) -> Result<&Value, String> {
    value
        .get("data")
        .ok_or_else(|| "Python sidecar response did not include data.".to_string())
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
