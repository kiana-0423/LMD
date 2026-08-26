import ModelWorkbench from "./ModelWorkbench";

/**
 * Formulation-level prediction: one row per measured blend, with additive descriptors combined
 * across the whole mixture.
 *
 * A page called "Formulation Prediction" must train a formulation-level model, and must ask for a
 * whole blend rather than a single molecule.
 */
export default function FormulationPredictionPage() {
  return (
    <ModelWorkbench
      titleKey="model.pageFormulationTitle"
      descriptionKey="model.pageFormulationDescription"
      datasetMode="formulation_aggregate"
      targets={[
        "initial_oxidation_temperature_value",
        "extreme_pressure_value",
        "pb_value",
        "pd_value"
      ]}
    />
  );
}
