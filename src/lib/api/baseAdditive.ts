import type { Additive, BaseOil, EntityPage, EntityOption, DeletionOutcome } from "../../types";
import type { CreateAdditivePayload, CreateBaseOilPayload } from "./payloads";
import { invokeCommand } from "../tauri";
import { toDeletionOutcome } from "./deletion";

export async function listBaseOils() {
  return invokeCommand<BaseOil[]>("list_base_oils", { filter: null });
}

/** One bounded page, counted and filtered in SQLite rather than in the browser. */
export async function listBaseOilPage(request: { page?: number; pageSize?: number; search?: string } = {}) {
  return invokeCommand<EntityPage<BaseOil>>("list_base_oils_page", { request });
}

/** Ids and labels for a selector. A dropdown has no use for a viscosity table. */
export async function searchBaseOils(query = "", limit = 50) {
  return invokeCommand<EntityOption[]>("search_base_oils", { query, limit });
}

export async function createBaseOil(payload: CreateBaseOilPayload) {
  return invokeCommand<BaseOil>("create_base_oil", { payload });
}

export async function updateBaseOil(id: string, payload: Partial<CreateBaseOilPayload>) {
  return invokeCommand<BaseOil>("update_base_oil", { id, payload });
}

/**
 * Asks the backend to delete a base oil.
 *
 * A referenced record is *not* deleted, and that is reported as data rather than as an error: the
 * result names the formulations standing in the way so the interface can list them.
 */
export async function deleteBaseOil(id: string) {
  return toDeletionOutcome(await invokeCommand<unknown>("delete_base_oil", { id }));
}

/** Deletes a base oil and the formulation components referencing it. Destructive by design. */
export async function deleteBaseOilWithComponents(id: string) {
  return toDeletionOutcome(
    await invokeCommand<unknown>("delete_base_oil_with_components", { id, confirmCascade: true })
  );
}

export async function listAdditives() {
  return invokeCommand<Additive[]>("list_additives", { filter: null });
}

export async function listAdditivePage(request: { page?: number; pageSize?: number; search?: string } = {}) {
  return invokeCommand<EntityPage<Additive>>("list_additives_page", { request });
}

export async function searchAdditives(query = "", limit = 50) {
  return invokeCommand<EntityOption[]>("search_additives", { query, limit });
}

export async function createAdditive(payload: CreateAdditivePayload) {
  return invokeCommand<Additive>("create_additive", { payload });
}

export async function updateAdditive(id: string, payload: Partial<CreateAdditivePayload>) {
  return invokeCommand<Additive>("update_additive", { id, payload });
}

export async function deleteAdditive(id: string) {
  return toDeletionOutcome(await invokeCommand<unknown>("delete_additive", { id }));
}

export async function deleteAdditiveWithComponents(id: string) {
  return toDeletionOutcome(
    await invokeCommand<unknown>("delete_additive_with_components", { id, confirmCascade: true })
  );
}

export type { CreateAdditivePayload, CreateBaseOilPayload, DeletionOutcome };
