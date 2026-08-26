use crate::app_paths::default_database_path;
use crate::commands::messages::{self, Message};
use crate::commands::ok;
use crate::commands::statistics;
use crate::db::open_database;
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use tauri::AppHandle;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummaryDto {
    pub molecule_count: i64,
    pub base_oil_count: i64,
    pub additive_count: i64,
    pub formulation_count: i64,
    pub formulation_component_count: i64,
    pub experiment_count: i64,
    pub performance_result_count: i64,
    pub attachment_count: i64,
    pub data_source_count: i64,
    pub job_count: i64,
    pub running_job_count: i64,
    pub failed_job_count: i64,
    pub descriptor_record_count: i64,
    pub descriptor_ready_count: i64,
    pub descriptor_failed_count: i64,
    pub descriptor_pending_count: i64,
    pub descriptor_mock_count: i64,
    pub descriptor_real_count: i64,
}

#[tauri::command]
pub fn get_dashboard_summary(app: AppHandle) -> Result<DashboardSummaryDto, String> {
    let db_path = default_database_path(&app)?;
    let connection = open_database(db_path)
        .map_err(|err| format!("Failed to open SQLite database for dashboard summary: {err}"))?;

    Ok(DashboardSummaryDto {
        molecule_count: count(&connection, "molecules")?,
        base_oil_count: count(&connection, "base_oils")?,
        additive_count: count(&connection, "additives")?,
        formulation_count: count(&connection, "formulations")?,
        formulation_component_count: count(&connection, "formulation_components")?,
        experiment_count: count(&connection, "experiments")?,
        performance_result_count: count(&connection, "performance_results")?,
        attachment_count: count(&connection, "attachments")?,
        data_source_count: count(&connection, "data_sources")?,
        job_count: count(&connection, "jobs")?,
        running_job_count: count_where(&connection, "jobs", "status IN ('running', 'pending')")?,
        failed_job_count: count_where(&connection, "jobs", "status = 'failed'")?,
        descriptor_record_count: count(&connection, "molecule_descriptors")?,
        descriptor_ready_count: count_where(&connection, "molecules", "descriptor_ready = 1")?,
        descriptor_failed_count: count_where(
            &connection,
            "molecule_descriptors",
            "status = 'failed'",
        )?,
        descriptor_pending_count: count_where(
            &connection,
            "molecule_descriptors",
            "status IN ('pending', '') OR status IS NULL",
        )?,
        descriptor_mock_count: count_where(&connection, "molecule_descriptors", "mode = 'mock'")?,
        descriptor_real_count: count_where(&connection, "molecule_descriptors", "mode = 'real'")?,
    })
}

/// Metrics the analysis screens can chart, with the column, the label code, the English label,
/// and the unit each one reads.
///
/// The label code is what a frontend translates. The English label stays because it is what a CSV
/// export and a log line carry, where there is no user and no chosen language — but it is not what
/// the interface shows.
const PERFORMANCE_METRICS: &[(&str, &str, &str, &str)] = &[
    (
        "average_friction_coefficient",
        "metric.averageFrictionCoefficient",
        "Average friction coefficient",
        "dimensionless",
    ),
    (
        "stable_friction_coefficient",
        "metric.stableFrictionCoefficient",
        "Stable friction coefficient",
        "dimensionless",
    ),
    (
        "wear_scar_diameter_value",
        "metric.wearScarDiameter",
        "Wear scar diameter",
        "um",
    ),
    (
        "wear_scar_width_value",
        "metric.wearScarWidth",
        "Wear scar width",
        "um",
    ),
    (
        "initial_oxidation_temperature_value",
        "metric.initialOxidationTemperature",
        "Initial oxidation temperature",
        "C",
    ),
    (
        "extreme_pressure_value",
        "metric.extremePressure",
        "Extreme pressure",
        "N",
    ),
    ("pb_value", "metric.pbValue", "PB value", "N"),
    ("pd_value", "metric.pdValue", "PD value", "N"),
];

