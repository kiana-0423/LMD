import { describe, expect, it } from "vitest";
import {
  additiveFunctionLabelKeys,
  additiveFunctionTags,
  commonOptionLabelKeys,
  descriptorStatusLabelKeys,
  formalRoutes,
  moleculeCategories,
  moleculeCategoryLabelKeys
} from "../lib/constants";
import { SUPPORTED_LANGUAGES } from "../i18n/LanguageContext";
import { messagesForLanguage } from "../i18n/catalogues";

describe("constants", () => {
  it("defines a label key for every molecule category", () => {
    for (const category of moleculeCategories) {
      expect(moleculeCategoryLabelKeys[category]).toBeTruthy();
    }
  });

  it("defines a label key for every additive function tag", () => {
    for (const tag of additiveFunctionTags) {
      expect(additiveFunctionLabelKeys[tag]).toBeTruthy();
    }
  });

  it("contains the primary formal routes", () => {
    expect(formalRoutes.map((route) => route.key)).toEqual(
      expect.arrayContaining([
        "/dashboard",
        "/molecules",
        "/descriptors",
        "/data-mining/molecule-performance",
        "/data-mining/formulation-prediction",
        "/data-mining/molecule-design"
      ])
    );
  });

  it("names labels by key rather than by English text", () => {
    // The point of the change these guard: a stored code maps to a key, and the key is what gets
    // translated. Storing the English word here would freeze the interface in one language.
    expect(descriptorStatusLabelKeys.calculated).toBe("label.calculated");
    expect(descriptorStatusLabelKeys.failed).toBe("label.failed");
    expect(additiveFunctionLabelKeys.antiwear).toBe("label.antiwearAgent");
  });

  it("resolves every label key in every language", () => {
    const keys = [
      ...Object.values(moleculeCategoryLabelKeys),
      ...Object.values(additiveFunctionLabelKeys),
      ...Object.values(descriptorStatusLabelKeys),
      ...Object.values(commonOptionLabelKeys)
    ];
    expect(keys.length).toBeGreaterThan(20);
    for (const language of SUPPORTED_LANGUAGES) {
      const messages = messagesForLanguage(language);
      for (const key of keys) {
        expect(messages[key], `${key} is missing from ${language}`).toBeTruthy();
      }
    }
  });
});
