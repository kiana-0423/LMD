pub mod analysis;
pub mod attachments;
pub mod backup;
pub mod base_additive;
pub mod descriptor;
pub mod diagnostics;
pub mod errors;
pub mod experiment;
pub mod export;
pub mod features;
pub mod formulation;
pub mod jobs;
pub mod messages;
pub mod model;
pub mod molecule;
pub mod molecule_usage;
pub mod molecule_visualization;
pub mod pagination;
pub mod patch;
pub mod references;
pub mod sidecar;
pub mod statistics;
pub mod tempfile;
pub mod validation;
pub mod workspace;

use serde_json::{json, Value};

fn ok(command: &str, data: Value) -> Result<Value, String> {
    Ok(json!({
        "ok": true,
        "command": command,
        "data": data,
        "warnings": []
    }))
}
