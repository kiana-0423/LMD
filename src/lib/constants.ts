import type { MoleculeCategory } from "../types";

export const APP_NAME = "润滑材料数据库";
export const APP_NAME_CN = "润滑材料数据库与智能设计软件";

export const formalRoutes = [
  { key: "/dashboard", label: "仪表盘", group: "仪表盘" },
  { key: "/molecules", label: "分子库", group: "数据库" },
  { key: "/descriptors", label: "描述符中心", group: "数据库" },
  { key: "/base-additive", label: "基础油/添加剂库", group: "数据库" },
  { key: "/formulations", label: "配方库", group: "数据库" },
  { key: "/experiments", label: "实验与性能", group: "数据库" },
  { key: "/molecule-entry", label: "分子录入", group: "录入" },
  { key: "/molecule-sketcher", label: "分子绘画", group: "录入" },
  { key: "/formulation-entry", label: "配方录入", group: "录入" },
  { key: "/data-mining/molecule-performance", label: "分子性能预测", group: "数据挖掘" },
  { key: "/data-mining/formulation-prediction", label: "配方预测", group: "数据挖掘" },
  { key: "/data-mining/molecule-design", label: "分子设计", group: "数据挖掘" },
  { key: "/import-export", label: "导入/导出", group: "系统" }
] as const;

export const moleculeCategories: MoleculeCategory[] = [
  "base_oil_representative",
  "additive",
  "solvent",
  "candidate",
  "other"
];

export const additiveFunctionTags = [
  "antioxidant",
  "antiwear",
  "extreme_pressure",
  "friction_modifier",
  "corrosion_inhibitor",
  "dispersant",
  "detergent",
  "viscosity_modifier",
  "pour_point_depressant"
];

export const moleculeCategoryLabels: Record<MoleculeCategory, string> = {
  base_oil_representative: "基础油代表分子",
  additive: "添加剂",
  solvent: "溶剂",
  candidate: "候选分子",
  other: "其他"
};

export const additiveFunctionLabels: Record<string, string> = {
  antioxidant: "抗氧剂",
  antiwear: "抗磨剂",
  extreme_pressure: "极压剂",
  friction_modifier: "摩擦改进剂",
  corrosion_inhibitor: "腐蚀抑制剂",
  dispersant: "分散剂",
  detergent: "清净剂",
  viscosity_modifier: "黏度指数改进剂",
  pour_point_depressant: "降凝剂"
};

export const descriptorStatusLabels: Record<string, string> = {
  calculated: "已计算",
  mock: "模拟",
  failed: "失败",
  pending: "待计算",
  missing: "缺失",
  real: "真实",
  ready: "就绪",
  attention: "需处理"
};

export const commonOptionLabels: Record<string, string> = {
  base_oil: "基础油",
  additive: "添加剂",
  solvent: "溶剂",
  other: "其他",
  stirring: "搅拌",
  ultrasonication: "超声",
  heating: "加热",
  "rdkit only": "仅 RDKit",
  "mordred only": "仅 Mordred",
  both: "RDKit + Mordred",
  balanced: "综合平衡",
  "minimum friction": "最低摩擦",
  "minimum wear": "最低磨损",
  "oxidation stability": "氧化稳定性",
  "low friction coefficient": "低摩擦系数",
  "small wear scar": "小磨斑",
  "high oxidation temperature": "高氧化温度",
  "high extreme pressure value": "高极压值",
  "mass fraction": "质量分数"
};

export const descriptorSummaryKeys = [
  "MolWt",
  "MolLogP",
  "TPSA",
  "NumHDonors",
  "NumHAcceptors",
  "NumRotatableBonds",
  "RingCount",
  "HeavyAtomCount",
  "NumHeteroatoms",
  "Element_C",
  "Element_H",
  "Element_O",
  "Element_N",
  "Element_S",
  "Element_P"
];
