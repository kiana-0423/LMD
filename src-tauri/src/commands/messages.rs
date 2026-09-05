//! Interface text the backend produces, expressed so the frontend can translate it.
//!
//! [`crate::commands::errors`] solves half of this problem: an error string carries a code the
//! frontend can recognise. That works for a sentence with no moving parts, but most of what the
//! backend has to say does have them — *"14 record(s) were excluded because they record a
//! concentration with no unit"* is a count and a basis, not a sentence.
//!
//! A [`Message`] is that sentence taken apart:
//!
//!  * **`code`** — which sentence this is. The frontend holds the wording, in every language.
//!  * **`params`** — the values that go into it. Counts, names, units, bases.
//!  * **`detail`** — optional, and never translated. A SQLite error, a file path, a unit the user
//!    typed. It is the part that makes a message actionable, so it travels verbatim.
//!
//! A frontend that does not know a code still has something to show: the code names the situation
//! and the detail carries the specifics. Nothing is lost by adding a message before its
//! translation exists — only by rendering English prose that can never become anything else.

use serde_json::{json, Map, Value};

/// One thing the backend has to say, in a form that can be said in any language.
#[derive(Debug, Clone, PartialEq)]
pub struct Message {
    code: &'static str,
    params: Map<String, Value>,
    detail: Option<String>,
}

impl Message {
    pub fn new(code: &'static str) -> Self {
        Self {
            code,
            params: Map::new(),
            detail: None,
        }
    }

    /// Adds one value the sentence needs. Chainable.
    pub fn with(mut self, key: &str, value: impl Into<Value>) -> Self {
        self.params.insert(key.to_string(), value.into());
        self
    }

    /// Attaches diagnostic text that must not be translated.
    pub fn detail(mut self, detail: impl Into<String>) -> Self {
        self.detail = Some(detail.into());
        self
    }

    pub fn code(&self) -> &'static str {
        self.code
    }

    /// The untranslated diagnostic, if this message carries one.
    ///
    /// Used where a message has to collapse back into a plain string — the text of a
    /// `Result::Err`, which Tauri delivers as one — so the specifics survive even there.
    pub fn detail_text(&self) -> &str {
        self.detail.as_deref().unwrap_or_default()
    }

    pub fn to_json(&self) -> Value {
        let mut object = Map::new();
        object.insert("code".to_string(), json!(self.code));
        object.insert("params".to_string(), Value::Object(self.params.clone()));
        if let Some(detail) = &self.detail {
            object.insert("detail".to_string(), json!(detail));
        }
        Value::Object(object)
    }
}

impl From<Message> for Value {
    fn from(message: Message) -> Self {
        message.to_json()
    }
}

/// Turns a list of messages into the JSON array a response carries.
pub fn to_json_array(messages: &[Message]) -> Value {
    Value::Array(messages.iter().map(Message::to_json).collect())
}

