//! Tri-state field reading for partial updates.
//!
//! `COALESCE(?, column)` cannot express "clear this field": an explicit empty string or null
//! arrives as SQL NULL and is read as "not supplied". These helpers distinguish the three cases a
//! caller can mean, so a user can actually empty a note or drop a measurement.
//!
//! | JSON                     | Meaning              | Stored              |
//! |--------------------------|----------------------|---------------------|
//! | key absent               | leave unchanged      | existing value      |
//! | `null`                   | clear                | SQL NULL            |
//! | `""`                     | clear a text field   | empty string        |
//! | `0` / `0.0`              | a real number        | zero                |
//!
//! A fourth case is not a patch at all: a value of the wrong shape — `"12a"` for a number, `2.7`
//! for an integer field, `[1, 2]` for a list of tags. Treating those as "unchanged" reports success
//! while discarding what the caller asked for, so they are returned as errors instead.

use rusqlite::types::{ToSql, ToSqlOutput, Value as SqlValue};
use rusqlite::Result as SqlResult;
use serde_json::Value;

/// What a caller asked for one field.
#[derive(Debug, Clone, PartialEq)]
pub enum FieldPatch<T> {
    /// The key was absent: keep whatever is stored.
    Unchanged,
    /// The key was present and null: store SQL NULL.
    Clear,
    /// The key carried a value.
    Set(T),
}

impl<T> FieldPatch<T> {
    pub fn is_unchanged(&self) -> bool {
        matches!(self, Self::Unchanged)
    }
}

/// Binds a patch for a statement of the form
/// `column = CASE WHEN ?keep THEN column ELSE ?value END`.
///
/// `keep` is true only for `Unchanged`, so `Clear` writes NULL and `Set` writes the value.
pub struct Patched<T>(pub FieldPatch<T>);

impl<T: ToSql> ToSql for Patched<T> {
    fn to_sql(&self) -> SqlResult<ToSqlOutput<'_>> {
        match &self.0 {
            FieldPatch::Set(value) => value.to_sql(),
            _ => Ok(ToSqlOutput::Owned(SqlValue::Null)),
        }
    }
}

/// Reads a text field, accepting either a camelCase or snake_case key.
///
/// A JSON string, or an explicit null to clear. Nothing else.
///
/// Coercing a number or a boolean into text looks harmless and is not: `42` and `true` become the
/// strings `"42"` and `"true"`, which is almost never what a caller sending the wrong type meant,
/// and the mistake is then stored as if it had been typed. An empty string remains a deliberate
/// clear rather than a missing value.
pub fn text(payload: &Value, camel: &str, snake: &str) -> Result<FieldPatch<String>, String> {
    match lookup(payload, camel, snake) {
        None => Ok(FieldPatch::Unchanged),
        Some(Value::Null) => Ok(FieldPatch::Clear),
        Some(Value::String(text)) => Ok(FieldPatch::Set(text.clone())),
        Some(other) => Err(format!(
            "{camel} must be text, but {} was supplied. Send it as a JSON string, or null to clear it.",
            kind_of(other)
        )),
    }
}

/// Reads a numeric field. Zero is a value, not an absence.
///
/// A string that is not a number is an error rather than a silent no-op: a caller who typed "12a"
/// meant to change something, and reporting success would lose their edit without saying so.
pub fn number(payload: &Value, camel: &str, snake: &str) -> Result<FieldPatch<f64>, String> {
    match lookup(payload, camel, snake) {
        None => Ok(FieldPatch::Unchanged),
        Some(Value::Null) => Ok(FieldPatch::Clear),
        Some(Value::Number(number)) => number
            .as_f64()
            .filter(|value| value.is_finite())
            .map(FieldPatch::Set)
            .ok_or_else(|| format!("{} must be a finite number.", camel)),
        // A form that clears a numeric input sends "" rather than null.
        Some(Value::String(text)) if text.trim().is_empty() => Ok(FieldPatch::Clear),
        Some(Value::String(text)) => text
            .trim()
            .parse::<f64>()
            .ok()
            .filter(|value| value.is_finite())
            .map(FieldPatch::Set)
            .ok_or_else(|| {
                format!(
                    "{} must be a number, but '{}' was supplied.",
                    camel,
                    text.trim()
                )
            }),
        Some(other) => Err(format!(
            "{} must be a number, but {} was supplied.",
            camel,
            kind_of(other)
        )),
    }
}

