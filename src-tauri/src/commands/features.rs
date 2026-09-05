//! The single definition of what a model's features mean.
//!
//! Training, CSV export, and prediction all build their rows here. If they built them separately,
//! a prediction could silently use a different name, order, or unit basis from the one the model
//! was fitted on, and the resulting number would look exactly as trustworthy as a correct one.
//!
//! Two things are defined together because they cannot be separated:
//!
//!  * **Feature construction** — which keys exist, how additive descriptors are combined, and in
//!    what order the columns appear.
//!  * **Concentration semantics** — which recorded units may be compared, which are converted, and
//!    which make a record unusable without extra measurements.
//!
//! ## Concentration units
//!
//! A concentration only means something alongside its unit. `1.0 wt%` and `1.0 ppm` differ by four
//! orders of magnitude, and `1.0 mol%` cannot be turned into either without the molar masses of
//! the whole blend. So units fall into three groups:
//!
//!  * **Mass basis, convertible** — wt%, mass fraction, ppm (by mass), g/kg and their spellings.
//!    These convert to wt% by arithmetic alone.
//!  * **Not convertible here** — mol%, vol%, mg/mL, g/L, molarity. Converting these needs molar
//!    mass or density, which the workspace does not record. Records using them are excluded and
//!    counted, never guessed at.
//!  * **Unrecorded** — a number with no unit. A weighted mean is invariant to a shared positive
//!    scale, so unit-less values still rank and weight correctly *provided every component in the
//!    dataset is unit-less too*. Mixing unit-less and wt% values within one blend, or across one
//!    dataset, is refused.

use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

/// Bumped whenever the meaning, name, or normalization of any feature changes.
///
/// A model records the version it was trained under. Predicting with a model from another version
/// is refused rather than silently producing a number from differently-defined columns.
// Bumped from "3": a schema-3 dataset could still mix `wt%` rows with `none` rows, or
// `unrecorded` rows with `none` rows, because reconciliation only removed unit-less rows when
// mass-percent rows were present. A model fitted from those rows was fitted on a concentration
// column that meant two different things, and no amount of care at prediction time can undo that.
// Schema 4 admits exactly one basis per dataset, so schema-3 models must be retrained.
pub const FEATURE_SCHEMA_VERSION: &str = "4";

/// Feature names that are not descriptors.
pub const FEATURE_CONCENTRATION: &str = "concentration";
pub const FEATURE_ADDITIVE_COUNT: &str = "additive_count";
pub const FEATURE_TOTAL_ADDITIVE_CONCENTRATION: &str = "total_additive_concentration";
pub const FEATURE_BASE_OIL_COUNT: &str = "base_oil_count";
pub const FEATURE_BASE_OIL_TOTAL_CONCENTRATION: &str = "base_oil_total_concentration";
/// Experimental conditions, included only when a dataset scope asks for them. A model whose
/// feature order carries one of these needs the same condition supplied at prediction time.
pub const FEATURE_CONDITION_TEMPERATURE: &str = "condition_temperature_c";
pub const FEATURE_CONDITION_LOAD: &str = "condition_load_n";
pub const CONDITION_FEATURES: [&str; 2] = [FEATURE_CONDITION_TEMPERATURE, FEATURE_CONDITION_LOAD];

/// The six base-oil properties an aggregate row carries, in their stored column order.
pub const BASE_OIL_FEATURES: [&str; 6] = [
    "base_oil_viscosity_40c",
    "base_oil_viscosity_100c",
    "base_oil_viscosity_index",
    "base_oil_density",
    "base_oil_pour_point",
    "base_oil_flash_point",
];

/// What a set of concentrations is expressed in, once resolved.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum ConcentrationBasis {
    /// Every value converted to weight percent.
    MassPercent,
    /// No unit was recorded anywhere. Values are comparable only if the workspace is consistent,
    /// which is stated in the training warnings rather than assumed silently.
    Unrecorded,
    /// Nothing at all was recorded, so there is no basis to speak of.
    #[default]
    None,
}

impl ConcentrationBasis {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MassPercent => "wt%",
            Self::Unrecorded => "unrecorded",
            Self::None => "none",
        }
    }

    /// Reads a stored basis, refusing anything this build does not define.
    ///
    /// Strictness matters more here than anywhere else in this module. The previous version
    /// mapped every unrecognised value — a typo, a truncated write, a basis from a future build —
    /// onto `Unrecorded`, which is itself a meaningful basis. A corrupt row therefore became a
    /// valid one, and the model fitted from it predicted confidently on a semantics nobody chose.
    /// An unreadable basis is now an unusable model, which is the honest outcome.
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "wt%" => Ok(Self::MassPercent),
            "unrecorded" => Ok(Self::Unrecorded),
            "none" => Ok(Self::None),
            other => Err(other.to_string()),
        }
    }

    /// Every basis, in the order a dataset prefers them: most informative first.
    ///
    /// A `wt%` row states a real proportion. An `unrecorded` row states a number whose unit is
    /// unknown but shared. A `none` row states nothing at all. When a dataset contains more than
    /// one, the most informative wins and the rest are excluded and counted — never rescaled, and
    /// never imputed.
    pub const PREFERENCE_ORDER: [Self; 3] = [Self::MassPercent, Self::Unrecorded, Self::None];

    /// Whether a record on this basis may be predicted on by a model fitted on `expected`.
    ///
    /// Equality, and nothing looser. `none` and `wt%` are not interchangeable: a model fitted with
    /// no concentrations at all was fitted on a different feature set from one fitted with them,
    /// and mixing the two produces a number that looks like a prediction and is not.
    pub fn matches(self, expected: Self) -> bool {
        self == expected
    }
}

/// One recorded concentration, classified.
#[derive(Debug, Clone, PartialEq)]
pub enum ConcentrationReading {
    /// Converted to weight percent.
    MassPercent(f64),
    /// A number with no unit.
    Unrecorded(f64),
    /// A unit that cannot be converted without data the workspace does not hold.
    Incompatible { unit: String },
    /// No value recorded.
    Absent,
}

/// Normalizes a unit string so spelling variations do not become different units.
fn canonical_unit(unit: &str) -> String {
    unit.trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|character| !character.is_whitespace() && *character != '.')
        .collect()
}