/// Every message's untranslated detail, joined — for the one place a `String` is all there is.
pub fn details(messages: &[Message]) -> String {
    messages
        .iter()
        .map(Message::detail_text)
        .filter(|detail| !detail.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

// --- Codes ------------------------------------------------------------------------------------
//
// Grouped by what produces them. Each one names a situation, never a wording, so a translation can
// be rephrased without a backend change.

/// Rows were dropped because the dataset settled on another concentration basis.
pub const DATASET_EXCLUDED_OTHER_BASIS: &str = "dataset.excludedOtherBasis";
/// Nothing in the dataset recorded a unit, so values are used as stored.
pub const DATASET_UNRECORDED_BASIS: &str = "dataset.unrecordedBasis";
/// No record in the dataset recorded a concentration at all.
pub const DATASET_NO_CONCENTRATIONS: &str = "dataset.noConcentrations";
/// A stored concentration basis is not one this build understands.
pub const DATASET_UNKNOWN_BASIS: &str = "dataset.unknownBasis";
/// One record could not contribute a row because of its concentrations.
pub const DATASET_UNUSABLE_RECORD: &str = "dataset.unusableRecord";
/// A temporary file could not be removed after a training run.
pub const DATASET_CLEANUP_FAILED: &str = "dataset.cleanupFailed";

/// What one row of an additive-component dataset means.
pub const DATASET_INTERPRETATION_ADDITIVE: &str = "dataset.interpretationAdditive";
/// What one row of a formulation-aggregate dataset means.
pub const DATASET_INTERPRETATION_AGGREGATE: &str = "dataset.interpretationAggregate";

/// Whole formulations were held out of the validation split.
pub const SPLIT_GROUPED: &str = "split.grouped";
/// Rows were held out individually, without grouping.
pub const SPLIT_UNGROUPED: &str = "split.ungrouped";
/// The dataset was too small to hold anything out; metrics are in-sample.
pub const SPLIT_NONE: &str = "split.none";
/// A split was made but could not be scored, so in-sample metrics were reported.
pub const SPLIT_NOT_SCOREABLE: &str = "split.notScoreable";
/// A split method string this build does not recognise.
pub const SPLIT_UNKNOWN: &str = "split.unknown";
/// Linked molecules and formulations were held out together, so no molecule straddled the split.
pub const SPLIT_GROUPED_LINKED: &str = "split.groupedLinked";

/// Features were dropped because no record carried a value for them.
pub const TRAINING_DROPPED_FEATURES: &str = "training.droppedFeatures";
/// The dataset carried no group ids, so the validation score is optimistic.
pub const TRAINING_UNGROUPED_SPLIT: &str = "training.ungroupedSplit";
/// Too few records to hold out a validation split.
pub const TRAINING_SMALL_SAMPLE: &str = "training.smallSample";
/// A validation split was made but could not be scored.
pub const TRAINING_NOT_SCOREABLE: &str = "training.notScoreable";
/// Too few independent molecule/formulation groups to hold any out.
pub const TRAINING_TOO_FEW_GROUPS: &str = "training.tooFewGroups";
/// Rows were grouped by formulation only, so a molecule could straddle the split.
pub const TRAINING_FORMULATION_GROUPS_ONLY: &str = "training.formulationGroupsOnly";

/// A molecule has no calculated descriptors.
pub const SKIPPED_NO_DESCRIPTORS: &str = "skipped.noDescriptors";
/// The model uses concentration as a feature and none was supplied.
pub const SKIPPED_NEEDS_CONCENTRATION: &str = "skipped.needsConcentration";
/// The record's concentrations cannot be used with this model.
pub const SKIPPED_CONCENTRATION: &str = "skipped.concentration";
/// The record is missing feature columns the model needs.
pub const SKIPPED_MISSING_FEATURES: &str = "skipped.missingFeatures";
/// The model uses test conditions as features and they were not supplied.
pub const SKIPPED_NEEDS_CONDITIONS: &str = "skipped.needsConditions";

// --- Molecular design assessment ---------------------------------------------------------------
//
// Each reason a candidate's prediction is exploratory or unavailable is a code, so the
// assessment panel can say it in the user's language and the stored assessment stays readable.

/// The candidate failed the template's structural rules.
pub const DESIGN_STRUCTURE_INVALID: &str = "design.structureInvalid";
/// No usable model exists for the requested target.
pub const DESIGN_NO_MODEL: &str = "design.noModel";
/// Real descriptors could not be calculated for the candidate.
pub const DESIGN_DESCRIPTORS_UNAVAILABLE: &str = "design.descriptorsUnavailable";
/// The requested concentration does not match the model's basis.
pub const DESIGN_CONCENTRATION_INCOMPATIBLE: &str = "design.concentrationIncompatible";
/// The model uses test conditions as features and the request omits them.
pub const DESIGN_CONDITIONS_REQUIRED: &str = "design.conditionsRequired";
/// The model was fitted on one test type and the request names another.
pub const DESIGN_TEST_TYPE_INCOMPATIBLE: &str = "design.testTypeIncompatible";
/// The model needs feature columns the candidate could not supply.
pub const DESIGN_FEATURES_MISSING: &str = "design.featuresMissing";
/// The model was trained before domain evidence was recorded.
pub const DESIGN_DOMAIN_NOT_RECORDED: &str = "design.domainNotRecorded";
/// One or more descriptors lie outside the training range.
pub const DESIGN_DESCRIPTORS_OUT_OF_RANGE: &str = "design.descriptorsOutOfRange";
/// The requested test type does not appear in the training records.
pub const DESIGN_TEST_TYPE_NOT_COVERED: &str = "design.testTypeNotCovered";
/// The requested base oil does not appear in the training records.
pub const DESIGN_BASE_OIL_NOT_COVERED: &str = "design.baseOilNotCovered";
/// The requested concentration lies outside the training range.
pub const DESIGN_CONCENTRATION_NOT_COVERED: &str = "design.concentrationNotCovered";
/// The requested temperature or load lies outside the training range.
pub const DESIGN_CONDITION_NOT_COVERED: &str = "design.conditionNotCovered";
/// The model recorded no held-out validation.
pub const DESIGN_NO_HELD_OUT_VALIDATION: &str = "design.noHeldOutValidation";
/// The model's validation held out formulations, not molecules.
pub const DESIGN_VALIDATION_NOT_MOLECULE_GROUPED: &str = "design.validationNotMoleculeGrouped";
/// The model's validation held out rows without any grouping.
pub const DESIGN_VALIDATION_UNGROUPED: &str = "design.validationUngrouped";
/// The model was fitted on mixtures with several additives.
pub const DESIGN_MULTI_ADDITIVE_TRAINING: &str = "design.multiAdditiveTraining";
/// A requested condition is not used by the model and is recorded as context only.
pub const DESIGN_CONDITION_NOT_MODELLED: &str = "design.conditionNotModelled";
/// The candidate is itself one of the training molecules.
pub const DESIGN_IDENTICAL_TRAINING_MOLECULE: &str = "design.identicalTrainingMolecule";

/// An analysis has fewer qualifying records than it needs.
pub const ANALYSIS_NOT_ENOUGH_DATA: &str = "analysis.notEnoughData";
/// Values are binned into equal-width intervals over the observed range.
pub const ANALYSIS_METHOD_HISTOGRAM: &str = "analysis.methodHistogram";
/// Each group is summarised independently.
pub const ANALYSIS_METHOD_GROUPED: &str = "analysis.methodGrouped";
/// Concentration is paired with the measured value for each record.
pub const ANALYSIS_METHOD_PAIRED: &str = "analysis.methodPaired";
/// Pearson and Spearman coefficients across descriptors.
pub const ANALYSIS_METHOD_CORRELATION: &str = "analysis.methodCorrelation";
/// Rows without a numeric value are excluded.
pub const ANALYSIS_MISSING_EXCLUDED: &str = "analysis.missingExcluded";
/// Rows missing either side of the pair are excluded.
pub const ANALYSIS_MISSING_PAIR_EXCLUDED: &str = "analysis.missingPairExcluded";
/// Concentrations in the compared records use more than one unit.
pub const ANALYSIS_MIXED_UNITS: &str = "analysis.mixedUnits";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_message_carries_its_code_and_parameters() {
        let message = Message::new(DATASET_EXCLUDED_OTHER_BASIS)
            .with("count", 4)
            .with("basis", "unrecorded");

        assert_eq!(
            message.to_json(),
            json!({
                "code": "dataset.excludedOtherBasis",
                "params": { "count": 4, "basis": "unrecorded" }
            })
        );
    }

    #[test]
    fn detail_is_present_only_when_there_is_one() {
        let plain = Message::new(DATASET_NO_CONCENTRATIONS);
        assert!(plain.to_json().get("detail").is_none());

        let detailed = Message::new(DATASET_UNUSABLE_RECORD).detail("disk is full");
        assert_eq!(
            detailed.to_json().get("detail").and_then(Value::as_str),
            Some("disk is full")
        );
    }

    #[test]
    fn details_collapse_to_the_untranslated_diagnostics() {
        let messages = [
            Message::new(DATASET_NO_CONCENTRATIONS),
            Message::new(DATASET_UNUSABLE_RECORD).detail("Formulation f-1 mixes units."),
            Message::new(DATASET_CLEANUP_FAILED).detail("Permission denied."),
        ];

        // The message with no detail contributes nothing rather than an empty gap.
        assert_eq!(
            details(&messages),
            "Formulation f-1 mixes units. Permission denied."
        );
    }

    #[test]
    fn every_code_is_a_dotted_identifier() {
        for code in [
            DATASET_EXCLUDED_OTHER_BASIS,
            DATASET_UNRECORDED_BASIS,
            DATASET_NO_CONCENTRATIONS,
            DATASET_UNKNOWN_BASIS,
            DATASET_UNUSABLE_RECORD,
            DATASET_CLEANUP_FAILED,
            DATASET_INTERPRETATION_ADDITIVE,
            DATASET_INTERPRETATION_AGGREGATE,
            SPLIT_GROUPED,
            SPLIT_UNGROUPED,
            SPLIT_NONE,
            SPLIT_NOT_SCOREABLE,
            SPLIT_UNKNOWN,
            TRAINING_DROPPED_FEATURES,
            TRAINING_UNGROUPED_SPLIT,
            TRAINING_SMALL_SAMPLE,
            TRAINING_NOT_SCOREABLE,
            SKIPPED_NO_DESCRIPTORS,
            SKIPPED_NEEDS_CONCENTRATION,
            SKIPPED_CONCENTRATION,
            SKIPPED_MISSING_FEATURES,
            SKIPPED_NEEDS_CONDITIONS,
            SPLIT_GROUPED_LINKED,
            TRAINING_TOO_FEW_GROUPS,
            TRAINING_FORMULATION_GROUPS_ONLY,
            DESIGN_STRUCTURE_INVALID,
            DESIGN_NO_MODEL,
            DESIGN_DESCRIPTORS_UNAVAILABLE,
            DESIGN_CONCENTRATION_INCOMPATIBLE,
            DESIGN_CONDITIONS_REQUIRED,
            DESIGN_TEST_TYPE_INCOMPATIBLE,
            DESIGN_FEATURES_MISSING,
            DESIGN_DOMAIN_NOT_RECORDED,
            DESIGN_DESCRIPTORS_OUT_OF_RANGE,
            DESIGN_TEST_TYPE_NOT_COVERED,
            DESIGN_BASE_OIL_NOT_COVERED,
            DESIGN_CONCENTRATION_NOT_COVERED,
            DESIGN_CONDITION_NOT_COVERED,
            DESIGN_NO_HELD_OUT_VALIDATION,
            DESIGN_VALIDATION_NOT_MOLECULE_GROUPED,
            DESIGN_VALIDATION_UNGROUPED,
            DESIGN_MULTI_ADDITIVE_TRAINING,
            DESIGN_CONDITION_NOT_MODELLED,
            DESIGN_IDENTICAL_TRAINING_MOLECULE,
            ANALYSIS_NOT_ENOUGH_DATA,
            ANALYSIS_METHOD_HISTOGRAM,
            ANALYSIS_METHOD_GROUPED,
            ANALYSIS_METHOD_PAIRED,
            ANALYSIS_METHOD_CORRELATION,
            ANALYSIS_MISSING_EXCLUDED,
            ANALYSIS_MISSING_PAIR_EXCLUDED,
            ANALYSIS_MIXED_UNITS,
        ] {
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
