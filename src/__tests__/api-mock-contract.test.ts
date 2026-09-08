import { describe, expect, it } from "vitest";
import * as api from "../lib/api";
import { API_MOCK_DEFAULTS, createApiMock } from "./apiMock";

/**
 * Keeps the shared test mock honest.
 *
 * When an API function is added and the mock is not updated, every test that renders a component
 * calling it starts producing unhandled rejections — which Vitest reports as errors and exits
 * non-zero on, while still printing "all assertions passed". This test turns that into an
 * immediate, obvious failure with the missing name in the message.
 */
describe("the shared API mock matches the real module", () => {
  it("defines a default for every export", () => {
    const real = Object.keys(api).sort();
    const mocked = Object.keys(API_MOCK_DEFAULTS).sort();

    expect(real.length).toBeGreaterThan(40);
    expect(mocked.filter((name) => !real.includes(name)), "mock defines exports the API does not").toEqual([]);
    expect(real.filter((name) => !mocked.includes(name)), "API exports the mock does not define").toEqual([]);
  });

  it("answers every asynchronous export with an awaitable value", async () => {
    const mock = createApiMock() as Record<string, () => unknown>;
    const synchronous = new Set(["deliverExport", "describeExport"]);
    // These are genuinely nullable in the real API — a molecule that does not exist, a save that
    // returned nothing — so a default of `undefined` is the honest answer for them.
    const nullable = new Set(["getMolecule", "saveMoleculeWithRequiredDescriptors", "deleteCommercialProduct"]);

    for (const name of Object.keys(API_MOCK_DEFAULTS)) {
      const produced = mock[name]();
      if (synchronous.has(name)) continue;
      // A mock that returns `undefined` is what causes "cannot read properties of undefined"
      // inside a component's `await`, long after the test appears to have finished.
      expect(produced, `${name} must return a promise`).toBeInstanceOf(Promise);
      if (nullable.has(name)) {
        await expect(produced).resolves.toBeUndefined();
      } else {
        await expect(produced).resolves.toBeDefined();
      }
    }
  });

  it("lets a test override one function without losing the rest", async () => {
    const listMoleculePage = () => Promise.resolve({ items: [{ id: "m-1" }], total: 1, page: 1, pageSize: 1 });
    const mock = createApiMock({ listMoleculePage }) as Record<string, () => Promise<unknown>>;

    await expect(mock.listMoleculePage()).resolves.toMatchObject({ total: 1 });
    await expect(mock.listBaseOils()).resolves.toEqual([]);
  });
});
