//! Stable codes on the errors a user is shown.
//!
//! A Tauri command returns `Err(String)`, and that string ends up on screen. Written as English
//! prose it can only ever be English, so the interface would switch language everywhere except the
//! places where something went wrong — which is where a user most needs to understand.
//!
//! The compromise here is deliberate: the message keeps its English prose, because it carries the
//! detail (a unit, a file path, a SQLite message) that makes it actionable, and it is prefixed with
//! a stable code the frontend can translate. A frontend that knows the code renders its own
//! sentence and appends the detail; one that does not falls back to the prose, which is still
//! useful. Nothing is lost either way.
//!
//! Codes are dotted identifiers, deliberately short and stable — renaming one is a breaking change
//! for the translation catalogue, so they name the *situation*, not the wording.

use std::fmt::Display;

/// Wraps a message with its code: `[model.basisMismatch] The blend records …`.
pub fn coded(code: &str, detail: impl Display) -> String {
    format!("[{code}] {detail}")
}

/// The concentration basis of a record does not match the model's.
pub const MODEL_BASIS_MISMATCH: &str = "model.basisMismatch";
/// A model was fitted under a different definition of the feature columns.
pub const MODEL_STALE_SCHEMA: &str = "model.staleSchema";
/// A prediction was addressed to a model trained for the other dataset mode.
pub const MODEL_WRONG_MODE: &str = "model.wrongMode";
/// No model was named in a prediction request.
pub const MODEL_NOT_CHOSEN: &str = "model.notChosen";
/// The named model is not in the registry.
pub const MODEL_NOT_FOUND: &str = "model.notFound";
/// The registry row exists but the fitted file is gone.
pub const MODEL_FILE_MISSING: &str = "model.fileMissing";
/// The workspace does not hold enough records to fit anything.
pub const MODEL_NOT_ENOUGH_DATA: &str = "model.notEnoughData";
/// No selected record could be described by the model's columns.
pub const MODEL_NOTHING_TO_PREDICT: &str = "model.nothingToPredict";
/// A model records a concentration basis this build does not define.
pub const MODEL_UNKNOWN_BASIS: &str = "model.unknownBasis";
/// A concentration cannot be converted, is inconsistent, or is not physical.
pub const CONCENTRATION_UNUSABLE: &str = "concentration.unusable";
/// A path would address something outside the workspace.
pub const WORKSPACE_PATH_REFUSED: &str = "workspace.pathRefused";
/// A record named in a request is not in the database.
pub const RECORD_NOT_FOUND: &str = "record.notFound";
/// Exporting would overwrite an existing destination without explicit consent.
pub const FILE_ALREADY_EXISTS: &str = "file.alreadyExists";
/// The sidecar failed without a more specific structured code.
pub const SIDECAR_COMMAND_FAILED: &str = "sidecar.commandFailed";
/// The bundled local-computation process could not be located or started.
pub const SIDECAR_UNAVAILABLE: &str = "sidecar.unavailable";
/// A local-computation request exceeded its operation deadline.
pub const SIDECAR_TIMEOUT: &str = "sidecar.timeout";
/// The sidecar returned output that did not satisfy its JSON contract.
pub const SIDECAR_PROTOCOL_FAILED: &str = "sidecar.protocolFailed";

// --- Write-payload validation -----------------------------------------------------------------
//
// These fire before any statement runs. A payload that trips one of them leaves the database
// exactly as it was, which is the whole reason they exist: SQLite would have accepted every one
// of these values.

/// A required name arrived blank.
pub const VALIDATION_NAME_REQUIRED: &str = "validation.nameRequired";
/// A number was NaN or infinite.
pub const VALIDATION_NUMBER_NOT_FINITE: &str = "validation.numberNotFinite";
/// A component role is not one this build defines.
pub const VALIDATION_ROLE_UNSUPPORTED: &str = "validation.roleUnsupported";
/// A component referenced no entity, or more than one.
pub const VALIDATION_COMPONENT_REFERENCE: &str = "validation.componentReference";
/// A component references an entity that cannot fill its role.
pub const VALIDATION_ROLE_REFERENCE_MISMATCH: &str = "validation.roleReferenceMismatch";
/// A supplied concentration was zero or negative.
pub const VALIDATION_CONCENTRATION_NOT_POSITIVE: &str = "validation.concentrationNotPositive";
/// A unit is not one this build defines.
pub const VALIDATION_UNIT_UNSUPPORTED: &str = "validation.unitUnsupported";
/// A duration was negative.
pub const VALIDATION_TIME_NEGATIVE: &str = "validation.timeNegative";
/// A repeat count was fractional or below one.
pub const VALIDATION_REPEAT_COUNT_INVALID: &str = "validation.repeatCountInvalid";
/// A minimum exceeded its maximum.
pub const VALIDATION_RANGE_INVERTED: &str = "validation.rangeInverted";
/// The payload named no record to write.
pub const VALIDATION_PAYLOAD_EMPTY: &str = "validation.payloadEmpty";

