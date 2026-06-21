import type { Formulation } from "../../types";
import {
  mockCreateFormulation,
  mockDeleteFormulation,
  mockListFormulations,
  type CreateFormulationPayload
} from "../api.mock";
import { invokeOrMock } from "../tauri";

export async function listFormulations() {
  return invokeOrMock<Formulation[]>("list_formulations", { filter: null }, mockListFormulations);
}

export async function createFormulation(payload: CreateFormulationPayload) {
  return invokeOrMock<Formulation>("create_formulation", { payload }, () => mockCreateFormulation(payload));
}

export async function deleteFormulation(id: string) {
  return invokeOrMock<{ success: boolean; deleted: boolean }>("delete_formulation", { id }, () => mockDeleteFormulation(id));
}