/// Smallest sample an analysis will report on. Below this the answer is "not enough data",
/// never a chart drawn from one or two points.
const MIN_ANALYSIS_SAMPLES: usize = 3;
/// Correlation needs a few more points before a coefficient means anything.
const MIN_CORRELATION_SAMPLES: usize = 5;

/// The column, English label, and unit for one metric.
pub fn describe_metric(metric: &str) -> Result<(&'static str, &'static str, &'static str), String> {
    find_metric(metric).map(|(column, _, label, unit)| (column, label, unit))
}

/// The translation key for a metric's name, so a chart axis can be labelled in the user's
/// language rather than in the language the column was named in.
pub fn metric_label_code(metric: &str) -> &'static str {
    find_metric(metric)
        .map(|(_, code, _, _)| code)
        .unwrap_or("metric.unknown")
}

fn find_metric(
    metric: &str,
) -> Result<(&'static str, &'static str, &'static str, &'static str), String> {
    PERFORMANCE_METRICS
        .iter()
        .find(|(column, _, _, _)| *column == metric)
        .copied()
        .ok_or_else(|| {
            let supported = PERFORMANCE_METRICS
                .iter()
                .map(|(column, _, _, _)| *column)
                .collect::<Vec<_>>()
                .join(", ");
            format!("Unsupported performance metric '{metric}'. Supported metrics: {supported}.")
        })
}

fn open(app: &AppHandle) -> Result<Connection, String> {
    open_database(default_database_path(app)?)
        .map_err(|err| format!("Failed to open SQLite database for analysis: {err}"))
}

/// Reports that an analysis has too little data to answer honestly.
///
/// The message is a descriptor rather than a sentence: "needs at least 3 measured results; the
/// workspace has 1" is a count and a metric, and assembling it here would fix it in English.
fn insufficient(command: &str, metadata: Value, message: Message) -> Result<Value, String> {
    ok(
        command,
        json!({
            "status": "insufficient_data",
            "message": message.to_json(),
            "metadata": metadata,
            "series": []
        }),
    )
}

#[tauri::command]
pub fn list_performance_metrics() -> Result<Value, String> {
    ok(
        "list_performance_metrics",
        json!({
            "metrics": PERFORMANCE_METRICS
                .iter()
                .map(|(column, label_code, label, unit)| json!({
                    "column": column,
                    // The key the interface renders. `label` is the English fallback, for a
                    // build that does not yet carry this key.
                    "labelCode": label_code,
                    "label": label,
                    "unit": unit
                }))
                .collect::<Vec<_>>()
        }),
    )
}

/// Histogram plus descriptive statistics for one stored performance metric.
#[tauri::command]
pub fn get_performance_distribution(
    app: AppHandle,
    metric: Option<String>,
    bin_count: Option<usize>,
) -> Result<Value, String> {
    let metric = metric.unwrap_or_else(|| "average_friction_coefficient".to_string());
    let (column, label, unit) = describe_metric(&metric)?;
    let bin_count = bin_count.unwrap_or(10).clamp(1, 50);
    let connection = open(&app)?;

    let sql = format!("SELECT {column} FROM performance_results");
    let mut statement = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare the distribution query: {err}"))?;
    let raw: Vec<Option<f64>> = statement
        .query_map([], |row| row.get::<_, Option<f64>>(0))
        .map_err(|err| format!("Failed to query {column}: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read a {column} row: {err}"))?;
    let values = statistics::finite(&raw);
    let metadata = json!({
        "recordCount": values.len(),
        "excludedCount": raw.len() - values.len(),
        "missingValueMessage": Message::new(messages::ANALYSIS_MISSING_EXCLUDED)
            .detail("rows without a numeric value are excluded")
            .to_json(),
        "field": column,
        "labelCode": metric_label_code(column),
        "label": label,
        "unit": unit,
        "methodMessage": Message::new(messages::ANALYSIS_METHOD_HISTOGRAM)
            .detail("equal-width histogram over the observed range")
            .to_json()
    });

    if values.len() < MIN_ANALYSIS_SAMPLES {
        return insufficient(
            "get_performance_distribution",
            metadata,
            Message::new(messages::ANALYSIS_NOT_ENOUGH_DATA)
                .with("labelCode", metric_label_code(column))
                .with("required", MIN_ANALYSIS_SAMPLES as u64)
                .with("available", values.len() as u64)
                .detail(format!(
                    "{label} needs at least {MIN_ANALYSIS_SAMPLES} measured results; the workspace has {}.",
                    values.len()
                )),
        );
    }

    let summary = statistics::summarize(&values).expect("values are non-empty");
    let bins = statistics::histogram(&values, bin_count).expect("values are non-empty");
    ok(
        "get_performance_distribution",
        json!({
            "status": "ok",
            "metadata": metadata,
            "summary": summary,
            "series": bins
                .into_iter()
                .map(|(start, end, count)| json!({
                    "binStart": start,
                    "binEnd": end,
                    "count": count,
                    "label": format!("{start:.4}-{end:.4}")
                }))
                .collect::<Vec<_>>()
        }),
    )
}

