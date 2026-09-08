-- Generated from schema.rs by scripts/sync_test_schema.py. Do not edit by hand.

CREATE TABLE IF NOT EXISTS molecules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  aliases TEXT,
  smiles_raw TEXT,
  smiles_canonical TEXT,
  inchi TEXT,
  inchi_key TEXT,
  formula TEXT,
  molecular_weight REAL,
  category TEXT,
  tags TEXT,
  molfile TEXT,
  descriptor_json TEXT,
  duplicate_of TEXT,
  import_mode TEXT,
  source TEXT,
  structure_svg_path TEXT,
  mol_file_path TEXT,
  sdf_file_path TEXT,
  pdb_file_path TEXT,
  rdkit_descriptor_status TEXT,
  mordred_descriptor_status TEXT,
  descriptor_ready INTEGER DEFAULT 0,
  source_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS molecule_descriptors (
  id TEXT PRIMARY KEY,
  molecule_id TEXT NOT NULL,
  descriptor_set TEXT NOT NULL,
  descriptor_version TEXT,
  descriptors_json TEXT NOT NULL,
  descriptor_count INTEGER,
  status TEXT NOT NULL,
  mode TEXT,
  error_message TEXT,
  calculated_at TEXT,
  FOREIGN KEY (molecule_id) REFERENCES molecules(id)
);

CREATE TABLE IF NOT EXISTS commercial_products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  category TEXT NOT NULL DEFAULT '' CHECK (category IN ('', 'base_oil', 'additive')),
  general_formula TEXT NOT NULL DEFAULT '',
  manufacturer TEXT NOT NULL DEFAULT '',
  production_date TEXT NOT NULL DEFAULT '',
  batch_number TEXT NOT NULL DEFAULT '',
  product_number TEXT NOT NULL DEFAULT '',
  material_properties_json TEXT NOT NULL DEFAULT '{}',
  supplier TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_commercial_products_created_at
  ON commercial_products(created_at DESC, id DESC);

-- Batch identifiers remain visible wherever commercial materials are selected for a blend.
CREATE VIEW IF NOT EXISTS commercial_product_labels AS
SELECT id, name
  || CASE WHEN manufacturer = '' THEN '' ELSE ' · ' || manufacturer END
  || CASE WHEN product_number = '' THEN '' ELSE ' · ' || product_number END
  || CASE WHEN batch_number = '' THEN '' ELSE ' · ' || batch_number END AS name
FROM commercial_products;

CREATE TABLE IF NOT EXISTS base_oils (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_oil_type TEXT,
  representative_molecule_id TEXT,
  commercial_product_id TEXT UNIQUE REFERENCES commercial_products(id),
  viscosity_40c REAL,
  viscosity_100c REAL,
  viscosity_index REAL,
  density REAL,
  pour_point REAL,
  flash_point REAL,
  supplier TEXT,
  batch_number TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT base_oil_name_is_not_blank CHECK (length(trim(name)) > 0),
  FOREIGN KEY (representative_molecule_id) REFERENCES molecules(id)
);

CREATE TABLE IF NOT EXISTS additives (
  id TEXT PRIMARY KEY,
  molecule_id TEXT,
  commercial_product_id TEXT UNIQUE REFERENCES commercial_products(id),
  function_types TEXT,
  active_elements TEXT,
  typical_concentration_min REAL,
  typical_concentration_max REAL,
  concentration_unit TEXT,
  compatible_base_oils TEXT,
  application_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT additive_has_one_source CHECK (
    (CASE WHEN molecule_id IS NOT NULL AND molecule_id <> '' THEN 1 ELSE 0 END)
    + (CASE WHEN commercial_product_id IS NOT NULL THEN 1 ELSE 0 END) = 1
  ),
  -- A dosing range that runs backwards names no usable dose.
  CONSTRAINT additive_typical_range_is_ordered
    CHECK (
      typical_concentration_min IS NULL
      OR typical_concentration_max IS NULL
      OR typical_concentration_min <= typical_concentration_max
    ),
  FOREIGN KEY (molecule_id) REFERENCES molecules(id)
);

CREATE TABLE IF NOT EXISTS formulations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  preparation_method TEXT,
  preparation_temperature REAL,
  preparation_temperature_unit TEXT,
  preparation_time REAL,
  preparation_time_unit TEXT,
  stability_observation TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT formulation_name_is_not_blank CHECK (length(trim(name)) > 0),
  -- A blend cannot have been prepared for a negative length of time.
  CONSTRAINT formulation_preparation_time_is_not_negative
    CHECK (preparation_time IS NULL OR preparation_time >= 0)
);

