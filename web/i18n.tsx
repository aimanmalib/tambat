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

function initialLanguage(): string {
  const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
  return saved && saved in dictionaries ? saved : config.site.defaultLanguage;
}

export function TextProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState(initialLanguage);
  useEffect(() => {
    document.documentElement.lang = lang;
    localStorage.setItem(STORAGE_KEY, lang);
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
