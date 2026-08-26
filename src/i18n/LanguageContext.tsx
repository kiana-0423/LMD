import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import enUS, { type MessageCatalogue, type MessageKey } from "./locales/en-US";
import { interpolate, type MessageParams } from "./interpolate";

export const SUPPORTED_LANGUAGES = ["zh-CN", "en-US", "ja-JP"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const STORAGE_KEY = "lmd.language.v2";

export type Translate = (key: MessageKey, params?: MessageParams) => string;

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
  /** True while a locale chunk is being fetched. English stays on screen meanwhile. */
  loading: boolean;
  /**
   * Set when a locale chunk could not be loaded.
   *
   * The interface keeps working in English rather than going blank: a user who cannot read the
   * labels can still see that something failed, whereas an empty window tells them nothing.
   */
  loadError?: string;
};

/**
 * The locale chunks, as dynamic imports.
 *
 * Written as literal `import()` calls rather than a computed path so the bundler can see all three
 * and emit one chunk each. They are ordinary files inside the application bundle: switching
 * language reads from disk, never from a network, which is what keeps the whole feature working
 * offline.
 */
const LOADERS: Record<Exclude<Language, "en-US">, () => Promise<{ default: MessageCatalogue }>> = {
  "zh-CN": () => import("./locales/zh-CN"),
  "ja-JP": () => import("./locales/ja-JP")
};

const LOADED: Partial<Record<Language, MessageCatalogue>> = { "en-US": enUS };

// eslint-disable-next-line react-refresh/only-export-components
export { interpolate };
export type { MessageKey, MessageParams };

const LanguageContext = createContext<LanguageContextValue | null>(null);

function initialLanguage(): Language {
  if (typeof window === "undefined") return "en-US";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return SUPPORTED_LANGUAGES.includes(saved as Language) ? (saved as Language) : "en-US";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(initialLanguage);
  // Held separately from `language` so the interface only re-renders once the words are actually
  // there. Switching to a language whose chunk is still loading would otherwise blank every label.
  const [catalogue, setCatalogue] = useState<MessageCatalogue>(
    () => LOADED[initialLanguage()] ?? enUS
  );
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string>();
  // Guards against a slow first switch overwriting a faster second one.
  const requestRef = useRef(0);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    const cached = LOADED[language];
    if (cached) {
      setCatalogue(cached);
      setLoading(false);
      setLoadError(undefined);
      return;
    }
    const request = (requestRef.current += 1);
    setLoading(true);
    setLoadError(undefined);
    let cancelled = false;
    LOADERS[language as Exclude<Language, "en-US">]()
      .then((module) => {
        LOADED[language] = module.default;
        // A stale response must not replace a newer one, and an unmounted provider must not be
        // written to at all.
        if (cancelled || request !== requestRef.current) return;
        setCatalogue(module.default);
      })
      .catch((error: unknown) => {
        if (cancelled || request !== requestRef.current) return;
        // English is already on screen and stays there. The failure is reported rather than
        // swallowed, because a language that silently does not switch looks like a broken button.
        setLoadError(error instanceof Error ? error.message : String(error));
        setCatalogue(enUS);
      })
      .finally(() => {
        if (!cancelled && request === requestRef.current) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [language]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      // The English entry is the fallback for a key a locale chunk somehow lacks; the compile-time
      // `MessageCatalogue` type makes that unreachable, and it costs nothing to be sure.
      t: (key, params) => interpolate(catalogue[key] ?? enUS[key] ?? String(key), params),
      loading,
      loadError
    }),
    [language, catalogue, loading, loadError]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

// The provider and its hook intentionally share one context module.
// eslint-disable-next-line react-refresh/only-export-components
export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error("useLanguage must be used within LanguageProvider");
  return context;
}
