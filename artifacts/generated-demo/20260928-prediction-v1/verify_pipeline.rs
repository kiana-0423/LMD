// One-off read-only verification using the application's real feature builders.
use lubricant_materials_database::commands::{features::*, model::*};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::{collections::BTreeMap, env, fs, path::PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args().collect();
    let connection = Connection::open_with_flags(&args[1], OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let out = PathBuf::from(&args[2]);
    fs::create_dir_all(&out)?;
    let molecule_targets = ["extreme_pressure_value", "pb_value", "pd_value", "initial_oxidation_temperature_value", "initial_decomposition_temperature_value"];
    let formulation_targets = ["average_friction_coefficient", "stable_friction_coefficient", "wear_scar_diameter_value", "wear_scar_width_value", "viscosity_40c", "viscosity_100c"];
    let mut checks = vec![];
    for (targets, mode, count) in [(&molecule_targets[..], "additive_component", 84), (&formulation_targets[..], "formulation_aggregate", 126)] {
        for target in targets {
            let scope = DatasetScope { single_additive_only: mode == "additive_component", ..Default::default() };
            let summary = dataset_summary_scoped(&connection, target, "rdkit", mode, &scope)?;
            assert_eq!(summary["rowCount"], count);
            assert_eq!(summary["moleculeCount"], 21);
            checks.push(json!({"target":target,"mode":mode,"rows":count,"molecules":21,"report":summary["report"]}));
        }
    }

    let mut statement = connection.prepare("SELECT id,name,smiles_canonical FROM molecules ORDER BY id")?;
    let mut components = BTreeMap::new();
    for row in statement.query_map([], |r| Ok((r.get::<_, String>(0)?,r.get::<_, String>(1)?,r.get::<_, String>(2)?)))? {
        let (id,name,smiles) = row?;
        let mut item = ComponentInput { molecule_id:id.clone(), molecule_name:name, smiles, ..Default::default() };
        let mut descriptor_query = connection.prepare("SELECT descriptor_set,descriptors_json FROM molecule_descriptors WHERE molecule_id=?1 AND status='calculated' AND mode='real'")?;
        for descriptor in descriptor_query.query_map([&id], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?)))? {
            let (set,content)=descriptor?;
            item.descriptors.extend(numeric_descriptors(&content,&set));
        }
        components.insert(id,item);
    }
    for (target, mode) in [("extreme_pressure_value","additive_component"), ("average_friction_coefficient","formulation_aggregate")] {
        let scope = DatasetScope { single_additive_only:mode == "additive_component", ..Default::default() };
        let summary = dataset_summary_scoped(&connection,target,"",mode,&scope)?;
        let feature_order: Vec<String> = serde_json::from_value(summary["featureOrder"].clone())?;
        let sql = format!("SELECT f.id,f.name,r.id,r.{target} FROM formulations f JOIN experiments e ON e.formulation_id=f.id JOIN performance_results r ON r.experiment_id=e.id WHERE r.{target} IS NOT NULL ORDER BY f.id");
        let mut query = connection.prepare(&sql)?;
        let mut rows = vec![];
        let mut ready_ids = vec![];
        let mut unavailable = vec![];
        let mut checked_agreement = false;
        for row in query.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,f64>(3)?)))? {
            let (fid,name,rid,value)=row?;
            let mut selected=vec![];
            let mut cq=connection.prepare("SELECT c.id,a.molecule_id,c.concentration_value,c.concentration_unit FROM formulation_components c JOIN additives a ON a.id=c.additive_id WHERE c.formulation_id=?1 ORDER BY c.id")?;
            for component in cq.query_map([&fid], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,f64>(2)?,r.get::<_,String>(3)?)))? {
                let (id,mid,concentration,unit)=component?;
                let mut item=components[&mid].clone();
                item.component_id=id;
                item.concentration=Some(concentration);
                item.concentration_unit=unit;
                selected.push(item);
            }
            let mut bq=connection.prepare("SELECT b.id,b.name,b.viscosity_40c,b.viscosity_100c,b.viscosity_index,b.density,b.pour_point,b.flash_point,c.concentration_value,c.concentration_unit FROM formulation_components c JOIN base_oils b ON b.id=c.base_oil_id WHERE c.formulation_id=?1 ORDER BY c.id")?;
            let oils=bq.query_map([&fid], |r| Ok(BaseOilInput{id:r.get(0)?,name:r.get(1)?,properties:[r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?,r.get(7)?],concentration:r.get(8)?,concentration_unit:r.get(9)?}))?.collect::<Result<Vec<_>,_>>()?;
            let features = if mode=="additive_component" {
                if selected.len()!=1 {continue}
                let item=&selected[0];
                let training=additive_component_features(item,item.concentration);
                match molecule_prediction_row(&connection,&item.molecule_id,item.concentration,"wt%",ConcentrationBasis::MassPercent,&feature_order)? {
                    MoleculeRow::Ready {features,..}=> {
                        assert_eq!(features,order_features(&training,&feature_order).0);
                        ready_ids.push(rid.clone());
                    },
                    MoleculeRow::Skipped {label,missing,..}=>unavailable.push(json!({"row":rid,"molecule":label,"missing":missing})),
                }
                training
            } else {
                let (features,basis)=aggregate_features(&selected,&oils).map_err(|e|format!("{e:?}"))?;
                assert_eq!(basis,ConcentrationBasis::MassPercent);
                let (ordered,missing)=order_features(&features,&feature_order);
                if missing.is_empty() {ready_ids.push(rid.clone());}
                else {unavailable.push(json!({"row":rid,"formulation":fid,"missing":missing}));}
                ordered
            };
            if mode=="formulation_aggregate" && !checked_agreement && ready_ids.contains(&rid) {
                let agreement=aggregate_feature_agreement(&connection,target,&fid)?;
                assert!(agreement.missing.is_empty());
                let (expected,_)=order_features(&agreement.training_features,&feature_order);
                assert_eq!(features,expected);
                assert_eq!(features,agreement.prediction_features);
                checked_agreement=true;
            }
            rows.push(json!({"id":rid,"label":name,"group_id":fid,"features":features,"target":value,
                "molecule_id":if selected.len()==1 {selected[0].molecule_id.clone()} else {String::new()},
                "molecule_ids":selected.iter().map(|c|&c.molecule_id).collect::<Vec<_>>(),
                "smiles":if selected.len()==1 {selected[0].smiles.clone()} else {String::new()}}));
        }
        assert_eq!(rows.len() as u64,summary["rowCount"].as_u64().unwrap());
        assert!(!ready_ids.is_empty(), "At least one complete prediction candidate is required.");
        let dataset:Value=json!({"data_origin":"synthetic","is_real":false,"batch_id":"SYNTH-DEMO-20260928-01",
            "target":target,"dataset_mode":mode,"feature_order":feature_order,"feature_schema_version":FEATURE_SCHEMA_VERSION,
            "concentration_basis":"wt%","dataset_scope":scope,"prediction_ready_ids":ready_ids,"rows":rows});
        fs::write(out.join(format!("{mode}.json")),serde_json::to_vec(&dataset)?)?;
        checks.push(json!({"pipeline_export":mode,"rows":rows.len(),"features":feature_order.len(),"training_prediction_features_agree":true,
            "prediction_ready_count":ready_ids.len(),"existing_missing_values":unavailable}));
    }
    fs::write(out.join("dataset-check.json"),serde_json::to_vec_pretty(&checks)?)?;
    println!("{}",serde_json::to_string(&checks)?);
    Ok(())
}