CREATE TABLE IF NOT EXISTS formulation_components (
  id TEXT PRIMARY KEY,
  formulation_id TEXT NOT NULL,
  component_role TEXT NOT NULL,
  molecule_id TEXT,
  base_oil_id TEXT,
  additive_id TEXT,
  concentration_value REAL,
  concentration_unit TEXT,
  concentration_standard_value REAL,
  concentration_standard_unit TEXT,
  notes TEXT,
  CONSTRAINT component_role_is_known
    CHECK (component_role IN ('base_oil', 'additive', 'solvent', 'other')),
  -- Exactly one entity, so a recorded concentration is never ambiguous. An empty string counts
  -- as absent: older writers stored '' where they meant NULL.
  CONSTRAINT component_references_exactly_one_entity
    CHECK (
      (CASE WHEN molecule_id IS NOT NULL AND molecule_id <> '' THEN 1 ELSE 0 END)
      + (CASE WHEN base_oil_id IS NOT NULL AND base_oil_id <> '' THEN 1 ELSE 0 END)
      + (CASE WHEN additive_id IS NOT NULL AND additive_id <> '' THEN 1 ELSE 0 END) = 1
    ),
  -- A component present at zero concentration is not a component.
  CONSTRAINT component_concentration_is_positive
    CHECK (concentration_value IS NULL OR concentration_value > 0),
  CONSTRAINT component_standard_concentration_is_positive
    CHECK (concentration_standard_value IS NULL OR concentration_standard_value > 0),
  FOREIGN KEY (formulation_id) REFERENCES formulations(id),
  FOREIGN KEY (molecule_id) REFERENCES molecules(id),
  FOREIGN KEY (base_oil_id) REFERENCES base_oils(id),
  FOREIGN KEY (additive_id) REFERENCES additives(id)
);

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  formulation_id TEXT NOT NULL,
  test_type TEXT,
  test_standard TEXT,
  instrument TEXT,
  upper_material TEXT,
  upper_type TEXT,
  upper_diameter_value REAL,
  upper_diameter_unit TEXT,
  lower_material TEXT,
  lower_type TEXT,
  lower_length_value REAL,
  lower_width_value REAL,
  lower_thickness_value REAL,
  geometry_unit TEXT,
  load_value REAL,
  load_unit TEXT,
  stroke_value REAL,
  stroke_unit TEXT,
  frequency_value REAL,
  frequency_unit TEXT,
  speed_value REAL,
  speed_unit TEXT,
  temperature_value REAL,
  temperature_unit TEXT,
  duration_value REAL,
  duration_unit TEXT,
  humidity REAL,
  test_parameters_json TEXT,
  atmosphere TEXT,
  operator TEXT,
  experiment_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (formulation_id) REFERENCES formulations(id)
);

