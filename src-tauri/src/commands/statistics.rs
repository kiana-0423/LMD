//! Descriptive statistics and correlation helpers shared by the analysis commands.
//!
//! Everything here works on values already read out of SQLite, so it stays testable without a
//! database and keeps the analysis commands focused on querying.

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub count: usize,
    pub mean: f64,
    pub median: f64,
    pub std_dev: f64,
    pub min: f64,
    pub max: f64,
}

/// Drops non-finite values; the caller reports how many were excluded.
pub fn finite(values: &[Option<f64>]) -> Vec<f64> {
    values
        .iter()
        .filter_map(|value| *value)
        .filter(|value| value.is_finite())
        .collect()
}

pub fn summarize(values: &[f64]) -> Option<Summary> {
    if values.is_empty() {
        return None;
    }
    let count = values.len();
    let mean = values.iter().sum::<f64>() / count as f64;
    let mut sorted = values.to_vec();
    sorted.sort_by(|left, right| left.partial_cmp(right).expect("values are finite"));
    let median = if count.is_multiple_of(2) {
        (sorted[count / 2 - 1] + sorted[count / 2]) / 2.0
    } else {
        sorted[count / 2]
    };
    // Sample standard deviation; a single observation has no spread to report.
    let std_dev = if count > 1 {
        let variance = values
            .iter()
            .map(|value| (value - mean).powi(2))
            .sum::<f64>()
            / (count - 1) as f64;
        variance.sqrt()
    } else {
        0.0
    };
    Some(Summary {
        count,
        mean,
        median,
        std_dev,
        min: sorted[0],
        max: sorted[count - 1],
    })
}

/// Equal-width histogram over the observed range. Returns `None` for an empty input.
pub fn histogram(values: &[f64], bin_count: usize) -> Option<Vec<(f64, f64, usize)>> {
    if values.is_empty() || bin_count == 0 {
        return None;
    }
    let summary = summarize(values)?;
    if (summary.max - summary.min).abs() < f64::EPSILON {
        // Every observation is identical, so a single bin is the honest representation.
        return Some(vec![(summary.min, summary.max, values.len())]);
    }
    let width = (summary.max - summary.min) / bin_count as f64;
    let mut bins = vec![0_usize; bin_count];
    for value in values {
        let mut index = ((value - summary.min) / width).floor() as usize;
        if index >= bin_count {
            index = bin_count - 1;
        }
        bins[index] += 1;
    }
    Some(
        bins.into_iter()
            .enumerate()
            .map(|(index, count)| {
                (
                    summary.min + width * index as f64,
                    summary.min + width * (index + 1) as f64,
                    count,
                )
            })
            .collect(),
    )
}

/// Pearson product-moment correlation. `None` when either side has no variance.
pub fn pearson(left: &[f64], right: &[f64]) -> Option<f64> {
    if left.len() != right.len() || left.len() < 2 {
        return None;
    }
    let n = left.len() as f64;
    let mean_left = left.iter().sum::<f64>() / n;
    let mean_right = right.iter().sum::<f64>() / n;
    let mut covariance = 0.0;
    let mut variance_left = 0.0;
    let mut variance_right = 0.0;
    for (a, b) in left.iter().zip(right.iter()) {
        let da = a - mean_left;
        let db = b - mean_right;
        covariance += da * db;
        variance_left += da * da;
        variance_right += db * db;
    }
    if variance_left <= f64::EPSILON || variance_right <= f64::EPSILON {
        return None;
    }
    Some(covariance / (variance_left.sqrt() * variance_right.sqrt()))
}

/// Spearman rank correlation, using average ranks for ties.
pub fn spearman(left: &[f64], right: &[f64]) -> Option<f64> {
    if left.len() != right.len() || left.len() < 2 {
        return None;
    }
    pearson(&ranks(left), &ranks(right))
}

fn ranks(values: &[f64]) -> Vec<f64> {
    let mut order: Vec<usize> = (0..values.len()).collect();
    order.sort_by(|&a, &b| {
        values[a]
            .partial_cmp(&values[b])
            .expect("values are finite")
    });
    let mut result = vec![0.0; values.len()];
    let mut index = 0;
    while index < order.len() {
        let mut end = index + 1;
        while end < order.len() && (values[order[end]] - values[order[index]]).abs() < f64::EPSILON
        {
            end += 1;
        }
        // Tied observations all take the average of the ranks they span.
        let average = ((index + 1 + end) as f64) / 2.0;
        for slot in &order[index..end] {
            result[*slot] = average;
        }
        index = end;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summary_reports_sample_statistics() {
        let summary = summarize(&[2.0, 4.0, 4.0, 4.0, 5.0, 5.0, 7.0, 9.0]).expect("values present");
        assert_eq!(summary.count, 8);
        assert!((summary.mean - 5.0).abs() < 1e-9);
        assert!((summary.median - 4.5).abs() < 1e-9);
        // Sample standard deviation of this classic series is sqrt(32/7).
        assert!((summary.std_dev - (32.0_f64 / 7.0).sqrt()).abs() < 1e-9);
        assert!((summary.min - 2.0).abs() < 1e-9);
        assert!((summary.max - 9.0).abs() < 1e-9);
    }

    #[test]
    fn pearson_detects_a_perfect_linear_relationship() {
        let x = [1.0, 2.0, 3.0, 4.0, 5.0];
        let y = [2.0, 4.0, 6.0, 8.0, 10.0];
        assert!((pearson(&x, &y).expect("correlation") - 1.0).abs() < 1e-9);
        let inverse = [10.0, 8.0, 6.0, 4.0, 2.0];
        assert!((pearson(&x, &inverse).expect("correlation") + 1.0).abs() < 1e-9);
    }

    #[test]
    fn pearson_returns_none_without_variance() {
        assert!(pearson(&[1.0, 1.0, 1.0], &[1.0, 2.0, 3.0]).is_none());
        assert!(pearson(&[1.0], &[2.0]).is_none());
    }

    #[test]
    fn spearman_captures_monotonic_but_non_linear_relationships() {
        let x = [1.0, 2.0, 3.0, 4.0, 5.0];
        let y = [1.0, 4.0, 9.0, 16.0, 25.0];
        assert!((spearman(&x, &y).expect("correlation") - 1.0).abs() < 1e-9);
        // Pearson is high but not 1 for the same squared relationship.
        assert!(pearson(&x, &y).expect("correlation") < 1.0);
    }

    #[test]
    fn spearman_averages_tied_ranks() {
        let x = [1.0, 2.0, 2.0, 3.0];
        let y = [10.0, 20.0, 20.0, 30.0];
        assert!((spearman(&x, &y).expect("correlation") - 1.0).abs() < 1e-9);
    }

    #[test]
    fn histogram_places_every_value_in_a_bin() {
        let bins = histogram(&[0.0, 1.0, 2.0, 3.0, 4.0], 2).expect("bins");
        assert_eq!(bins.len(), 2);
        assert_eq!(bins.iter().map(|(_, _, count)| count).sum::<usize>(), 5);
    }

    #[test]
    fn histogram_collapses_to_one_bin_when_every_value_is_identical() {
        let bins = histogram(&[3.0, 3.0, 3.0], 5).expect("bins");
        assert_eq!(bins.len(), 1);
        assert_eq!(bins[0].2, 3);
    }

    #[test]
    fn finite_drops_missing_and_non_finite_values() {
        let values = [
            Some(1.0),
            None,
            Some(f64::NAN),
            Some(2.0),
            Some(f64::INFINITY),
        ];
        assert_eq!(finite(&values), vec![1.0, 2.0]);
    }
}
