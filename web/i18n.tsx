import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import en from '../lang/en.json';
import ms from '../lang/ms.json';
import { config } from '../src/config';
import { translator, type Dictionary, type Translate } from '../src/i18n';

const dictionaries: Record<string, Dictionary> = { en, ms };
const STORAGE_KEY = 'tambat.lang';

export type { Translate };

interface TextState {
  lang: string;
  setLang: (lang: string) => void;
  t: Translate;
}

const TextContext = createContext<TextState | null>(null);

/** Storage can be missing or throw (a page opened from file://, private modes); the language choice is then not kept. */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** A `?lang=` in the address wins over the saved choice, which wins over the configured default. */
function initialLanguage(): string {
  const asked = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('lang');
  if (asked && asked in dictionaries) return asked;
  let saved: string | null;
  try {
    saved = storage()?.getItem(STORAGE_KEY) ?? null;
  } catch {
    saved = null;
  }
  return saved && saved in dictionaries ? saved : config.site.defaultLanguage;
}

export function TextProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState(initialLanguage);
  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      storage()?.setItem(STORAGE_KEY, lang);
    } catch {
      // Not kept; the page still switches language.
    }
  }, [lang]);
  const value = useMemo<TextState>(() => {
    const dict = dictionaries[lang] ?? en;
    return { lang, setLang, t: translator(dict) };
  }, [lang]);
  return <TextContext.Provider value={value}>{children}</TextContext.Provider>;
}

export function useText(): TextState {
  const value = useContext(TextContext);
  if (!value) throw new Error('useText outside TextProvider');
  return value;
}
