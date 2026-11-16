import { useEffect, useState } from 'react';
import en from '../lang/en.json';
import ms from '../lang/ms.json';
import { config } from '../src/config';
import { translate, type Dictionary } from '../src/i18n';

const dictionaries: Record<string, Dictionary> = { en, ms };

function initialLanguage(): string {
  const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem('tambat.lang');
  return saved && saved in dictionaries ? saved : config.site.defaultLanguage;
}

export function App() {
  const [lang, setLang] = useState(initialLanguage);
  const dict = dictionaries[lang] ?? en;
  const t = (key: string) => translate(dict, key);

  useEffect(() => {
    document.documentElement.lang = lang;
    localStorage.setItem('tambat.lang', lang);
  }, [lang]);

  return (
    <main className="shell">
      <header className="top">
        <h1>{t('app.name')}</h1>
        <label className="lang">
          <span>{t('lang.label')}</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {config.site.languages.map((code) => (
              <option key={code} value={code}>{t(`lang.${code}`)}</option>
            ))}
          </select>
        </label>
      </header>
      <p className="lead">{t('app.tagline')}</p>
      <p className="note">{t('app.status')}</p>
    </main>
  );
}