#[derive(Debug)]
struct GroupedValue {
    group_id: String,
    group_label: String,
    value: f64,
}

fn load_grouped_metric(
    connection: &Connection,
    column: &str,
    group: &str,
) -> Result<(Vec<GroupedValue>, usize), String> {
    // Every comparison walks formulation components, so an additive or base oil is compared
    // across all formulations that contain it.
    let sql = match group {
        "additive" => format!(
            "SELECT a.id, COALESCE(m.name, a.id), r.{column}
             FROM performance_results r
             JOIN experiments e ON e.id = r.experiment_id
             JOIN formulation_components c ON c.formulation_id = e.formulation_id
             JOIN additives a ON a.id = c.additive_id
             LEFT JOIN molecules m ON m.id = a.molecule_id"
        ),
        "base_oil" => format!(
            "SELECT b.id, b.name, r.{column}
             FROM performance_results r
             JOIN experiments e ON e.id = r.experiment_id
             JOIN formulation_components c ON c.formulation_id = e.formulation_id
             JOIN base_oils b ON b.id = c.base_oil_id"
        ),
        "formulation" => format!(
            "SELECT f.id, f.name, r.{column}
             FROM performance_results r
             JOIN experiments e ON e.id = r.experiment_id
             JOIN formulations f ON f.id = e.formulation_id"
        ),
        "test_type" => format!(
            "SELECT COALESCE(e.test_type, 'unspecified'), COALESCE(e.test_type, 'unspecified'), r.{column}
             FROM performance_results r
             JOIN experiments e ON e.id = r.experiment_id"
        ),
        other => {
            return Err(format!(
                "Unsupported comparison group '{other}'. Use additive, base_oil, formulation, or test_type."
            ))
        }
    };
    let mut statement = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare the {group} comparison query: {err}"))?;
    let rows: Vec<(String, String, Option<f64>)> = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, Option<f64>>(2)?,
            ))
        })
        .map_err(|err| format!("Failed to query the {group} comparison: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read a {group} comparison row: {err}"))?;
    let total = rows.len();
    let kept = rows
        .into_iter()
        .filter_map(|(group_id, group_label, value)| {
            value
                .filter(|value| value.is_finite())
                .map(|value| GroupedValue {
                    group_id,
                    group_label,
                    value,
                })
        })
        .collect::<Vec<_>>();
    let excluded = total - kept.len();
    Ok((kept, excluded))
}