/// Classifies one recorded concentration.
///
/// The conversion factors are exact by definition: 1 ppm by mass is 1e-4 wt%, 1 g/kg is 0.1 wt%,
/// and a mass fraction is a hundredth of a mass percent.
pub fn read_concentration(value: Option<f64>, unit: &str) -> ConcentrationReading {
    let Some(value) = value.filter(|value| value.is_finite()) else {
        return ConcentrationReading::Absent;
    };
    let canonical = canonical_unit(unit);
    if canonical.is_empty() {
        return ConcentrationReading::Unrecorded(value);
    }
    // Mass basis, convertible by arithmetic alone.
    let factor = match canonical.as_str() {
        "wt%" | "wt-%" | "w/w%" | "%w/w" | "%" | "percent" | "mass%" | "m/m%" | "%m/m"
        | "masspercent" | "weightpercent" | "wtpercent" => Some(1.0),
        "massfraction" | "weightfraction" | "w/w" | "m/m" | "fraction" | "kg/kg" => Some(100.0),
        "ppm" | "ppmw" | "ppm(w)" | "mg/kg" | "wppm" => Some(1.0e-4),
        "ppb" | "ppbw" | "ug/kg" | "µg/kg" => Some(1.0e-7),
        "g/kg" | "‰" | "permille" | "permil" => Some(0.1),
        "mg/g" => Some(0.1),
        "g/g" => Some(100.0),
        _ => None,
    };
    match factor {
        Some(factor) => ConcentrationReading::MassPercent(value * factor),
        // Everything else needs molar mass, density, or the full blend composition.
        None => ConcentrationReading::Incompatible {
            unit: unit.trim().to_string(),
        },
    }
}

/// A test temperature in degrees Celsius, or `None` when the unit is missing or unknown.
///
/// A temperature with no unit is not assumed to be Celsius: 100 °F and 100 °C are different
/// experiments, and a feature built from both would mean nothing.
pub fn read_temperature_celsius(value: Option<f64>, unit: &str) -> Option<f64> {
    let value = value.filter(|value| value.is_finite())?;
    match canonical_unit(unit).as_str() {
        "°c" | "c" | "degc" | "celsius" | "℃" => Some(value),
        "k" | "kelvin" => Some(value - 273.15),
        "°f" | "f" | "degf" | "fahrenheit" | "℉" => Some((value - 32.0) * 5.0 / 9.0),
        _ => None,
    }
}

/// An applied load in newtons, or `None` when the unit is missing or unknown.
///
/// Mass units are read as the force the mass exerts under standard gravity, which is how a
/// four-ball rig labelled in kilograms actually loads the balls.
pub fn read_load_newtons(value: Option<f64>, unit: &str) -> Option<f64> {
    let value = value.filter(|value| value.is_finite())?;
    match canonical_unit(unit).as_str() {
        "n" | "newton" | "newtons" => Some(value),
        "kn" => Some(value * 1000.0),
        "mn" => Some(value / 1000.0),
        "kgf" | "kg" | "kilogram" | "kilograms" => Some(value * 9.80665),
        "gf" | "g" => Some(value * 9.80665 / 1000.0),
        "lbf" | "lb" | "lbs" => Some(value * 4.448_221_615_260_5),
        _ => None,
    }
}

/// Experimental conditions of one measurement, as recorded.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ConditionInput {
    pub test_type: String,
    pub temperature: Option<f64>,
    pub temperature_unit: String,
    pub load: Option<f64>,
    pub load_unit: String,
}

impl ConditionInput {
    /// The condition features, in the model's units. A condition that is absent or in a unit
    /// this build cannot convert is simply not a feature; the caller decides whether that makes
    /// the row unusable.
    pub fn features(&self) -> Map<String, Value> {
        let mut features = Map::new();
        if let Some(celsius) = read_temperature_celsius(self.temperature, &self.temperature_unit) {
            features.insert(FEATURE_CONDITION_TEMPERATURE.to_string(), json!(celsius));
        }
        if let Some(newtons) = read_load_newtons(self.load, &self.load_unit) {
            features.insert(FEATURE_CONDITION_LOAD.to_string(), json!(newtons));
        }
        features
    }
}

/// Which side of a blend a concentration problem concerns.
///
/// A token rather than a label. The English words below exist for the diagnostic detail that
/// travels beside a message code; the wording a user reads comes from the frontend catalogue, so
/// naming the category as data is what lets the sentence be Japanese.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConcentrationCategory {
    Additives,
    BaseOils,
}

impl ConcentrationCategory {
    /// The stable token a translation keys off.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Additives => "additives",
            Self::BaseOils => "baseOils",
        }
    }

    /// English wording, used only inside the untranslated diagnostic detail.
    fn wording(self) -> &'static str {
        match self {
            Self::Additives => "additives",
            Self::BaseOils => "base oils",
        }
    }
}

/// Why a record cannot contribute a row.
///
/// Every variant carries structured values rather than a finished sentence, so the same problem
/// can be stated in any language without the backend knowing which one.
#[derive(Debug, Clone, PartialEq)]
pub enum UnitProblem {
    /// At least one component uses a unit that cannot be converted here.
    Incompatible { units: Vec<String> },
    /// Components use bases that cannot be compared with each other.
    MixedBases,
    /// Some components record a concentration and others do not — including across categories,
    /// where the additives carry values and the base oils do not, or the other way round.
    PartiallyRecorded {
        recorded: ConcentrationCategory,
        recorded_count: usize,
        unrecorded: ConcentrationCategory,
        unrecorded_count: usize,
    },
    /// A value that cannot describe a composition: negative, infinite, or NaN.
    NonPhysical {
        category: ConcentrationCategory,
        value: f64,
    },
    /// Concentrations were recorded, but they sum to zero. A blend that is nothing at all cannot
    /// be weighted, and dividing by that total would produce a fabricated number.
    ZeroTotal { category: ConcentrationCategory },
    /// The record is coherent, but it is not on the basis the model was fitted on.
    BasisMismatch {
        found: ConcentrationBasis,
        expected: ConcentrationBasis,
    },
}

