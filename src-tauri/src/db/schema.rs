pub const INIT_SCHEMA_SQL: &str = r#"
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

CREATE TABLE IF NOT EXISTS base_oils (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_oil_type TEXT,
  representative_molecule_id TEXT,
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
  FOREIGN KEY (representative_molecule_id) REFERENCES molecules(id)
);

CREATE TABLE IF NOT EXISTS additives (
  id TEXT PRIMARY KEY,
  molecule_id TEXT NOT NULL,
  function_types TEXT,
  active_elements TEXT,
  typical_concentration_min REAL,
  typical_concentration_max REAL,
  concentration_unit TEXT,
  compatible_base_oils TEXT,
  application_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
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
  updated_at TEXT NOT NULL
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

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);

"#;
