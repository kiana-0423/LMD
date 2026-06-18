pub mod analysis;
pub mod base_additive;
pub mod descriptor;
pub mod experiment;
pub mod formulation;
pub mod molecule;
pub mod molecule_visualization;
pub mod sidecar;
pub mod workspace;

use serde_json::{json, Value};

fn ok(command: &str, data: Value) -> Result<Value, String> {
    Ok(json!({
        "ok": true,
        "command": command,
        "data": data,
        "warnings": ["MVP command skeleton: replace mock data with SQLite/sidecar logic in the next phase."]
    }))
}