impl UnitProblem {
    /// The stable code a frontend can translate. The detail in [`UnitProblem::describe`] is what
    /// makes the message actionable, so both travel together.
    pub fn code(&self) -> &'static str {
        match self {
            Self::BasisMismatch { .. } => crate::commands::errors::MODEL_BASIS_MISMATCH,
            _ => crate::commands::errors::CONCENTRATION_UNUSABLE,
        }
    }

    /// The same message with its code attached, for anything a user will read.
    pub fn describe_coded(&self, subject: &str) -> String {
        crate::commands::errors::coded(self.code(), self.describe(subject))
    }

    /// The message code for this problem, distinct per variant.
    ///
    /// [`UnitProblem::code`] answers a different question: it says which *error* class this is,
    /// and two variants deliberately share one. This says which *sentence* to render, and no two
    /// variants share that, because they ask the user to do different things.
    pub fn message_code(&self) -> &'static str {
        match self {
            Self::Incompatible { .. } => "concentration.incompatibleUnits",
            Self::MixedBases => "concentration.mixedBases",
            // Two sentences, because they describe two different mistakes: some components of
            // one category left blank, or one whole category left blank beside another that is
            // filled in. A single sentence covering both reads as nonsense in either case.
            Self::PartiallyRecorded {
                recorded,
                unrecorded,
                ..
            } if recorded == unrecorded => "concentration.partiallyRecordedWithin",
            Self::PartiallyRecorded { .. } => "concentration.partiallyRecordedAcross",
            Self::NonPhysical { .. } => "concentration.nonPhysical",
            Self::ZeroTotal { .. } => "concentration.zeroTotal",
            Self::BasisMismatch { .. } => "concentration.basisMismatch",
        }
    }

    /// The problem as a translatable message: a code, the values it needs, and the English prose
    /// as untranslated detail so nothing is lost to a build that does not know the code.
    ///
    /// `subject` is a record's own name and travels as a parameter, never as translated text.
    pub fn to_message(&self, subject: &str) -> crate::commands::messages::Message {
        use crate::commands::messages::Message;
        let message = Message::new(self.message_code()).with("subject", subject);
        match self {
            Self::Incompatible { units } => message.with("units", units.join(", ")),
            Self::MixedBases => message,
            Self::PartiallyRecorded {
                recorded,
                recorded_count,
                unrecorded,
                unrecorded_count,
            } => message
                .with("recorded", recorded.as_str())
                .with("recordedCount", *recorded_count as u64)
                .with("unrecorded", unrecorded.as_str())
                .with("unrecordedCount", *unrecorded_count as u64),
            Self::NonPhysical { category, value } => message
                .with("category", category.as_str())
                .with("value", format!("{value}")),
            Self::ZeroTotal { category } => message.with("category", category.as_str()),
            Self::BasisMismatch { found, expected } => message
                .with("found", found.as_str())
                .with("expected", expected.as_str()),
        }
        .detail(self.describe(subject))
    }

    /// A message a user can act on: it names the unit or the inconsistency, not a code.
    ///
    /// This is the untranslated diagnostic that accompanies [`UnitProblem::to_message`]. It is
    /// English, and deliberately so — it is the text a user quotes when asking for help.
    pub fn describe(&self, subject: &str) -> String {
        match self {
            Self::Incompatible { units } => format!(
                "{subject} records concentrations in {}, which cannot be converted to weight percent without molar mass or density. Re-record these components in wt%, mass fraction, or ppm.",
                units.join(", ")
            ),
            Self::MixedBases => format!(
                "{subject} mixes components with a recorded unit and components without one, so the concentrations cannot be compared. Record a unit for every component."
            ),
            Self::PartiallyRecorded { recorded, recorded_count, unrecorded, unrecorded_count } if recorded == unrecorded => format!(
                "{subject} records a concentration for {recorded_count} of its {} but leaves {unrecorded_count} of them blank, so neither a weighted mean nor a total describes the whole blend. Record a concentration for every component, or for none.",
                recorded.wording()
            ),
            Self::PartiallyRecorded { recorded, recorded_count, unrecorded, unrecorded_count } => format!(
                "{subject} records concentrations for its {recorded_count} {} but not for its {unrecorded_count} {}, so neither a weighted mean nor a total describes the whole blend. Record a concentration for every component, or for none.",
                recorded.wording(),
                unrecorded.wording()
            ),
            Self::NonPhysical { category, value } => format!(
                "{subject} records a concentration of {value} for one of its {}. A concentration must be a finite value of zero or more.",
                category.wording()
            ),
            Self::ZeroTotal { category } => format!(
                "{subject} records concentrations for its {} that add up to zero, so there is no composition to weight.",
                category.wording()
            ),
            Self::BasisMismatch { found, expected } => format!(
                "{subject} records concentrations as '{}', but this model was fitted on concentrations recorded as '{}'. The two are not comparable, so the prediction would not mean what it appears to.",
                found.as_str(),
                expected.as_str()
            ),
        }
    }
}

/// What one category of components — the additives, or the base oils — records.
///
/// The four states are deliberately distinct, because they mean different things and only one of
/// them is an error:
///
///  * `Empty` — the category has no components. A blend with no base oils is a real blend.
///  * `NoValues` — it has components, but not one of them records a concentration.
///  * `Values` — every component records a concentration, all on one basis.
///  * a [`UnitProblem`] — anything else.
#[derive(Debug, Clone, PartialEq)]
pub enum CategoryRecording {
    Empty,
    NoValues {
        count: usize,
    },
    Values {
        basis: ConcentrationBasis,
        values: Vec<f64>,
    },
}

impl CategoryRecording {
    fn basis(&self) -> Option<ConcentrationBasis> {
        match self {
            Self::Values { basis, .. } => Some(*basis),
            _ => None,
        }
    }

    fn len(&self) -> usize {
        match self {
            Self::Empty => 0,
            Self::NoValues { count } => *count,
            Self::Values { values, .. } => values.len(),
        }
    }
}

/// Reads one category's concentrations, keeping the four states apart.
pub fn resolve_category(
    readings: &[ConcentrationReading],
    category: ConcentrationCategory,
) -> Result<CategoryRecording, UnitProblem> {
    if readings.is_empty() {
        return Ok(CategoryRecording::Empty);
    }

    let mut incompatible: Vec<String> = Vec::new();
    let mut mass: Vec<f64> = Vec::new();
    let mut unrecorded: Vec<f64> = Vec::new();
    let mut absent = 0_usize;
    for reading in readings {
        match reading {
            ConcentrationReading::Incompatible { unit } => {
                if !incompatible.contains(unit) {
                    incompatible.push(unit.clone());
                }
            }
            ConcentrationReading::MassPercent(value) => mass.push(*value),
            ConcentrationReading::Unrecorded(value) => unrecorded.push(*value),
            ConcentrationReading::Absent => absent += 1,
        }
    }
    if !incompatible.is_empty() {
        return Err(UnitProblem::Incompatible {
            units: incompatible,
        });
    }
    if !mass.is_empty() && !unrecorded.is_empty() {
        return Err(UnitProblem::MixedBases);
    }
    let recorded = mass.len() + unrecorded.len();
    if recorded == 0 {
        return Ok(CategoryRecording::NoValues {
            count: readings.len(),
        });
    }
    if absent > 0 {
        return Err(UnitProblem::PartiallyRecorded {
            recorded: category,
            recorded_count: recorded,
            unrecorded: category,
            unrecorded_count: absent,
        });
    }

    let (basis, values) = if mass.is_empty() {
        (ConcentrationBasis::Unrecorded, unrecorded)
    } else {
        (ConcentrationBasis::MassPercent, mass)
    };
    // A composition cannot be negative or non-finite, and cannot be nothing at all.
    for value in &values {
        if !value.is_finite() || *value < 0.0 {
            return Err(UnitProblem::NonPhysical {
                category,
                value: *value,
            });
        }
    }
    if values.iter().sum::<f64>() <= 0.0 {
        return Err(UnitProblem::ZeroTotal { category });
    }
    Ok(CategoryRecording::Values { basis, values })
}