/// Per-group summary statistics for one metric — the shared engine behind additive, base-oil,
/// formulation, and test-type comparisons.
#[tauri::command]
pub fn compare_performance_by_group(
    app: AppHandle,
    group: Option<String>,
    metric: Option<String>,
    min_samples: Option<usize>,
) -> Result<Value, String> {
    let group = group.unwrap_or_else(|| "additive".to_string());
    let metric = metric.unwrap_or_else(|| "average_friction_coefficient".to_string());
    let (column, label, unit) = describe_metric(&metric)?;
    let min_samples = min_samples.unwrap_or(1).max(1);
    let connection = open(&app)?;
    let (rows, excluded) = load_grouped_metric(&connection, column, &group)?;

    let mut grouped: BTreeMap<String, (String, Vec<f64>)> = BTreeMap::new();
    for row in rows {
        let entry = grouped
            .entry(row.group_id)
            .or_insert_with(|| (row.group_label, Vec::new()));
        entry.1.push(row.value);
    }

    let mut series: Vec<Value> = Vec::new();
    let mut skipped_groups = 0_usize;
    for (group_id, (group_label, values)) in grouped {
        if values.len() < min_samples {
            skipped_groups += 1;
            continue;
        }
        let summary = statistics::summarize(&values).expect("group has values");
        series.push(json!({
            "groupId": group_id,
            "label": group_label,
            "summary": summary
        }));
    }
    // Best-performing group first for friction and wear, where lower is better.
    let lower_is_better = column.contains("friction") || column.contains("wear_scar");
    series.sort_by(|left, right| {
        let a = left["summary"]["mean"].as_f64().unwrap_or_default();
        let b = right["summary"]["mean"].as_f64().unwrap_or_default();
        if lower_is_better {
            a.partial_cmp(&b).expect("means are finite")
        } else {
            b.partial_cmp(&a).expect("means are finite")
        }
    });

    let record_count: usize = series
        .iter()
        .map(|item| item["summary"]["count"].as_u64().unwrap_or_default() as usize)
        .sum();
    let metadata = json!({
        "recordCount": record_count,
        "excludedCount": excluded,
        "skippedGroupCount": skipped_groups,
        "missingValueMessage": Message::new(messages::ANALYSIS_MISSING_EXCLUDED)
            .detail("results without a numeric value are excluded before grouping")
            .to_json(),
        "field": column,
        "labelCode": metric_label_code(column),
        "label": label,
        "unit": unit,
        "group": group,
        "minSamplesPerGroup": min_samples,
        "lowerIsBetter": lower_is_better,
        "methodMessage": Message::new(messages::ANALYSIS_METHOD_GROUPED)
            .detail("per-group mean, median, sample standard deviation, min and max")
            .to_json()
    });

    if series.is_empty() {
        return insufficient(
            "compare_performance_by_group",
            metadata,
            Message::new(messages::ANALYSIS_NOT_ENOUGH_DATA)
                .with("labelCode", metric_label_code(column))
                .with("group", group.clone())
                .with("required", min_samples as u64)
                .with("available", 0_u64)
                .detail(format!(
                    "No {group} group has at least {min_samples} measured {label} result(s) in this workspace."
                )),
        );
    }
    ok(
        "compare_performance_by_group",
        json!({ "status": "ok", "metadata": metadata, "series": series }),
    )
}

