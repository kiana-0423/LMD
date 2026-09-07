//! Test-specific conditions, with explicit provenance for optional environment defaults.
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Default, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TestParameters {
    pub mode: Option<String>,
    pub stroke_mm: Option<f64>,
    pub frequency_hz: Option<f64>,
    pub radius_mm: Option<f64>,
    pub speed_rpm: Option<f64>,
    pub ambient_temperature_c: Option<f64>,
    pub humidity_percent: Option<f64>,
    pub environment_provenance: Value,
}

impl TestParameters {
    pub fn validate(mut self, test_type: &str) -> Result<Self, String> {
        for (name, value) in [
            ("Stroke (mm)", self.stroke_mm),
            ("Frequency (Hz)", self.frequency_hz),
            ("Track radius (mm)", self.radius_mm),
            ("Speed (rpm)", self.speed_rpm),
        ] {
            if value.is_some_and(|v| !v.is_finite() || v <= 0.0) {
                return Err(format!("{name} must be greater than zero."));
            }
        }
        if self
            .ambient_temperature_c
            .is_some_and(|v| !v.is_finite() || v < -273.15)
        {
            return Err("Ambient temperature must be finite and at least -273.15 C.".into());
        }
        if self
            .humidity_percent
            .is_some_and(|v| !v.is_finite() || !(0.0..=100.0).contains(&v))
        {
            return Err("Relative humidity must be between 0 and 100%.".into());
        }
        if test_type == "TE77" {
            self.mode = Some("reciprocating".into());
        }
        if test_type == "UMT"
            && !matches!(self.mode.as_deref(), Some("reciprocating" | "ball-on-disk"))
        {
            return Err("Select a UMT mode: reciprocating or ball-on-disk.".into());
        }
        if matches!(test_type, "UMT" | "TE77") {
            if self.mode.as_deref() == Some("reciprocating") {
                if self.stroke_mm.is_none() || self.frequency_hz.is_none() {
                    return Err("Reciprocating tests require stroke and frequency.".into());
                }
                self.radius_mm = None;
                self.speed_rpm = None;
            } else {
                if self.radius_mm.is_none() || self.speed_rpm.is_none() {
                    return Err("UMT ball-on-disk tests require track radius and speed.".into());
                }
                self.stroke_mm = None;
                self.frequency_hz = None;
            }
        } else {
            self.mode = None;
            self.stroke_mm = None;
            self.frequency_hz = None;
            self.radius_mm = None;
            if test_type != "four-ball" {
                self.speed_rpm = None;
            }
        }
        Ok(self)
    }

    /// Resolve once when saving, exclude inferred values and the record being edited.
    /// A workspace without measurements remains missing, never an invented constant.
    pub fn resolve_environment(
        &mut self,
        connection: &Connection,
        test_type: &str,
        id: &str,
        now: &str,
    ) -> Result<(), String> {
        let mut provenance = serde_json::Map::new();
        for (key, slot) in [
            ("ambientTemperatureC", &mut self.ambient_temperature_c),
            ("humidityPercent", &mut self.humidity_percent),
        ] {
            if slot.is_some() {
                provenance.insert(key.into(), json!({"source": "measured"}));
                continue;
            }
            // `key` comes only from the fixed list above. Legacy humidity is a
            // recorded measurement; old test temperatures are NOT ambient temperatures.
            let value = if key == "humidityPercent" {
                "COALESCE(json_extract(test_parameters_json, '$.humidityPercent'), humidity)"
                    .to_string()
            } else {
                "json_extract(test_parameters_json, '$.ambientTemperatureC')".to_string()
            };
            let range = if key == "humidityPercent" {
                format!("{value} BETWEEN 0 AND 100")
            } else {
                format!("{value} >= -273.15")
            };
            let sql = format!("SELECT AVG({value}), COUNT({value}) FROM experiments WHERE test_type = ?1 AND id != ?2
                AND COALESCE(json_extract(test_parameters_json, '$.environmentProvenance.{key}.source'), 'measured') = 'measured'
                AND typeof({value}) IN ('real', 'integer') AND {range}");
            let (mean, count): (Option<f64>, i64) = connection
                .query_row(&sql, params![test_type, id], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })
                .map_err(|e| format!("Failed to calculate environment mean: {e}"))?;
            *slot = mean;
            provenance.insert(
                key.into(),
                json!({"source": if mean.is_some() { "mean" } else { "missing" },
                "testType": test_type, "sampleCount": count, "computedAt": now}),
            );
        }
        self.environment_provenance = Value::Object(provenance);
        Ok(())
    }
}

pub fn save_parameters(
    connection: &Connection,
    id: &str,
    parameters: &TestParameters,
) -> Result<(), String> {
    let text = serde_json::to_string(parameters).map_err(|e| e.to_string())?;
    connection.execute("UPDATE experiments SET test_parameters_json=?2,
        stroke_value=?3, stroke_unit=CASE WHEN ?3 IS NULL THEN NULL ELSE 'mm' END,
        frequency_value=?4, frequency_unit=CASE WHEN ?4 IS NULL THEN NULL ELSE 'Hz' END,
        speed_value=?5, speed_unit=CASE WHEN ?5 IS NULL THEN NULL ELSE 'rpm' END, humidity=?6 WHERE id=?1",
        params![id, text, parameters.stroke_mm, parameters.frequency_hz, parameters.speed_rpm, parameters.humidity_percent])
        .map_err(|e| format!("Failed to save test parameters: {e}"))?;
    Ok(())
}