/// One blend's concentrations, resolved across every category at once.
#[derive(Debug, Clone, PartialEq)]
pub struct BlendConcentrations {
    /// `MassPercent` or `Unrecorded` when anything was recorded; `None` when nothing was.
    pub basis: ConcentrationBasis,
    pub additives: CategoryRecording,
    pub base_oils: CategoryRecording,
}

impl BlendConcentrations {
    /// The weight each component of a category gets in a weighted mean.
    ///
    /// With nothing recorded, every component weighs the same, which makes the mean a plain mean
    /// rather than a fabricated weighting.
    pub fn weights(category: &CategoryRecording) -> Vec<f64> {
        match category {
            CategoryRecording::Empty => Vec::new(),
            CategoryRecording::NoValues { count } => vec![1.0; *count],
            CategoryRecording::Values { values, .. } => values.clone(),
        }
    }

    /// The total for a category, or `None` when it recorded nothing to total.
    pub fn total(category: &CategoryRecording) -> Option<f64> {
        match category {
            CategoryRecording::Values { values, .. } => Some(values.iter().sum()),
            _ => None,
        }
    }
}

/// Applies the unit policy to a whole blend.
///
/// The cross-category rule is the one that matters: a formulation whose additives carry
/// concentrations while its base oils do not is *partially* recorded, and neither a weighted mean
/// nor a total describes it. A category that is simply absent — a blend with no base oils — is a
/// different thing and is allowed.
pub fn resolve_blend(
    additive_readings: &[ConcentrationReading],
    base_oil_readings: &[ConcentrationReading],
) -> Result<BlendConcentrations, UnitProblem> {
    let additives = resolve_category(additive_readings, ConcentrationCategory::Additives)?;
    let base_oils = resolve_category(base_oil_readings, ConcentrationCategory::BaseOils)?;

    let bases: Vec<ConcentrationBasis> = [additives.basis(), base_oils.basis()]
        .into_iter()
        .flatten()
        .collect();
    if bases.len() == 2 && bases[0] != bases[1] {
        return Err(UnitProblem::MixedBases);
    }

    // One category recorded values while another has components that recorded none.
    let partial = match (&additives, &base_oils) {
        (CategoryRecording::Values { .. }, CategoryRecording::NoValues { count }) => Some((
            ConcentrationCategory::Additives,
            additives.len(),
            ConcentrationCategory::BaseOils,
            *count,
        )),
        (CategoryRecording::NoValues { count }, CategoryRecording::Values { .. }) => Some((
            ConcentrationCategory::BaseOils,
            base_oils.len(),
            ConcentrationCategory::Additives,
            *count,
        )),
        _ => None,
    };
    if let Some((recorded, recorded_count, unrecorded, unrecorded_count)) = partial {
        return Err(UnitProblem::PartiallyRecorded {
            recorded,
            recorded_count,
            unrecorded,
            unrecorded_count,
        });
    }

    Ok(BlendConcentrations {
        basis: bases.first().copied().unwrap_or(ConcentrationBasis::None),
        additives,
        base_oils,
    })
}

/// One additive component of one blend, with its molecule's descriptors already prefixed.
#[derive(Debug, Clone, Default)]
pub struct ComponentInput {
    pub component_id: String,
    pub molecule_id: String,
    pub molecule_name: String,
    /// Canonical SMILES, carried so a model can record which structures it was fitted on.
    pub smiles: String,
    pub concentration: Option<f64>,
    pub concentration_unit: String,
    /// Descriptor features keyed `{set}_{descriptor}`.
    pub descriptors: Map<String, Value>,
}

impl ComponentInput {
    pub fn reading(&self) -> ConcentrationReading {
        read_concentration(self.concentration, &self.concentration_unit)
    }
}

/// One base oil of one blend.
#[derive(Debug, Clone, Default)]
pub struct BaseOilInput {
    pub id: String,
    pub name: String,
    /// Viscosity 40 °C, viscosity 100 °C, viscosity index, density, pour point, flash point.
    pub properties: [Option<f64>; 6],
    pub concentration: Option<f64>,
    pub concentration_unit: String,
}

impl BaseOilInput {
    pub fn reading(&self) -> ConcentrationReading {
        read_concentration(self.concentration, &self.concentration_unit)
    }
}

/// Turns a descriptor JSON document into prefixed numeric features.
///
/// Non-finite and non-numeric entries are dropped here rather than becoming NaN columns later.
pub fn numeric_descriptors(descriptors_json: &str, set: &str) -> Map<String, Value> {
    let mut features = Map::new();
    if let Ok(Value::Object(parsed)) = serde_json::from_str::<Value>(descriptors_json) {
        for (key, value) in parsed {
            if value.as_f64().is_some_and(f64::is_finite) {
                features.insert(format!("{set}_{key}"), value);
            }
        }
    }
    features
}

/// The features of one additive-component row.
///
/// Used by training, by CSV export, and by prediction, so a molecule predicted on is described by
/// exactly the columns the model was fitted on.
///
/// The concentration is included only when the row's basis says one was recorded — a model fitted
/// without concentrations must not suddenly be handed one, and a model fitted with them must not
/// be handed a row that has none.
pub fn additive_component_features(
    component: &ComponentInput,
    concentration: Option<f64>,
) -> Map<String, Value> {
    let mut features = component.descriptors.clone();
    if let Some(value) = concentration.filter(|value| value.is_finite() && *value >= 0.0) {
        features.insert(FEATURE_CONCENTRATION.to_string(), json!(value));
    }
    features
}

