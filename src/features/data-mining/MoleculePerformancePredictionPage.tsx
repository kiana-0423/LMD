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
        "extreme_pressure_value",
        "pb_value",
        "pd_value",
        "initial_oxidation_temperature_value",
        "initial_decomposition_temperature_value",
      ]}
    />
  );
}
