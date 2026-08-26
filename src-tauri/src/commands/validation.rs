//! Typed request payloads and the scientific rules a write has to satisfy.
//!
//! Every write command used to read a `serde_json::Value` field by field, defaulting whatever was
//! missing. That is convenient and quietly wrong: a blank form became `99 wt%` of base oil, a
//! nonsensical `-4 min` preparation time was stored verbatim, and a component could reference a
//! base oil while claiming the `additive` role. None of those are database errors, so SQLite
//! accepted all of them.
//!
//! The rules here run *before* any statement executes. A rejected payload leaves the database
//! exactly as it was, and the caller gets a stable code it can translate rather than a SQLite
//! constraint message.

use crate::commands::errors::{self, coded};
use serde::{Deserialize, Deserializer};
use serde_json::Value;

/// The component roles a formulation understands.
///
/// Kept as a list rather than an enum with `#[serde(other)]` so an unknown role is *reported*
/// rather than silently folded into a catch-all variant.
pub const COMPONENT_ROLES: &[&str] = &["base_oil", "additive", "solvent", "other"];

/// The concentration units a stored component may carry.
///
/// This is deliberately wider than the set a model can convert (see `concentrationPolicy.ts`):
/// recording a measurement in `mol%` is legitimate even though no model is fitted on it.
pub const CONCENTRATION_UNITS: &[&str] = &[
    "wt%",
    "mol%",
    "ppm",
    "mg/mL",
    "volume%",
    "mass fraction",
    "g/kg",
];

/// The units an additive's typical-concentration range may be recorded in.
pub const ADDITIVE_CONCENTRATION_UNITS: &[&str] = CONCENTRATION_UNITS;

/// A number that arrived as a JSON number or as the string an HTML input produces.
///
/// Ant Design's `InputNumber` yields a number, but a CSV import and a hand-written payload both
/// yield strings, and the previous readers accepted either. Rejecting one of them now would break
/// working callers, so both are accepted — and both are checked for finiteness.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LenientNumber(pub f64);

impl<'de> Deserialize<'de> for LenientNumber {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        match &value {
            Value::Number(number) => number
                .as_f64()
                .map(LenientNumber)
                .ok_or_else(|| serde::de::Error::custom("number is not representable as f64")),
            Value::String(text) => text
                .trim()
                .parse::<f64>()
                .map(LenientNumber)
                .map_err(|_| serde::de::Error::custom(format!("`{text}` is not a number"))),
            other => Err(serde::de::Error::custom(format!(
                "expected a number, found {other}"
            ))),
        }
    }
}

/// Deserializes `Option<f64>` leniently, treating an explicit `null` or `""` as absent.
///
/// Text that is present but not a number is an *error*, not an absence. The readers this replaced
/// used `.ok()` here, so `"n/a"` in a load column became a blank load and the row was stored as
/// though the operator had simply not filled it in.
pub fn optional_number<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<f64>, D::Error> {
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(match value {
        None | Some(Value::Null) => None,
        Some(Value::Number(number)) => number.as_f64(),
        Some(Value::String(text)) if text.trim().is_empty() => None,
        Some(Value::String(text)) => {
            Some(text.trim().parse::<f64>().map_err(|_| {
                serde::de::Error::custom(format!("`{}` is not a number", text.trim()))
            })?)
        }
        Some(other) => {
            return Err(serde::de::Error::custom(format!(
                "expected a number, found {other}"
            )))
        }
    })
}

/// Deserializes an integer leniently. A fractional value is kept as-is so the caller can reject it
/// with a domain message rather than a parse error.
pub fn optional_integer<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<f64>, D::Error> {
    optional_number(deserializer)
}

/// Deserializes `Option<String>`, collapsing whitespace-only text to `None`.
pub fn optional_text<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(match value {
        None | Some(Value::Null) => None,
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Some(Value::Number(number)) => Some(number.to_string()),
        Some(Value::Bool(flag)) => Some(flag.to_string()),
        Some(_) => None,
    })
}

// ---------------------------------------------------------------------------------------------
// Field rules
// ---------------------------------------------------------------------------------------------

/// A required name has to carry at least one non-blank character.
pub fn require_name(value: Option<&str>, field: &str) -> Result<String, String> {
    match value.map(str::trim) {
        Some(text) if !text.is_empty() => Ok(text.to_string()),
        _ => Err(coded(
            errors::VALIDATION_NAME_REQUIRED,
            format!("{field} is required and cannot be blank."),
        )),
    }
}