/// Resolves one molecule's own concentration, for an additive-component row.
///
/// Returns the value to use, on the model's basis. A basis that does not match is an error rather
/// than a silent omission: leaving the column out would make the row look like one from a model
/// fitted without concentrations.
pub fn additive_component_concentration(
    component: &ComponentInput,
    expected: ConcentrationBasis,
) -> Result<Option<f64>, UnitProblem> {
    let resolved = resolve_category(&[component.reading()], ConcentrationCategory::Additives)?;
    match (&resolved, expected) {
        // Nothing recorded and nothing expected.
        (CategoryRecording::NoValues { .. }, ConcentrationBasis::None) => Ok(None),
        (CategoryRecording::Values { basis, values }, expected) if *basis == expected => {
            Ok(values.first().copied())
        }
        (recording, expected) => Err(UnitProblem::BasisMismatch {
            found: recording.basis().unwrap_or(ConcentrationBasis::None),
            expected,
        }),
    }
}

/// The features of one formulation-aggregate row.
///
/// Additive descriptors are combined by concentration-weighted mean under the `wavg_` prefix — an
/// aggregate is not a molecule's descriptor and must never be mistaken for one. Base-oil
/// properties and composition counts complete the formulation-level view.
///
/// Training and prediction both come through here, so the aggregation a model was fitted on is by
/// construction the aggregation it is later asked about.
pub fn aggregate_features(
    components: &[ComponentInput],
    base_oils: &[BaseOilInput],
) -> Result<(Map<String, Value>, ConcentrationBasis), UnitProblem> {
    let additive_readings: Vec<ConcentrationReading> =
        components.iter().map(ComponentInput::reading).collect();
    let base_readings: Vec<ConcentrationReading> =
        base_oils.iter().map(BaseOilInput::reading).collect();
    let blend = resolve_blend(&additive_readings, &base_readings)?;

    let weights = BlendConcentrations::weights(&blend.additives);
    let mut weighted: BTreeMap<String, (f64, f64)> = BTreeMap::new();
    for (component, weight) in components.iter().zip(weights.iter()) {
        if component.descriptors.is_empty() {
            continue;
        }
        for (key, value) in &component.descriptors {
            let Some(number) = value.as_f64().filter(|value| value.is_finite()) else {
                continue;
            };
            let slot = weighted.entry(key.clone()).or_insert((0.0, 0.0));
            slot.0 += number * weight;
            slot.1 += weight;
        }
    }

    let mut features: Map<String, Value> = weighted
        .into_iter()
        .filter(|(_, (_, weight))| *weight > 0.0)
        .map(|(key, (sum, weight))| (format!("wavg_{key}"), json!(sum / weight)))
        .collect();
    features.insert(
        FEATURE_ADDITIVE_COUNT.to_string(),
        json!(components
            .iter()
            .filter(|component| !component.descriptors.is_empty())
            .count()),
    );
    // A total is only reported when the category actually recorded one; a partial sum would read
    // as a complete composition.
    if let Some(total) = BlendConcentrations::total(&blend.additives) {
        features.insert(
            FEATURE_TOTAL_ADDITIVE_CONCENTRATION.to_string(),
            json!(total),
        );
    }

    let base_weights = BlendConcentrations::weights(&blend.base_oils);
    for (index, name) in BASE_OIL_FEATURES.iter().enumerate() {
        let mut weighted_sum = 0.0;
        let mut weight_total = 0.0;
        let mut plain = 0.0;
        let mut count = 0.0;
        for (oil, weight) in base_oils.iter().zip(base_weights.iter()) {
            let Some(value) = oil.properties[index].filter(|value| value.is_finite()) else {
                continue;
            };
            plain += value;
            count += 1.0;
            if *weight > 0.0 {
                weighted_sum += value * weight;
                weight_total += weight;
            }
        }
        if weight_total > 0.0 {
            features.insert(name.to_string(), json!(weighted_sum / weight_total));
        } else if count > 0.0 {
            features.insert(name.to_string(), json!(plain / count));
        }
    }
    features.insert(FEATURE_BASE_OIL_COUNT.to_string(), json!(base_oils.len()));
    if let Some(total) = BlendConcentrations::total(&blend.base_oils) {
        features.insert(
            FEATURE_BASE_OIL_TOTAL_CONCENTRATION.to_string(),
            json!(total),
        );
    }

    Ok((features, blend.basis))
}