CREATE TABLE IF NOT EXISTS performance_results (
  id TEXT PRIMARY KEY,
  experiment_id TEXT NOT NULL,
  average_friction_coefficient REAL,
  stable_friction_coefficient REAL,
  wear_scar_width_value REAL,
  wear_scar_width_unit TEXT,
  wear_scar_depth_value REAL,
  wear_scar_depth_unit TEXT,
  wear_scar_diameter_value REAL,
  wear_scar_diameter_unit TEXT,
  initial_oxidation_temperature_value REAL,
  initial_decomposition_temperature_value REAL,
  initial_oxidation_temperature_unit TEXT,
  extreme_pressure_value REAL,
  extreme_pressure_unit TEXT,
  pb_value REAL,
  pd_value REAL,
  viscosity_40c REAL,
  viscosity_100c REAL,
  repeat_count INTEGER,
  std_json TEXT,
  raw_result_json TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- A result was measured over at least one run, or the count was never recorded.
  CONSTRAINT result_repeat_count_is_at_least_one
    CHECK (repeat_count IS NULL OR repeat_count >= 1),
  FOREIGN KEY (experiment_id) REFERENCES experiments(id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  linked_entity_type TEXT NOT NULL,
  linked_entity_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,
  relative_path TEXT NOT NULL,
  description TEXT,
  uploaded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  source_type TEXT,
  title TEXT,
  authors TEXT,
  journal TEXT,
  year INTEGER,
  doi TEXT,
  url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL,
  status TEXT NOT NULL,
  progress REAL,
  total_count INTEGER,
  success_count INTEGER,
  failed_count INTEGER,
  input_json TEXT,
  output_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target TEXT NOT NULL,
  task TEXT NOT NULL,
  algorithm TEXT NOT NULL,
  model_version TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  feature_order TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  sample_count INTEGER NOT NULL,
  feature_count INTEGER NOT NULL,
  trained_at TEXT NOT NULL,
  split_method TEXT NOT NULL DEFAULT 'unknown',
  dataset_mode TEXT NOT NULL DEFAULT 'additive_component',
  interpretation TEXT NOT NULL DEFAULT '',
  group_count INTEGER NOT NULL DEFAULT 0,
  validated INTEGER NOT NULL DEFAULT 0,
  feature_schema_version TEXT NOT NULL DEFAULT '1',
  concentration_basis TEXT NOT NULL DEFAULT 'unrecorded',
  dataset_report_json TEXT NOT NULL DEFAULT '{}',
  dataset_scope_json TEXT NOT NULL DEFAULT '{}',
  molecule_count INTEGER NOT NULL DEFAULT 0,
  domain_json TEXT NOT NULL DEFAULT '{}',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Generated structures live here, not in `molecules`, until a person promotes one. A candidate is
-- a proposal with a provenance; a molecule is a record of the library. Keeping them apart is what
-- lets the library stay a library.
CREATE TABLE IF NOT EXISTS design_candidates (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  name TEXT NOT NULL,
  smiles_canonical TEXT NOT NULL,
  inchi TEXT,
  inchi_key TEXT,
  formula TEXT,
  molecular_weight REAL,
  heavy_atom_count INTEGER,
  template_id TEXT NOT NULL,
  template_family TEXT NOT NULL,
  chemical_classes TEXT NOT NULL DEFAULT '[]',
  substituents_json TEXT NOT NULL DEFAULT '[]',
  seed_ids TEXT NOT NULL DEFAULT '[]',
  generator_version TEXT NOT NULL,
  parameters_json TEXT NOT NULL DEFAULT '{}',
  random_seed INTEGER,
  request_json TEXT NOT NULL DEFAULT '{}',
  validation_status TEXT NOT NULL,
  validation_json TEXT NOT NULL DEFAULT '{}',
  structure_svg TEXT,
  existing_molecule_id TEXT,
  promoted_molecule_id TEXT,
  verification_status TEXT NOT NULL DEFAULT 'not_verified',
  verification_notes TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CONSTRAINT candidate_validation_status_is_known
    CHECK (validation_status IN ('valid', 'rejected')),
  CONSTRAINT candidate_verification_status_is_known
    CHECK (verification_status IN ('not_verified', 'planned', 'verified', 'refuted')),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE TABLE IF NOT EXISTS design_candidate_descriptors (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  descriptor_set TEXT NOT NULL,
  descriptor_version TEXT,
  descriptors_json TEXT NOT NULL,
  descriptor_count INTEGER,
  status TEXT NOT NULL,
  mode TEXT,
  error_message TEXT,
  calculated_at TEXT,
  FOREIGN KEY (candidate_id) REFERENCES design_candidates(id)
);

-- One row per candidate per assessment run. A predicted value is never copied anywhere a
-- measurement lives, and never becomes a training label.
CREATE TABLE IF NOT EXISTS design_predictions (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  model_id TEXT,
  model_name TEXT,
  model_version TEXT,
  feature_schema_version TEXT,
  target TEXT NOT NULL,
  unit TEXT,
  status TEXT NOT NULL,
  predicted_value REAL,
  context_json TEXT NOT NULL DEFAULT '{}',
  assessment_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  CONSTRAINT prediction_status_is_known
    CHECK (status IN ('supported', 'exploratory', 'unavailable')),
  FOREIGN KEY (candidate_id) REFERENCES design_candidates(id),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
);

CREATE INDEX IF NOT EXISTS idx_design_candidates_job_id ON design_candidates(job_id);
CREATE INDEX IF NOT EXISTS idx_design_candidates_inchi_key ON design_candidates(inchi_key);
CREATE INDEX IF NOT EXISTS idx_design_candidates_created_at
  ON design_candidates(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_design_candidate_descriptors_candidate_id
  ON design_candidate_descriptors(candidate_id);
CREATE INDEX IF NOT EXISTS idx_design_predictions_candidate_id
  ON design_predictions(candidate_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);

