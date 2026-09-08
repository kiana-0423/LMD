import type { EntityPage } from "../../types";
import { invokeCommand } from "../tauri";

export interface MaterialProperty {
  name: string;
  value: string;
  unit: string;
  conditions: string;
}
export interface MaterialProperties {
  viscosity40c?: number | null;
  viscosity100c?: number | null;
  viscosityIndex?: number | null;
  density?: number | null;
  pourPoint?: number | null;
  flashPoint?: number | null;
  appearance?: string;
  solubility?: string;
  conditions?: string;
  custom?: MaterialProperty[];
}

export interface CommercialProductInput {
  name: string;
  category: "" | "base_oil" | "additive";
  generalFormula: string;
  manufacturer: string;
  productionDate: string;
  batchNumber: string;
  productNumber: string;
  supplier: string;
  notes: string;
  materialProperties?: MaterialProperties;
}

export interface CommercialProduct extends CommercialProductInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  baseOilId?: string;
  additiveId?: string;
}

export function listCommercialProductPage(
  request: { page?: number; pageSize?: number; search?: string } = {},
  category?: string
) {
  return invokeCommand<EntityPage<CommercialProduct>>("list_commercial_products_page", { request, category });
}
export function getCommercialProduct(id: string) {
  return invokeCommand<CommercialProduct>("get_commercial_product", { id });
}
export function saveCommercialProduct(payload: CommercialProductInput, id?: string) {
  return invokeCommand<CommercialProduct>("save_commercial_product", { id, payload });
}
export function deleteCommercialProduct(id: string) {
  return invokeCommand<void>("delete_commercial_product", { id });
}
export function registerCommercialProduct(id: string, role: "base_oil" | "additive") {
  return invokeCommand<CommercialProduct>("register_commercial_product", { id, role });
}
