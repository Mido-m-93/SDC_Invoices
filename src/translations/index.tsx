// ─────────────────────────────────────────────────────────────────────────────
// translations/index.ts — Translation hook and context
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from "react";
import ja, { TranslationKey } from "./ja";
import en from "./en";
import type { Language } from "@/types";

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
  const [language, setLanguage] = useState<Language>(defaultLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const t = useCallback(
    (key: TranslationKey): string => {
      return translations[language][key] ?? translations["ja"][key] ?? key;
    },
    [language]
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