/// Reads an integer field.
///
/// A fractional value is rejected rather than truncated: storing 2 when the caller asked for 2.7
/// is a silent data change, and the caller has no way to notice it.
pub fn integer(payload: &Value, camel: &str, snake: &str) -> Result<FieldPatch<i64>, String> {
    match number(payload, camel, snake)? {
        FieldPatch::Set(value) => {
            if value.fract() != 0.0 {
                return Err(format!(
                    "{} must be a whole number, but {value} was supplied.",
                    camel
                ));
            }
            if value < i64::MIN as f64 || value > i64::MAX as f64 {
                return Err(format!("{} is out of range.", camel));
            }
            Ok(FieldPatch::Set(value as i64))
        }
        FieldPatch::Clear => Ok(FieldPatch::Clear),
        FieldPatch::Unchanged => Ok(FieldPatch::Unchanged),
    }
}

/// Reads a list field, stored as JSON text.
///
/// Every member must be text. A list holding a number or an object is rejected, because dropping
/// the offending member would store a different list from the one that was sent.
pub fn list(payload: &Value, camel: &str, snake: &str) -> Result<FieldPatch<String>, String> {
    match lookup(payload, camel, snake) {
        None => Ok(FieldPatch::Unchanged),
        Some(Value::Null) => Ok(FieldPatch::Clear),
        Some(Value::Array(items)) => {
            let mut values = Vec::with_capacity(items.len());
            for (index, item) in items.iter().enumerate() {
                match item {
                    Value::String(text) => values.push(text.clone()),
                    other => {
                        return Err(format!(
                            "{}[{index}] must be text, but {} was supplied.",
                            camel,
                            kind_of(other)
                        ))
                    }
                }
            }
            Ok(FieldPatch::Set(serde_json::to_string(&values).map_err(
                |err| format!("{} could not be stored: {err}", camel),
            )?))
        }
        Some(other) => Err(format!(
            "{} must be a list, but {} was supplied.",
            camel,
            kind_of(other)
        )),
    }
}

/// Reads a field that must stay non-empty when supplied, such as a name.
pub fn required_text(
    payload: &Value,
    camel: &str,
    snake: &str,
    label: &str,
) -> Result<FieldPatch<String>, String> {
    match text(payload, camel, snake)? {
        FieldPatch::Unchanged => Ok(FieldPatch::Unchanged),
        FieldPatch::Clear => Err(format!("{label} cannot be cleared.")),
        FieldPatch::Set(value) if value.trim().is_empty() => {
            Err(format!("{label} cannot be empty."))
        }
        FieldPatch::Set(value) => Ok(FieldPatch::Set(value.trim().to_string())),
    }
}

/// Names a JSON type the way a user would recognise it.
fn kind_of(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "a true/false value",
        Value::Number(_) => "a number",
        Value::String(_) => "text",
        Value::Array(_) => "a list",
        Value::Object(_) => "an object",
    }
}