/// Every stored number has to be finite. NaN and the infinities survive JSON round-trips through
/// some clients, and once written they poison every average and every model that reads the column.
pub fn require_finite(value: Option<f64>, field: &str) -> Result<Option<f64>, String> {
    match value {
        Some(number) if !number.is_finite() => Err(coded(
            errors::VALIDATION_NUMBER_NOT_FINITE,
            format!("{field} must be a finite number."),
        )),
        other => Ok(other),
    }
}

/// A concentration that was supplied has to be strictly positive.
///
/// Zero is refused deliberately: a component present at zero concentration is not a component, and
/// storing it makes a blend look like it contains something it does not.
pub fn require_positive_concentration(
    value: Option<f64>,
    field: &str,
) -> Result<Option<f64>, String> {
    let value = require_finite(value, field)?;
    match value {
        Some(number) if number <= 0.0 => Err(coded(
            errors::VALIDATION_CONCENTRATION_NOT_POSITIVE,
            format!("{field} must be greater than zero; received {number}."),
        )),
        other => Ok(other),
    }
}

/// A duration cannot run backwards. Zero is allowed — "mixed and used immediately" is a real
/// preparation — but a negative value is not a measurement.
pub fn require_non_negative(value: Option<f64>, field: &str) -> Result<Option<f64>, String> {
    let value = require_finite(value, field)?;
    match value {
        Some(number) if number < 0.0 => Err(coded(
            errors::VALIDATION_TIME_NEGATIVE,
            format!("{field} cannot be negative; received {number}."),
        )),
        other => Ok(other),
    }
}

/// A repeat count is how many times a test was run: a whole number, at least one.
pub fn require_repeat_count(value: Option<f64>) -> Result<Option<i64>, String> {
    let Some(number) = require_finite(value, "Repeat count")? else {
        return Ok(None);
    };
    if number < 1.0 || number.fract() != 0.0 {
        return Err(coded(
            errors::VALIDATION_REPEAT_COUNT_INVALID,
            format!("Repeat count must be a whole number of one or more; received {number}."),
        ));
    }
    Ok(Some(number as i64))
}

/// A role has to be one this build knows how to interpret.
pub fn require_component_role(role: Option<&str>) -> Result<String, String> {
    let role = role.map(str::trim).unwrap_or_default();
    if role.is_empty() {
        return Err(coded(
            errors::VALIDATION_ROLE_UNSUPPORTED,
            format!(
                "A component role is required. Supported roles: {}.",
                COMPONENT_ROLES.join(", ")
            ),
        ));
    }
    if !COMPONENT_ROLES.contains(&role) {
        return Err(coded(
            errors::VALIDATION_ROLE_UNSUPPORTED,
            format!(
                "Unsupported component role `{role}`. Supported roles: {}.",
                COMPONENT_ROLES.join(", ")
            ),
        ));
    }
    Ok(role.to_string())
}

/// A unit has to be one of the recorded set, so a stored number always means something.
pub fn require_concentration_unit(
    unit: Option<&str>,
    allowed: &[&str],
    field: &str,
) -> Result<Option<String>, String> {
    let Some(unit) = unit.map(str::trim).filter(|text| !text.is_empty()) else {
        return Ok(None);
    };
    if !allowed.contains(&unit) {
        return Err(coded(
            errors::VALIDATION_UNIT_UNSUPPORTED,
            format!(
                "Unsupported {field} `{unit}`. Supported units: {}.",
                allowed.join(", ")
            ),
        ));
    }
    Ok(Some(unit.to_string()))
}

/// An additive's typical range has to be orderable.
pub fn require_ordered_range(minimum: Option<f64>, maximum: Option<f64>) -> Result<(), String> {
    if let (Some(low), Some(high)) = (minimum, maximum) {
        if low > high {
            return Err(coded(
                errors::VALIDATION_RANGE_INVERTED,
                format!(
                    "The minimum typical concentration ({low}) cannot exceed the maximum ({high})."
                ),
            ));
        }
    }
    Ok(())
}

/// Which entity a component references, once exactly one has been established.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ComponentReference {
    BaseOil(String),
    Additive(String),
    Molecule(String),
}

impl ComponentReference {
    pub fn id(&self) -> &str {
        match self {
            Self::BaseOil(id) | Self::Additive(id) | Self::Molecule(id) => id,
        }
    }
}