/// Concentration against a performance metric, for scatter plots plus a correlation coefficient.
#[tauri::command]
pub fn get_concentration_performance(
    app: AppHandle,
    metric: Option<String>,
    additive_id: Option<String>,
) -> Result<Value, String> {
    let metric = metric.unwrap_or_else(|| "average_friction_coefficient".to_string());
    let (column, label, unit) = describe_metric(&metric)?;
    let connection = open(&app)?;
    let sql = format!(
        "SELECT COALESCE(m.name, a.id), c.concentration_value, c.concentration_unit, r.{column}
         FROM performance_results r
         JOIN experiments e ON e.id = r.experiment_id
         JOIN formulation_components c ON c.formulation_id = e.formulation_id
         JOIN additives a ON a.id = c.additive_id
         LEFT JOIN molecules m ON m.id = a.molecule_id
         WHERE (?1 = '' OR a.id = ?1)"
    );
    let filter = additive_id.unwrap_or_default();
    let mut statement = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare the concentration query: {err}"))?;
    let rows: Vec<(String, Option<f64>, String, Option<f64>)> = statement
        .query_map(params![&filter], |row| {
            Ok((
                row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                row.get::<_, Option<f64>>(1)?,
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                row.get::<_, Option<f64>>(3)?,
            ))
        })
        .map_err(|err| format!("Failed to query concentration against {column}: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read a concentration row: {err}"))?;

    let total = rows.len();
    let mut points = Vec::new();
    let mut concentrations = Vec::new();
    let mut metrics = Vec::new();
    let mut units: BTreeSet<String> = BTreeSet::new();
    for (name, concentration, concentration_unit, value) in rows {
        let (Some(concentration), Some(value)) = (concentration, value) else {
            continue;
        };
        if !concentration.is_finite() || !value.is_finite() {
            continue;
        }
        if !concentration_unit.is_empty() {
            units.insert(concentration_unit.clone());
        }
        concentrations.push(concentration);
        metrics.push(value);
        points.push(json!({
            "label": name,
            "concentration": concentration,
            "concentrationUnit": concentration_unit,
            "value": value
        }));
    }

    let metadata = json!({
        "recordCount": points.len(),
        "excludedCount": total - points.len(),
        "missingValueMessage": Message::new(messages::ANALYSIS_MISSING_PAIR_EXCLUDED)
            .detail("pairs missing either concentration or the metric are excluded")
            .to_json(),
        "field": column,
        "labelCode": metric_label_code(column),
        "label": label,
        "unit": unit,
        "concentrationUnits": units.iter().cloned().collect::<Vec<_>>(),
        "methodMessage": Message::new(messages::ANALYSIS_METHOD_PAIRED)
            .detail("paired concentration/metric scatter with Pearson and Spearman correlation")
            .to_json()
    });

    if points.len() < MIN_ANALYSIS_SAMPLES {
        return insufficient(
            "get_concentration_performance",
            metadata,
            Message::new(messages::ANALYSIS_NOT_ENOUGH_DATA)
                .with("labelCode", metric_label_code(column))
                .with("required", MIN_ANALYSIS_SAMPLES as u64)
                .with("available", points.len() as u64)
                .detail(format!(
                    "Concentration analysis needs at least {MIN_ANALYSIS_SAMPLES} paired records; the workspace has {}.",
                    points.len()
                )),
        );
    }
    // Mixed concentration units would put incomparable numbers on one axis.
    let mixed_units = units.len() > 1;
    ok(
        "get_concentration_performance",
        json!({
            "status": "ok",
            "metadata": metadata,
            // The units are the user's own recorded values and travel as a parameter, never
            // translated: "mol%" must read as "mol%" in every language.
            "warnings": if mixed_units {
                let joined = units.iter().cloned().collect::<Vec<_>>().join(", ");
                messages::to_json_array(&[Message::new(messages::ANALYSIS_MIXED_UNITS)
                    .with("units", joined.clone())
                    .with("count", units.len() as u64)
                    .detail(format!(
                        "Concentrations use more than one unit ({joined}); values are plotted as stored."
                    ))])
            } else {
                json!([])
            },
            "pearson": statistics::pearson(&concentrations, &metrics),
            "spearman": statistics::spearman(&concentrations, &metrics),
            "series": points
        }),
    )
}

