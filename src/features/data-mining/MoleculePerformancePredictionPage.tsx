import ModelWorkbench from "./ModelWorkbench";

/**
 * Molecule-level prediction: one row per additive molecule, at its own concentration.
 *
 * The dataset mode is fixed here rather than offered as a choice, because the prediction controls
 * a page shows have to match the kind of model it trains.
 */
export default function MoleculePerformancePredictionPage() {
  return (
    <ModelWorkbench
      titleKey="model.pageMoleculeTitle"
      descriptionKey="model.pageMoleculeDescription"
      datasetMode="additive_component"
      targets={[
        "average_friction_coefficient",
        "stable_friction_coefficient",
        "wear_scar_diameter_value",
        "wear_scar_width_value"
      ]}
    />
  );
}