// --- Referential safety ------------------------------------------------------------------------

/// A delete was refused because other records reference the row.
pub const DELETE_BLOCKED_BY_REFERENCES: &str = "delete.blockedByReferences";
/// A cascading delete was requested without the explicit acknowledgement it requires.
pub const DELETE_CASCADE_NOT_CONFIRMED: &str = "delete.cascadeNotConfirmed";

// --- Workspace and backup ----------------------------------------------------------------------

/// A backup could not be created, or failed its own integrity check.
pub const BACKUP_FAILED: &str = "backup.failed";
/// A restore candidate did not pass validation, so the live database was left untouched.
pub const RESTORE_REFUSED: &str = "restore.refused";
/// The database failed `PRAGMA integrity_check`.
pub const DATABASE_INTEGRITY_FAILED: &str = "database.integrityFailed";
/// A workspace directory could not be created, opened, or is not usable.
pub const WORKSPACE_UNUSABLE: &str = "workspace.unusable";
/// An import preview was confirmed against a file that changed underneath it.
pub const IMPORT_PREVIEW_STALE: &str = "import.previewStale";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_coded_message_keeps_its_detail() {
        let message = coded(MODEL_NOT_FOUND, "Model not found: m-7");

        // The code is machine-readable; the prose behind it is what makes the error actionable,
        // and it survives untouched.
        assert!(message.starts_with("[model.notFound] "));
        assert!(message.contains("m-7"));
    }

    #[test]
    fn every_code_is_a_dotted_identifier() {
        for code in [
            MODEL_BASIS_MISMATCH,
            MODEL_STALE_SCHEMA,
            MODEL_WRONG_MODE,
            MODEL_NOT_CHOSEN,
            MODEL_NOT_FOUND,
            MODEL_FILE_MISSING,
            MODEL_NOT_ENOUGH_DATA,
            MODEL_NOTHING_TO_PREDICT,
            MODEL_UNKNOWN_BASIS,
            CONCENTRATION_UNUSABLE,
            WORKSPACE_PATH_REFUSED,
            RECORD_NOT_FOUND,
            FILE_ALREADY_EXISTS,
            SIDECAR_COMMAND_FAILED,
            SIDECAR_UNAVAILABLE,
            SIDECAR_TIMEOUT,
            SIDECAR_PROTOCOL_FAILED,
            VALIDATION_NAME_REQUIRED,
            VALIDATION_NUMBER_NOT_FINITE,
            VALIDATION_ROLE_UNSUPPORTED,
            VALIDATION_COMPONENT_REFERENCE,
            VALIDATION_ROLE_REFERENCE_MISMATCH,
            VALIDATION_CONCENTRATION_NOT_POSITIVE,
            VALIDATION_UNIT_UNSUPPORTED,
            VALIDATION_TIME_NEGATIVE,
            VALIDATION_REPEAT_COUNT_INVALID,
            VALIDATION_RANGE_INVERTED,
            VALIDATION_PAYLOAD_EMPTY,
            DELETE_BLOCKED_BY_REFERENCES,
            DELETE_CASCADE_NOT_CONFIRMED,
            BACKUP_FAILED,
            RESTORE_REFUSED,
            DATABASE_INTEGRITY_FAILED,
            WORKSPACE_UNUSABLE,
            IMPORT_PREVIEW_STALE,
        ] {
            // A code with a space or a bracket could not be parsed back out of the message.
            assert!(
                code.chars()
                    .all(|character| character.is_ascii_alphanumeric() || character == '.'),
                "{code} is not a usable code"
            );
            assert!(
                code.contains('.'),
                "{code} should name a domain and a situation"
            );
        }
    }
}