fn lookup<'a>(payload: &'a Value, camel: &str, snake: &str) -> Option<&'a Value> {
    payload.get(camel).or_else(|| payload.get(snake))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_absent_key_leaves_the_field_alone() {
        let payload = json!({ "other": 1 });
        assert_eq!(
            text(&payload, "notes", "notes").unwrap(),
            FieldPatch::Unchanged
        );
        assert_eq!(
            number(&payload, "density", "density").unwrap(),
            FieldPatch::Unchanged
        );
        assert_eq!(
            list(&payload, "tags", "tags").unwrap(),
            FieldPatch::Unchanged
        );
    }

    #[test]
    fn an_explicit_null_clears_the_field() {
        let payload = json!({ "notes": null, "density": null, "tags": null });
        assert_eq!(text(&payload, "notes", "notes").unwrap(), FieldPatch::Clear);
        assert_eq!(
            number(&payload, "density", "density").unwrap(),
            FieldPatch::Clear
        );
        assert_eq!(list(&payload, "tags", "tags").unwrap(), FieldPatch::Clear);
    }

    #[test]
    fn an_empty_string_clears_a_text_field_but_is_not_an_absence() {
        let payload = json!({ "notes": "" });
        assert_eq!(
            text(&payload, "notes", "notes").unwrap(),
            FieldPatch::Set(String::new())
        );
        assert!(!text(&payload, "notes", "notes").unwrap().is_unchanged());
    }

    #[test]
    fn zero_is_stored_rather_than_treated_as_missing() {
        let payload = json!({ "density": 0, "viscosity40c": 0.0, "repeatCount": 0 });
        assert_eq!(
            number(&payload, "density", "density").unwrap(),
            FieldPatch::Set(0.0)
        );
        assert_eq!(
            number(&payload, "viscosity40c", "viscosity_40c").unwrap(),
            FieldPatch::Set(0.0)
        );
        assert_eq!(
            integer(&payload, "repeatCount", "repeat_count").unwrap(),
            FieldPatch::Set(0)
        );
    }

    #[test]
    fn a_blank_numeric_input_clears_the_value() {
        // Ant Design sends "" when a number input is emptied.
        let payload = json!({ "density": "" });
        assert_eq!(
            number(&payload, "density", "density").unwrap(),
            FieldPatch::Clear
        );
        assert_eq!(
            number(&json!({ "density": "   " }), "density", "density").unwrap(),
            FieldPatch::Clear
        );
    }

    #[test]
    fn snake_case_keys_are_accepted_too() {
        let payload = json!({ "viscosity_40c": 32.5 });
        assert_eq!(
            number(&payload, "viscosity40c", "viscosity_40c").unwrap(),
            FieldPatch::Set(32.5)
        );
    }

    #[test]
    fn a_required_field_refuses_to_be_emptied() {
        assert!(required_text(&json!({ "name": "" }), "name", "name", "Name").is_err());
        assert!(required_text(&json!({ "name": null }), "name", "name", "Name").is_err());
        assert!(required_text(&json!({ "name": "   " }), "name", "name", "Name").is_err());
        assert_eq!(
            required_text(&json!({ "name": " PAO-6 " }), "name", "name", "Name").unwrap(),
            FieldPatch::Set("PAO-6".to_string())
        );
        assert_eq!(
            required_text(&json!({}), "name", "name", "Name").unwrap(),
            FieldPatch::Unchanged
        );
    }

    #[test]
    fn a_list_round_trips_as_json_text() {
        let payload = json!({ "tags": ["antiwear", "ester"] });
        assert_eq!(
            list(&payload, "tags", "tags").unwrap(),
            FieldPatch::Set(r#"["antiwear","ester"]"#.to_string())
        );
        // An empty list is a deliberate clear-to-empty, not a null.
        assert_eq!(
            list(&json!({ "tags": [] }), "tags", "tags").unwrap(),
            FieldPatch::Set("[]".to_string())
        );
    }

    #[test]
    fn a_patch_binds_null_unless_it_carries_a_value() {
        use rusqlite::types::{ToSqlOutput, Value as SqlValue};
        let bound = |patch: FieldPatch<String>| match Patched(patch).to_sql().expect("binds") {
            ToSqlOutput::Owned(SqlValue::Null) => "null".to_string(),
            ToSqlOutput::Borrowed(value) => format!("{value:?}"),
            other => format!("{other:?}"),
        };
        assert_eq!(bound(FieldPatch::Unchanged), "null");
        assert_eq!(bound(FieldPatch::Clear), "null");
        assert!(bound(FieldPatch::Set("x".to_string())).contains('x'));
    }

    #[test]
    fn a_numeric_string_that_is_not_a_number_is_rejected_rather_than_ignored() {
        for bad in ["12a", "abc", "1.2.3", "--4", "NaN", "infinity"] {
            let error = number(&json!({ "density": bad }), "density", "density")
                .expect_err("{bad} must be rejected");
            assert!(error.contains("density"), "{error}");
            assert!(error.contains(bad), "{error}");
        }
    }

    #[test]
    fn a_numeric_field_refuses_a_value_of_the_wrong_shape() {
        assert!(number(&json!({ "density": [1] }), "density", "density").is_err());
        assert!(number(&json!({ "density": { "value": 1 } }), "density", "density").is_err());
        assert!(number(&json!({ "density": true }), "density", "density").is_err());
    }

    #[test]
    fn a_fractional_value_for_an_integer_field_is_rejected_not_truncated() {
        let error = integer(
            &json!({ "repeatCount": 2.7 }),
            "repeatCount",
            "repeat_count",
        )
        .expect_err("2.7 is not a whole number");
        assert!(error.contains("whole number"), "{error}");
        // The same through the string form a form control would send.
        assert!(integer(
            &json!({ "repeatCount": "2.7" }),
            "repeatCount",
            "repeat_count"
        )
        .is_err());
        // Whole numbers still pass, including negatives.
        assert_eq!(
            integer(&json!({ "repeatCount": -3 }), "repeatCount", "repeat_count").unwrap(),
            FieldPatch::Set(-3)
        );
        assert_eq!(
            integer(
                &json!({ "repeatCount": 4.0 }),
                "repeatCount",
                "repeat_count"
            )
            .unwrap(),
            FieldPatch::Set(4)
        );
    }

    #[test]
    fn a_list_member_of_the_wrong_type_is_rejected_rather_than_dropped() {
        let error = list(&json!({ "tags": ["ester", 7] }), "tags", "tags")
            .expect_err("a numeric tag must be rejected");
        assert!(error.contains("tags[1]"), "{error}");
        assert!(error.contains("a number"), "{error}");

        assert!(list(&json!({ "tags": [{ "name": "x" }] }), "tags", "tags").is_err());
        assert!(list(&json!({ "tags": [null] }), "tags", "tags").is_err());
    }

    #[test]
    fn a_list_field_refuses_a_value_that_is_not_a_list() {
        let error = list(&json!({ "tags": "ester" }), "tags", "tags")
            .expect_err("a bare string is not a list");
        assert!(error.contains("must be a list"), "{error}");
        assert!(list(&json!({ "tags": 7 }), "tags", "tags").is_err());
    }

    #[test]
    fn a_text_field_accepts_only_a_string_or_an_explicit_clear() {
        assert_eq!(
            text(&json!({ "notes": "a note" }), "notes", "notes").unwrap(),
            FieldPatch::Set("a note".to_string())
        );
        assert_eq!(
            text(&json!({ "notes": null }), "notes", "notes").unwrap(),
            FieldPatch::Clear
        );
        assert_eq!(
            text(&json!({}), "notes", "notes").unwrap(),
            FieldPatch::Unchanged
        );
    }

    #[test]
    fn a_text_field_rejects_every_other_type_rather_than_stringifying_it() {
        // Storing `42` as "42" and `true` as "true" hides a caller's mistake inside the data.
        for payload in [
            json!({ "notes": 12 }),
            json!({ "notes": 12.5 }),
            json!({ "notes": true }),
            json!({ "notes": false }),
            json!({ "notes": ["a"] }),
            json!({ "notes": { "a": 1 } }),
        ] {
            assert!(
                text(&payload, "notes", "notes").is_err(),
                "{payload} must be refused rather than coerced"
            );
        }
    }

    #[test]
    fn a_rejected_text_value_names_the_field_and_what_it_needs() {
        for (payload, kind) in [
            (json!({ "notes": 12 }), "a number"),
            (json!({ "notes": true }), "a true/false value"),
            (json!({ "notes": ["a"] }), "a list"),
            (json!({ "notes": { "a": 1 } }), "an object"),
        ] {
            let error = text(&payload, "notes", "notes").expect_err("must be refused");
            assert!(error.contains("notes"), "{error}");
            assert!(error.contains(kind), "{error}");
            assert!(error.contains("JSON string"), "{error}");
        }
    }

    #[test]
    fn a_required_text_field_rejects_a_non_string_too() {
        let error = required_text(&json!({ "name": 7 }), "name", "name", "Name")
            .expect_err("a name is text");
        assert!(error.contains("must be text"), "{error}");
    }
}
