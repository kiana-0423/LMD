import type { EntityDeletion, EntityOption, EntityPage, Formulation } from "../../types";
import type { CreateFormulationPayload } from "./payloads";
import { toEntityDeletion } from "./deletion";
import { invokeCommand } from "../tauri";
import { coded } from "../backendErrors";

export async function listFormulations() {
  return invokeCommand<Formulation[]>("list_formulations", { filter: null });
}

/** One bounded page, with its aggregates joined in SQLite rather than counted per row. */
export async function listFormulationPage(
  request: { page?: number; pageSize?: number; search?: string } = {}
) {
  return invokeCommand<EntityPage<Formulation>>("list_formulations_page", { request });
}

/** Ids and names for a selector, never whole formulations with every component attached. */
export async function searchFormulations(query = "", limit = 50) {
  return invokeCommand<EntityOption[]>("search_formulations", { query, limit });
}

export async function createFormulation(payload: CreateFormulationPayload) {
  return invokeCommand<Formulation>("create_formulation", { payload });
}

export async function updateFormulation(id: string, payload: Partial<CreateFormulationPayload>) {
  return invokeCommand<Formulation>("update_formulation", { id, payload });
}

/** Duplicates a formulation and its components; measurements are deliberately not copied. */
export async function copyFormulation(id: string, name?: string) {
  return invokeCommand<Formulation>("copy_formulation", { id, name: name ?? null });
}

/** Loads the selected formulations, with their measured summaries, for side-by-side comparison. */
export async function compareFormulations(ids: string[]) {
  if (ids.length < 2) {
    throw new Error(coded("app.selectionRequired", "Select at least two formulations to compare."));
  }
  return invokeCommand<Formulation[]>("compare_formulations", { ids });
}

export async function deleteFormulation(id: string): Promise<EntityDeletion> {
  return toEntityDeletion(await invokeCommand<unknown>("delete_formulation", { id }));
}

export type { CreateFormulationPayload };