/// Orders a row's values by a model's stored feature order, reporting what is missing.
///
/// Prediction must never let a missing column become an imputed median that reads like a real
/// measurement, so the caller is handed the gap rather than a filled-in value.
pub fn order_features(
    features: &Map<String, Value>,
    feature_order: &[String],
) -> (Map<String, Value>, Vec<String>) {
    let mut ordered = Map::new();
    let mut missing = Vec::new();
    for key in feature_order {
        match features.get(key) {
            Some(value) => {
                ordered.insert(key.clone(), value.clone());
            }
            None => missing.push(key.clone()),
        }
    }
    (ordered, missing)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn component(name: &str, weight: f64, value: Option<f64>, unit: &str) -> ComponentInput {
        let mut descriptors = Map::new();
        descriptors.insert("rdkit_MolWt".to_string(), json!(weight));
        ComponentInput {
            component_id: format!("c-{name}"),
            molecule_id: format!("m-{name}"),
            molecule_name: name.to_string(),
            concentration: value,
            concentration_unit: unit.to_string(),
            descriptors,
            ..ComponentInput::default()
        }
    }

    fn base_oil(value: Option<f64>, unit: &str) -> BaseOilInput {
        BaseOilInput {
            properties: [Some(32.0), Some(6.0), Some(135.0), Some(0.83), None, None],
            concentration: value,
            concentration_unit: unit.to_string(),
            ..BaseOilInput::default()
        }
    }

    // --- unit conversion ------------------------------------------------------------------

    #[test]
    fn weight_percent_and_mass_fraction_are_the_same_quantity_on_different_scales() {
        // 0.01 as a mass fraction is 1 wt%: the same physical amount.
        assert_eq!(
            read_concentration(Some(1.0), "wt%"),
            ConcentrationReading::MassPercent(1.0)
        );
        assert_eq!(
            read_concentration(Some(0.01), "mass fraction"),
            ConcentrationReading::MassPercent(1.0)
        );
        assert_eq!(
            read_concentration(Some(1.0), "  WT %  "),
            ConcentrationReading::MassPercent(1.0)
        );
    }

    #[test]
    fn ppm_converts_to_weight_percent_by_its_definition() {
        // 10 000 ppm by mass is 1 wt%.
        assert_eq!(
            read_concentration(Some(10_000.0), "ppm"),
            ConcentrationReading::MassPercent(1.0)
        );
        assert_eq!(
            read_concentration(Some(10_000.0), "mg/kg"),
            ConcentrationReading::MassPercent(1.0)
        );
        assert_eq!(
            read_concentration(Some(10.0), "g/kg"),
            ConcentrationReading::MassPercent(1.0)
        );
    }

    #[test]
    fn units_that_need_molar_mass_or_density_are_refused_rather_than_guessed() {
        for unit in ["mol%", "vol%", "v/v%", "mg/mL", "g/L", "mmol/L", "ppmv"] {
            assert!(
                matches!(
                    read_concentration(Some(1.0), unit),
                    ConcentrationReading::Incompatible { .. }
                ),
                "{unit} must not be converted"
            );
        }
    }

    #[test]
    fn a_value_without_a_unit_is_marked_rather_than_assumed_to_be_weight_percent() {
        assert_eq!(
            read_concentration(Some(2.5), ""),
            ConcentrationReading::Unrecorded(2.5)
        );
        assert_eq!(
            read_concentration(None, "wt%"),
            ConcentrationReading::Absent
        );
    }

    // --- the four states of one category ---------------------------------------------------

    #[test]
    fn an_absent_category_is_not_the_same_as_one_that_recorded_nothing() {
        // (a) no components at all.
        assert_eq!(
            resolve_category(&[], ConcentrationCategory::BaseOils).expect("resolves"),
            CategoryRecording::Empty
        );
        // (b) components that exist but record no concentration.
        assert_eq!(
            resolve_category(
                &[ConcentrationReading::Absent, ConcentrationReading::Absent],
                ConcentrationCategory::Additives
            )
            .expect("resolves"),
            CategoryRecording::NoValues { count: 2 }
        );
    }

    #[test]
    fn a_fully_recorded_category_reports_its_basis_and_values() {
        // (c) every component records a concentration on one basis.
        let recording = resolve_category(
            &[
                ConcentrationReading::MassPercent(1.0),
                ConcentrationReading::MassPercent(3.0),
            ],
            ConcentrationCategory::Additives,
        )
        .expect("resolves");
        assert_eq!(
            recording,
            CategoryRecording::Values {
                basis: ConcentrationBasis::MassPercent,
                values: vec![1.0, 3.0]
            }
        );
    }

    #[test]
    fn a_partially_recorded_category_is_refused() {
        // (d) some record, some do not.
        let problem = resolve_category(
            &[
                ConcentrationReading::MassPercent(1.0),
                ConcentrationReading::Absent,
            ],
            ConcentrationCategory::Additives,
        )
        .expect_err("a partially recorded category must not resolve");
        assert!(matches!(problem, UnitProblem::PartiallyRecorded { .. }));
        let message = problem.describe("Formulation f-1");
        assert_eq!(
            problem.message_code(),
            "concentration.partiallyRecordedWithin"
        );
        assert!(message.contains("1 of its additives"), "{message}");
        assert!(message.contains("leaves 1 of them blank"), "{message}");
    }

    #[test]
    fn a_category_mixing_recorded_and_unrecorded_units_is_refused() {
        let problem = resolve_category(
            &[
                ConcentrationReading::MassPercent(1.0),
                ConcentrationReading::Unrecorded(3.0),
            ],
            ConcentrationCategory::Additives,
        )
        .expect_err("a mixed blend must not resolve");
        assert_eq!(problem, UnitProblem::MixedBases);
        assert!(problem.describe("Formulation f-1").contains("f-1"));
    }

    #[test]
    fn a_category_containing_an_unconvertible_unit_names_that_unit() {
        let problem = resolve_category(
            &[
                ConcentrationReading::MassPercent(1.0),
                ConcentrationReading::Incompatible {
                    unit: "mol%".to_string(),
                },
            ],
            ConcentrationCategory::Additives,
        )
        .expect_err("an unconvertible unit must not resolve");
        let message = problem.describe("Formulation f-2");
        assert!(message.contains("mol%"), "{message}");
        assert!(message.contains("molar mass"), "{message}");
    }

    // --- nonphysical values ----------------------------------------------------------------

    #[test]
    fn a_negative_concentration_is_refused() {
        let problem = resolve_category(
            &[
                ConcentrationReading::MassPercent(-1.0),
                ConcentrationReading::MassPercent(3.0),
            ],
            ConcentrationCategory::Additives,
        )
        .expect_err("a negative concentration cannot describe a blend");
        assert!(matches!(problem, UnitProblem::NonPhysical { .. }));
        assert!(problem.describe("Formulation f-3").contains("-1"));
    }

    #[test]
    fn concentrations_that_add_up_to_nothing_are_refused() {
        let problem = resolve_category(
            &[
                ConcentrationReading::MassPercent(0.0),
                ConcentrationReading::MassPercent(0.0),
            ],
            ConcentrationCategory::Additives,
        )
        .expect_err("an all-zero blend has no composition to weight");
        assert!(matches!(problem, UnitProblem::ZeroTotal { .. }));
        assert!(problem
            .describe("Formulation f-4")
            .contains("add up to zero"));
    }

    #[test]
    fn a_non_finite_concentration_never_reaches_a_feature() {
        // `read_concentration` filters these out at the source, so they arrive as Absent rather
        // than as a NaN weight.
        assert_eq!(
            read_concentration(Some(f64::NAN), "wt%"),
            ConcentrationReading::Absent
        );
        assert_eq!(
            read_concentration(Some(f64::INFINITY), "wt%"),
            ConcentrationReading::Absent
        );
        // A NaN that somehow reached the resolver directly is still refused.
        let problem = resolve_category(
            &[ConcentrationReading::MassPercent(f64::NAN)],
            ConcentrationCategory::Additives,
        )
        .expect_err("NaN is not a concentration");
        assert!(matches!(problem, UnitProblem::NonPhysical { .. }));
    }

    // --- the cross-category rule -------------------------------------------------------------

    #[test]
    fn additives_with_values_and_base_oils_without_are_partially_recorded() {
        let problem = resolve_blend(
            &[ConcentrationReading::MassPercent(1.0)],
            &[ConcentrationReading::Absent],
        )
        .expect_err("half a composition is not a composition");
        assert!(matches!(problem, UnitProblem::PartiallyRecorded { .. }));
        let message = problem.describe("Formulation f-5");
        assert!(message.contains("additives"), "{message}");
        assert!(message.contains("base oils"), "{message}");
    }

    #[test]
    fn base_oils_with_values_and_additives_without_are_partially_recorded() {
        let problem = resolve_blend(
            &[ConcentrationReading::Absent],
            &[ConcentrationReading::MassPercent(96.0)],
        )
        .expect_err("half a composition is not a composition");
        assert!(matches!(problem, UnitProblem::PartiallyRecorded { .. }));
    }

    #[test]
    fn a_blend_with_no_base_oils_at_all_is_not_partially_recorded() {
        // An absent category is a shape, not an omission.
        let blend = resolve_blend(&[ConcentrationReading::MassPercent(1.0)], &[])
            .expect("a blend with no base oils resolves");
        assert_eq!(blend.basis, ConcentrationBasis::MassPercent);
        assert_eq!(blend.base_oils, CategoryRecording::Empty);
    }

    #[test]
    fn categories_recorded_on_different_bases_are_refused() {
        let problem = resolve_blend(
            &[ConcentrationReading::MassPercent(1.0)],
            &[ConcentrationReading::Unrecorded(96.0)],
        )
        .expect_err("wt% additives and unit-less base oils are not comparable");
        assert_eq!(problem, UnitProblem::MixedBases);
    }

    #[test]
    fn a_blend_that_records_nothing_anywhere_has_no_basis() {
        let blend = resolve_blend(
            &[ConcentrationReading::Absent, ConcentrationReading::Absent],
            &[ConcentrationReading::Absent],
        )
        .expect("nothing recorded is still resolvable");
        assert_eq!(blend.basis, ConcentrationBasis::None);
        assert_eq!(
            BlendConcentrations::weights(&blend.additives),
            vec![1.0, 1.0],
            "with nothing recorded every component weighs the same"
        );
        assert_eq!(
            BlendConcentrations::total(&blend.additives),
            None,
            "a total of nothing is not zero"
        );
    }

    // --- aggregation ---------------------------------------------------------------------------

    #[test]
    fn ppm_and_weight_percent_components_agree_once_converted() {
        // 1 wt% and 30 000 ppm (3 wt%) must weight exactly as 1 and 3 wt% would.
        let blend = [
            component("a", 100.0, Some(1.0), "wt%"),
            component("b", 900.0, Some(30_000.0), "ppm"),
        ];
        let (features, basis) = aggregate_features(&blend, &[]).expect("the blend resolves");
        assert_eq!(basis, ConcentrationBasis::MassPercent);
        // (100*1 + 900*3) / 4 = 700
        assert_eq!(features["wavg_rdkit_MolWt"].as_f64(), Some(700.0));
        assert_eq!(
            features[FEATURE_TOTAL_ADDITIVE_CONCENTRATION].as_f64(),
            Some(4.0)
        );
    }

    #[test]
    fn an_aggregate_never_publishes_an_unprefixed_descriptor_name() {
        let blend = [component("a", 100.0, Some(1.0), "wt%")];
        let (features, _) = aggregate_features(&blend, &[]).expect("the blend resolves");
        assert!(features.contains_key("wavg_rdkit_MolWt"));
        assert!(
            !features.contains_key("rdkit_MolWt"),
            "a weighted mean is not a molecule's descriptor"
        );
    }

    #[test]
    fn an_aggregate_reports_the_base_oil_properties_it_was_given() {
        let blend = [component("a", 100.0, Some(1.0), "wt%")];
        let (features, _) =
            aggregate_features(&blend, &[base_oil(Some(99.0), "wt%")]).expect("the blend resolves");
        let close = |key: &str, expected: f64| {
            let actual = features[key].as_f64().expect("a numeric feature");
            assert!(
                (actual - expected).abs() < 1e-9,
                "{key}: {actual} is not {expected}"
            );
        };
        close("base_oil_viscosity_40c", 32.0);
        close("base_oil_density", 0.83);
        assert!(!features.contains_key("base_oil_pour_point"));
        assert_eq!(features[FEATURE_BASE_OIL_COUNT].as_f64(), Some(1.0));
        assert_eq!(
            features[FEATURE_BASE_OIL_TOTAL_CONCENTRATION].as_f64(),
            Some(99.0)
        );
    }

    #[test]
    fn an_aggregate_that_records_nothing_omits_both_totals() {
        // Reporting a total of zero would read as "this blend is nothing", which is not what an
        // unrecorded composition means.
        let blend = [
            component("a", 100.0, None, ""),
            component("b", 900.0, None, ""),
        ];
        let (features, basis) =
            aggregate_features(&blend, &[base_oil(None, "")]).expect("the blend resolves");
        assert_eq!(basis, ConcentrationBasis::None);
        assert!(!features.contains_key(FEATURE_TOTAL_ADDITIVE_CONCENTRATION));
        assert!(!features.contains_key(FEATURE_BASE_OIL_TOTAL_CONCENTRATION));
        // Equal weighting, so the mean is a plain mean rather than a fabricated weighting.
        assert_eq!(features["wavg_rdkit_MolWt"].as_f64(), Some(500.0));
    }

    #[test]
    fn training_and_prediction_build_identical_features_from_identical_input() {
        // The property that makes a prediction trustworthy: the same blend produces the same
        // columns and the same numbers, whichever caller asked.
        let blend = [
            component("a", 100.0, Some(1.0), "wt%"),
            component("b", 900.0, Some(3.0), "wt%"),
        ];
        let oils = [base_oil(Some(96.0), "wt%")];
        let (training, training_basis) = aggregate_features(&blend, &oils).expect("resolves");
        let (prediction, prediction_basis) = aggregate_features(&blend, &oils).expect("resolves");
        assert_eq!(training, prediction);
        assert_eq!(training_basis, prediction_basis);

        let single = additive_component_features(&blend[0], Some(1.0));
        let repeated = additive_component_features(&blend[0], Some(1.0));
        assert_eq!(single, repeated);
        assert_eq!(single[FEATURE_CONCENTRATION].as_f64(), Some(1.0));
    }

    // --- basis parity at prediction time -------------------------------------------------------

    #[test]
    fn a_basis_only_matches_itself() {
        assert!(ConcentrationBasis::MassPercent.matches(ConcentrationBasis::MassPercent));
        // The rule this replaces treated these as interchangeable, which let a model fitted
        // without concentrations answer a question asked with them.
        assert!(!ConcentrationBasis::MassPercent.matches(ConcentrationBasis::None));
        assert!(!ConcentrationBasis::None.matches(ConcentrationBasis::MassPercent));
        assert!(!ConcentrationBasis::MassPercent.matches(ConcentrationBasis::Unrecorded));
    }

    #[test]
    fn every_basis_round_trips_through_its_stored_spelling() {
        for basis in ConcentrationBasis::PREFERENCE_ORDER {
            assert_eq!(ConcentrationBasis::parse(basis.as_str()), Ok(basis));
        }
    }

    #[test]
    fn an_unknown_stored_basis_is_refused_rather_than_reinterpreted() {
        // The rule this replaces mapped anything unrecognised onto `Unrecorded`, which is a real
        // basis with real semantics. A truncated write, a typo, or a value from a newer build
        // therefore became a usable model fitted on a semantics nobody chose.
        for value in ["", "wt", "WT%", "mol%", "unrecorded ", "percent", "\u{0}"] {
            assert_eq!(
                ConcentrationBasis::parse(value),
                Err(value.to_string()),
                "{value:?} must not be reinterpreted as a known basis"
            );
        }
    }

    #[test]
    fn a_none_basis_model_refuses_a_mass_percent_candidate() {
        let molecule = component("a", 100.0, Some(1.0), "wt%");

        let problem = additive_component_concentration(&molecule, ConcentrationBasis::None)
            .expect_err("a model fitted without concentrations cannot use one");

        assert_eq!(
            problem,
            UnitProblem::BasisMismatch {
                found: ConcentrationBasis::MassPercent,
                expected: ConcentrationBasis::None
            }
        );
        let message = problem.describe("'Additive A'");
        assert!(message.contains("wt%"), "{message}");
        assert!(message.contains("none"), "{message}");
    }

    #[test]
    fn a_mass_percent_model_refuses_a_candidate_with_no_concentration() {
        let molecule = component("a", 100.0, None, "");

        let problem = additive_component_concentration(&molecule, ConcentrationBasis::MassPercent)
            .expect_err("a model fitted on concentrations needs one");

        assert!(matches!(problem, UnitProblem::BasisMismatch { .. }));
    }

    #[test]
    fn a_matching_basis_yields_the_converted_value() {
        let molecule = component("a", 100.0, Some(20_000.0), "ppm");

        let value = additive_component_concentration(&molecule, ConcentrationBasis::MassPercent)
            .expect("the bases match");

        assert_eq!(value, Some(2.0), "20 000 ppm is 2 wt%");
    }

    #[test]
    fn a_none_basis_model_accepts_a_candidate_with_no_concentration() {
        let molecule = component("a", 100.0, None, "");

        let value = additive_component_concentration(&molecule, ConcentrationBasis::None)
            .expect("the bases match");

        assert_eq!(value, None);
        assert!(!additive_component_features(&molecule, value).contains_key(FEATURE_CONCENTRATION));
    }

    #[test]
    fn a_negative_prediction_concentration_is_refused() {
        let molecule = component("a", 100.0, Some(-2.0), "wt%");

        let problem = additive_component_concentration(&molecule, ConcentrationBasis::MassPercent)
            .expect_err("a negative concentration is not a composition");

        assert!(matches!(problem, UnitProblem::NonPhysical { .. }));
    }

    #[test]
    fn a_zero_prediction_concentration_is_refused() {
        let molecule = component("a", 100.0, Some(0.0), "wt%");

        let problem = additive_component_concentration(&molecule, ConcentrationBasis::MassPercent)
            .expect_err("a molecule present at nothing is not a screening candidate");

        assert!(matches!(problem, UnitProblem::ZeroTotal { .. }));
    }

    // --- experimental conditions ---------------------------------------------------------------

    #[test]
    fn temperatures_convert_to_celsius_only_when_the_unit_says_what_they_are() {
        assert_eq!(read_temperature_celsius(Some(80.0), "°C"), Some(80.0));
        assert_eq!(read_temperature_celsius(Some(353.15), "K"), Some(80.0));
        let fahrenheit = read_temperature_celsius(Some(176.0), "°F").expect("converts");
        assert!((fahrenheit - 80.0).abs() < 1e-9);
        // No unit is not Celsius by default: it is not a temperature this build can use.
        assert_eq!(read_temperature_celsius(Some(80.0), ""), None);
        assert_eq!(read_temperature_celsius(Some(80.0), "bar"), None);
        assert_eq!(read_temperature_celsius(None, "°C"), None);
    }

    #[test]
    fn loads_convert_to_newtons_by_definition() {
        assert_eq!(read_load_newtons(Some(392.0), "N"), Some(392.0));
        assert_eq!(read_load_newtons(Some(0.392), "kN"), Some(392.0));
        let kilograms = read_load_newtons(Some(40.0), "kg").expect("converts");
        assert!((kilograms - 392.266).abs() < 1e-3);
        assert_eq!(read_load_newtons(Some(392.0), ""), None);
        assert_eq!(read_load_newtons(Some(392.0), "MPa"), None);
    }

    #[test]
    fn condition_features_carry_only_the_conditions_that_could_be_read() {
        let full = ConditionInput {
            test_type: "four-ball".to_string(),
            temperature: Some(75.0),
            temperature_unit: "°C".to_string(),
            load: Some(392.0),
            load_unit: "N".to_string(),
        };
        let features = full.features();
        assert_eq!(features[FEATURE_CONDITION_TEMPERATURE].as_f64(), Some(75.0));
        assert_eq!(features[FEATURE_CONDITION_LOAD].as_f64(), Some(392.0));

        let partial = ConditionInput {
            temperature: Some(75.0),
            ..ConditionInput::default()
        };
        assert!(
            partial.features().is_empty(),
            "a unit-less temperature is not a feature"
        );
    }

    #[test]
    fn ordering_reports_the_columns_a_row_could_not_supply() {
        let mut features = Map::new();
        features.insert("b".to_string(), json!(2));
        features.insert("a".to_string(), json!(1));
        let order = vec!["a".to_string(), "b".to_string(), "c".to_string()];

        let (ordered, missing) = order_features(&features, &order);

        assert_eq!(ordered.keys().collect::<Vec<_>>(), vec!["a", "b"]);
        assert_eq!(missing, vec!["c".to_string()]);
    }
}
