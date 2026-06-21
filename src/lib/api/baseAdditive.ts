import type { Additive, BaseOil } from "../../types";
import {
  mockCreateAdditive,
  mockCreateBaseOil,
  mockDeleteAdditive,
  mockDeleteBaseOil,
  mockListAdditives,
  mockListBaseOils,
  type CreateAdditivePayload,
  type CreateBaseOilPayload
} from "../api.mock";
import { invokeOrMock } from "../tauri";

export async function listBaseOils() {
  return invokeOrMock<BaseOil[]>("list_base_oils", { filter: null }, mockListBaseOils);
}

export async function createBaseOil(payload: CreateBaseOilPayload) {
  return invokeOrMock<BaseOil>("create_base_oil", { payload }, () => mockCreateBaseOil(payload));
}

export async function deleteBaseOil(id: string) {
  return invokeOrMock<{ success: boolean; deleted: boolean }>("delete_base_oil", { id }, () => mockDeleteBaseOil(id));
}

export async function listAdditives() {
  return invokeOrMock<Additive[]>("list_additives", { filter: null }, mockListAdditives);
}

export async function createAdditive(payload: CreateAdditivePayload) {
  return invokeOrMock<Additive>("create_additive", { payload }, () => mockCreateAdditive(payload));
}

export async function deleteAdditive(id: string) {
  return invokeOrMock<{ success: boolean; deleted: boolean }>("delete_additive", { id }, () => mockDeleteAdditive(id));
}
