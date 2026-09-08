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
        "average_friction_coefficient",
        "stable_friction_coefficient",
        "wear_scar_diameter_value",
        "wear_scar_width_value",
        "viscosity_40c",
        "viscosity_100c",
      ]}
    />
  );
}
