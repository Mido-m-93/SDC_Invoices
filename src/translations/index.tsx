// ─────────────────────────────────────────────────────────────────────────────
// translations/index.ts — Translation hook and context
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  ReactNode,
  useCallback,
} from "react";
import ja, { TranslationKey } from "./ja";
import en from "./en";
import type { Language } from "@/types";
import { LANGUAGE_COOKIE } from "./constants";

// Use a looser type so both language objects satisfy the record
type Translations = Record<TranslationKey, string>;

const translations: Record<Language, Translations> = {
  ja: ja as Translations,
  en: en as Translations,
};

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({
  children,
  defaultLanguage = "ja",
}: {
  children: ReactNode;
  defaultLanguage?: Language;
}) {
  const [language, setLanguageState] = useState<Language>(defaultLanguage);

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    document.cookie = `${LANGUAGE_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  // `t` keeps one identity across language changes. Pages list it in the deps
  // of their data loaders (useCallback(..., [t])), so a new `t` per language
  // re-ran every fetch and flashed the page to "Loading..." on each toggle.
  // Consumers still re-render on a switch because the context value carries
  // `language`, and they call `t` fresh during render.
  const languageRef = useRef(language);
  languageRef.current = language;
  const t = useCallback(
    (key: TranslationKey): string =>
      translations[languageRef.current][key] ?? translations["ja"][key] ?? key,
    []
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used inside <LanguageProvider>");
  }
  return ctx;
}

export type { TranslationKey };
