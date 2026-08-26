/**
 * The write payloads the interface sends.
 *
 * These used to live in `api.mock.ts`, which meant the production API layer imported its request
 * types from the browser demo — so removing the demo from a desktop build would have removed the
 * type definitions with it. They are contracts with the Rust commands, and belong beside them.
 */

export type CreateBaseOilPayload = {
  name: string;
  baseOilType?: string;
  viscosity40c?: number;
  viscosity100c?: number;
  viscosityIndex?: number;
  density?: number;
  pourPoint?: number;
  flashPoint?: number;
  supplier?: string;
  batchNumber?: string;
  notes?: string;
  representativeMoleculeId?: string;
};

export type CreateAdditivePayload = {
  moleculeId: string;
  functionTypes: string[];
  activeElements?: string[];
  typicalConcentrationMin?: number;
  typicalConcentrationMax?: number;
  concentrationUnit?: string;
  compatibleBaseOils?: string[];
  applicationNotes?: string;
};

export type CreateFormulationComponentPayload = {
  componentRole: "base_oil" | "additive" | "solvent" | "other";
  moleculeId?: string;
  baseOilId?: string;
  additiveId?: string;
  concentrationValue?: number;
  concentrationUnit?: string;
  notes?: string;
};

export type CreateFormulationPayload = {
  name: string;
  components: CreateFormulationComponentPayload[];
  preparationMethod?: string;
  preparationTemperature?: number;
  preparationTemperatureUnit?: string;
  preparationTime?: number;
  preparationTimeUnit?: string;
  stabilityObservation?: string;
  notes?: string;
};

/**
 * One test run and its measurements, as the entry screen collects them.
 *
 * Sent to `save_experiment_with_performance` as a single payload, because the two records are
 * written in one transaction. `testType` is required: an experiment nobody can say the method of
 * cannot be interpreted later.
 */
export type ExperimentPerformancePayload = {
  formulationId: string;
  testType: string;
  testStandard?: string;
  instrument?: string;
  upperMaterial?: string;
  lowerMaterial?: string;
  loadValue?: number;
  loadUnit?: string;
  temperatureValue?: number;
  temperatureUnit?: string;
  durationValue?: number;
  durationUnit?: string;
  operator?: string;
  experimentDate?: string;
  notes?: string;
  averageFrictionCoefficient?: number;
  stableFrictionCoefficient?: number;
  wearScarDiameterValue?: number;
  initialOxidationTemperatureValue?: number;
  extremePressureValue?: number;
  repeatCount?: number;
};

export type SaveMoleculeWithRequiredDescriptorsPayload = {
  name: string;
  smiles: string;
  aliases?: string;
  category?: string;
  additiveFunctionTags?: string[];
  dataSource?: string;
  notes?: string;
};