/// A component references exactly one entity, and that entity has to suit its role.
///
/// Both halves matter. Two references make a component ambiguous — which one is the 2 wt%? — and a
/// `base_oil` row pointing at an additive describes a blend that was never mixed. Neither is a
/// database error, which is why neither was caught before.
pub fn require_single_reference(
    role: &str,
    base_oil_id: Option<&str>,
    additive_id: Option<&str>,
    molecule_id: Option<&str>,
) -> Result<ComponentReference, String> {
    let mut referenced: Vec<ComponentReference> = Vec::new();
    if let Some(id) = base_oil_id.map(str::trim).filter(|text| !text.is_empty()) {
        referenced.push(ComponentReference::BaseOil(id.to_string()));
    }
    if let Some(id) = additive_id.map(str::trim).filter(|text| !text.is_empty()) {
        referenced.push(ComponentReference::Additive(id.to_string()));
    }
    if let Some(id) = molecule_id.map(str::trim).filter(|text| !text.is_empty()) {
        referenced.push(ComponentReference::Molecule(id.to_string()));
    }

    match referenced.len() {
        0 => Err(coded(
            errors::VALIDATION_COMPONENT_REFERENCE,
            format!(
                "A `{role}` component must reference exactly one base oil, additive, or molecule."
            ),
        )),
        1 => {
            let reference = referenced.remove(0);
            check_reference_matches_role(role, &reference)?;
            Ok(reference)
        }
        count => Err(coded(
            errors::VALIDATION_COMPONENT_REFERENCE,
            format!(
                "A `{role}` component references {count} entities; exactly one is required so the \
                 recorded concentration is unambiguous."
            ),
        )),
    }
}

