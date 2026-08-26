import enUS, { type MessageCatalogue } from "./locales/en-US";
import zhCN from "./locales/zh-CN";
import jaJP from "./locales/ja-JP";
import type { Language } from "./LanguageContext";

/**
 * Every catalogue at once, synchronously.
 *
 * Deliberately *not* imported by the application. The provider loads Chinese and Japanese with
 * dynamic imports so they become their own chunks; importing this module from a screen would pull
 * all three back into the initial bundle and undo that.
 *
 * It exists for the checks — the coverage test that compares key sets across languages, and the
 * tests that assert a rendered label against its catalogue entry. Those need all three at once and
 * run in Node, where the chunking is irrelevant. `src/__tests__/architecture.test.ts` asserts that
 * nothing under `features/`, `layouts/` or `lib/` imports it.
 */
export const CATALOGUES: Record<Language, MessageCatalogue> = {
  "en-US": enUS,
  "zh-CN": zhCN,
  "ja-JP": jaJP
};

/**
 * One catalogue, typed for lookup by an arbitrary key.
 *
 * The coverage checks compare key *sets* between languages, which means indexing one catalogue
 * with a key read from another. `MessageCatalogue` is deliberately exact, so it cannot be indexed
 * that way; widening here keeps the strictness where it matters — in the locale files themselves —
 * without making every check cast.
 */
export function messagesForLanguage(language: Language): Record<string, string> {
  return CATALOGUES[language];
}