/// Correlates every numeric descriptor against a performance metric.
///
/// Mock descriptor records are excluded outright: a coefficient computed against placeholder
/// values would look exactly like a real finding.
#[tauri::command]
pub fn get_descriptor_property_correlation(
    app: AppHandle,
    metric: Option<String>,
    descriptor_set: Option<String>,
    top: Option<usize>,
) -> Result<Value, String> {
    let metric = metric.unwrap_or_else(|| "average_friction_coefficient".to_string());
    let (column, label, unit) = describe_metric(&metric)?;
    let descriptor_set = descriptor_set.unwrap_or_default();
    let top = top.unwrap_or(25).clamp(1, 500);
    let connection = open(&app)?;

    let sql = format!(
        "SELECT d.descriptor_set, d.descriptors_json, r.{column}
         FROM performance_results r
         JOIN experiments e ON e.id = r.experiment_id
         JOIN formulation_components c ON c.formulation_id = e.formulation_id
         JOIN additives a ON a.id = c.additive_id
         JOIN molecule_descriptors d ON d.molecule_id = a.molecule_id
         WHERE d.mode = 'real' AND d.status = 'calculated'
           AND (?1 = '' OR d.descriptor_set = ?1)"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|err| format!("Failed to prepare the correlation query: {err}"))?;
    let rows: Vec<(String, String, Option<f64>)> = statement
        .query_map(params![&descriptor_set], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<f64>>(2)?,
            ))
        })
        .map_err(|err| format!("Failed to query descriptor correlations: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("Failed to read a correlation row: {err}"))?;

    let total = rows.len();
    let mut paired: BTreeMap<String, (Vec<f64>, Vec<f64>)> = BTreeMap::new();
    let mut used = 0_usize;
    for (set, descriptors_json, value) in rows {
        let Some(value) = value.filter(|value| value.is_finite()) else {
            continue;
        };
        let Ok(Value::Object(descriptors)) = serde_json::from_str::<Value>(&descriptors_json)
        else {
            continue;
        };
        used += 1;
        for (key, descriptor_value) in descriptors {
            let Some(descriptor_value) = descriptor_value.as_f64() else {
                continue;
            };
            if !descriptor_value.is_finite() {
                continue;
            }
            let entry = paired.entry(format!("{set}_{key}")).or_default();
            entry.0.push(descriptor_value);
            entry.1.push(value);
        }
    }

    let mut series: Vec<Value> = paired
        .into_iter()
        .filter(|(_, (x, _))| x.len() >= MIN_CORRELATION_SAMPLES)
        .filter_map(|(descriptor, (x, y))| {
            let pearson = statistics::pearson(&x, &y)?;
            Some(json!({
                "descriptor": descriptor,
                "sampleCount": x.len(),
                "pearson": pearson,
                "spearman": statistics::spearman(&x, &y)
            }))
        })
        .collect();
    // Strongest absolute relationship first — sign is reported alongside.
    series.sort_by(|left, right| {
        let a = left["pearson"].as_f64().unwrap_or_default().abs();
        let b = right["pearson"].as_f64().unwrap_or_default().abs();
        b.partial_cmp(&a).expect("coefficients are finite")
    });
    let descriptor_count = series.len();
    series.truncate(top);

    let metadata = json!({
        "recordCount": used,
        "excludedCount": total - used,
        "descriptorCount": descriptor_count,
        "returnedCount": series.len(),
        "missingValueMessage": Message::new(messages::ANALYSIS_MISSING_EXCLUDED)
            .detail("mock and non-calculated descriptor records are excluded, then non-numeric descriptor values are skipped per descriptor")
            .to_json(),
        "field": column,
        "labelCode": metric_label_code(column),
        "label": label,
        "unit": unit,
        "descriptorSet": descriptor_set,
        "minSamplesPerDescriptor": MIN_CORRELATION_SAMPLES,
        "methodMessage": Message::new(messages::ANALYSIS_METHOD_CORRELATION)
            .detail("Pearson product-moment and Spearman rank correlation")
            .to_json()
    });

    if series.is_empty() {
        return insufficient(
            "get_descriptor_property_correlation",
            metadata,
            Message::new(messages::ANALYSIS_NOT_ENOUGH_DATA)
                .with("labelCode", metric_label_code(column))
                .with("required", MIN_CORRELATION_SAMPLES as u64)
                .with("available", used as u64)
                .detail(format!(
                    "Correlation needs at least {MIN_CORRELATION_SAMPLES} molecules with real descriptors and a measured {label}; the workspace has {used} qualifying result(s)."
                )),
        );
    }
    ok(
        "get_descriptor_property_correlation",
        json!({ "status": "ok", "metadata": metadata, "series": series }),
    )
}

fn count(connection: &Connection, table: &str) -> Result<i64, String> {
    let sql = format!("SELECT COUNT(*) FROM {table}");
    connection
        .query_row(&sql, [], |row| row.get(0))
        .map_err(|err| format!("Failed to count {table}: {err}"))
}

fn count_where(connection: &Connection, table: &str, condition: &str) -> Result<i64, String> {
    let sql = format!("SELECT COUNT(*) FROM {table} WHERE {condition}");
    connection
        .query_row(&sql, [], |row| row.get(0))
        .map_err(|err| format!("Failed to count {table} where {condition}: {err}"))
}