fn check_reference_matches_role(role: &str, reference: &ComponentReference) -> Result<(), String> {
    let suitable = match (role, reference) {
        // A base oil slot may hold a catalogued base oil, or a molecule standing in for one.
        ("base_oil", ComponentReference::BaseOil(_) | ComponentReference::Molecule(_)) => true,
        // An additive slot may hold a catalogued additive, or a bare molecule being trialled.
        ("additive", ComponentReference::Additive(_) | ComponentReference::Molecule(_)) => true,
        // Solvents and everything else are recorded as molecules; there is no catalogue for them.
        ("solvent" | "other", ComponentReference::Molecule(_)) => true,
        _ => false,
    };
    if suitable {
        return Ok(());
    }
    let referenced = match reference {
        ComponentReference::BaseOil(_) => "base oil",
        ComponentReference::Additive(_) => "additive",
        ComponentReference::Molecule(_) => "molecule",
    };
    Err(coded(
        errors::VALIDATION_ROLE_REFERENCE_MISMATCH,
        format!("A `{role}` component cannot reference a {referenced} record."),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn code_of(message: &str) -> String {
        message
            .trim_start_matches('[')
            .split(']')
            .next()
            .unwrap_or_default()
            .to_string()
    }

    #[test]
    fn a_blank_name_is_refused_with_a_translatable_code() {
        let error = require_name(Some("   "), "Formulation name").expect_err("blank is refused");
        assert_eq!(code_of(&error), errors::VALIDATION_NAME_REQUIRED);
    }

    #[test]
    fn a_non_finite_number_is_refused() {
        let error = require_finite(Some(f64::NAN), "Load").expect_err("NaN is refused");
        assert_eq!(code_of(&error), errors::VALIDATION_NUMBER_NOT_FINITE);
        assert!(require_finite(Some(12.5), "Load").is_ok());
        assert!(require_finite(None, "Load")
            .expect("absent is fine")
            .is_none());
    }

    #[test]
    fn a_zero_concentration_is_refused_but_an_absent_one_is_not() {
        let error = require_positive_concentration(Some(0.0), "Concentration")
            .expect_err("zero is refused");
        assert_eq!(
            code_of(&error),
            errors::VALIDATION_CONCENTRATION_NOT_POSITIVE
        );
        assert!(require_positive_concentration(None, "Concentration")
            .expect("absent is fine")
            .is_none());
        assert_eq!(
            require_positive_concentration(Some(1.5), "Concentration").expect("positive is fine"),
            Some(1.5)
        );
    }

    #[test]
    fn a_negative_preparation_time_is_refused_and_zero_is_allowed() {
        let error =
            require_non_negative(Some(-4.0), "Preparation time").expect_err("negative is refused");
        assert_eq!(code_of(&error), errors::VALIDATION_TIME_NEGATIVE);
        assert_eq!(
            require_non_negative(Some(0.0), "Preparation time").expect("zero is a real duration"),
            Some(0.0)
        );
    }

    #[test]
    fn a_repeat_count_must_be_a_whole_number_of_at_least_one() {
        assert_eq!(require_repeat_count(Some(3.0)).expect("3 is fine"), Some(3));
        assert_eq!(require_repeat_count(None).expect("absent is fine"), None);
        for refused in [0.0, -1.0, 2.5] {
            let error = require_repeat_count(Some(refused))
                .unwrap_err_or_panic(&format!("{refused} should be refused"));
            assert_eq!(code_of(&error), errors::VALIDATION_REPEAT_COUNT_INVALID);
        }
    }

    #[test]
    fn only_known_roles_and_units_are_accepted() {
        assert_eq!(
            require_component_role(Some("additive")).expect("known role"),
            "additive"
        );
        let error = require_component_role(Some("catalyst")).expect_err("unknown role is refused");
        assert_eq!(code_of(&error), errors::VALIDATION_ROLE_UNSUPPORTED);

        assert_eq!(
            require_concentration_unit(Some("ppm"), CONCENTRATION_UNITS, "concentration unit")
                .expect("known unit"),
            Some("ppm".to_string())
        );
        let error =
            require_concentration_unit(Some("furlongs"), CONCENTRATION_UNITS, "concentration unit")
                .expect_err("unknown unit is refused");
        assert_eq!(code_of(&error), errors::VALIDATION_UNIT_UNSUPPORTED);
    }

    #[test]
    fn an_inverted_typical_range_is_refused() {
        let error = require_ordered_range(Some(5.0), Some(1.0)).expect_err("inverted is refused");
        assert_eq!(code_of(&error), errors::VALIDATION_RANGE_INVERTED);
        assert!(require_ordered_range(Some(1.0), Some(5.0)).is_ok());
        assert!(require_ordered_range(Some(1.0), None).is_ok());
    }

    #[test]
    fn a_component_must_reference_exactly_one_entity() {
        let error = require_single_reference("additive", None, None, None)
            .expect_err("no reference is refused");
        assert_eq!(code_of(&error), errors::VALIDATION_COMPONENT_REFERENCE);

        let error = require_single_reference("additive", Some("bo-1"), Some("ad-1"), None)
            .expect_err("two references are refused");
        assert_eq!(code_of(&error), errors::VALIDATION_COMPONENT_REFERENCE);

        assert_eq!(
            require_single_reference("additive", None, Some("ad-1"), None).expect("one reference"),
            ComponentReference::Additive("ad-1".to_string())
        );
    }

    #[test]
    fn a_reference_that_contradicts_the_role_is_refused() {
        let error = require_single_reference("base_oil", None, Some("ad-1"), None)
            .expect_err("an additive is not a base oil");
        assert_eq!(code_of(&error), errors::VALIDATION_ROLE_REFERENCE_MISMATCH);

        let error = require_single_reference("solvent", Some("bo-1"), None, None)
            .expect_err("a base oil is not a solvent");
        assert_eq!(code_of(&error), errors::VALIDATION_ROLE_REFERENCE_MISMATCH);

        // A molecule standing in for an uncatalogued base oil stays legal.
        assert!(require_single_reference("base_oil", None, None, Some("m-1")).is_ok());
    }

    #[test]
    fn numbers_are_read_from_json_numbers_and_from_strings() {
        let parsed: LenientNumber = serde_json::from_str("\"12.5\"").expect("string parses");
        assert_eq!(parsed.0, 12.5);
        let parsed: LenientNumber = serde_json::from_str("12.5").expect("number parses");
        assert_eq!(parsed.0, 12.5);
        assert!(serde_json::from_str::<LenientNumber>("\"twelve\"").is_err());
    }

    #[test]
    fn text_that_is_not_a_number_is_an_error_rather_than_an_absent_value() {
        #[derive(serde::Deserialize)]
        struct Row {
            #[serde(default, deserialize_with = "optional_number")]
            load: Option<f64>,
        }

        assert_eq!(
            serde_json::from_str::<Row>(r#"{"load": ""}"#)
                .expect("blank text means no value")
                .load,
            None
        );
        assert_eq!(
            serde_json::from_str::<Row>(r#"{"load": "12.5"}"#)
                .expect("numeric text is a value")
                .load,
            Some(12.5)
        );
        // The previous readers turned this into `None`, which stored the row as though the field
        // had been left blank.
        assert!(serde_json::from_str::<Row>(r#"{"load": "n/a"}"#).is_err());
    }

    /// A tiny helper so the loop above reads as one assertion per case.
    trait UnwrapErrOrPanic<T> {
        fn unwrap_err_or_panic(self, message: &str) -> String;
    }
    impl<T: std::fmt::Debug> UnwrapErrOrPanic<T> for Result<T, String> {
        fn unwrap_err_or_panic(self, message: &str) -> String {
            match self {
                Ok(value) => panic!("{message}, but it produced {value:?}"),
                Err(error) => error,
            }
        }
    }
}
