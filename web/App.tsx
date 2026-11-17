import { useText } from './i18n';
import { KeysProvider } from './keys/KeysContext';
import { DemoPage } from './pages/DemoPage';
import { LinkPage } from './pages/LinkPage';
import { LookupPage } from './pages/LookupPage';
import { PayPage } from './pages/PayPage';
import { WallPage } from './pages/WallPage';
import { navigate, useRoute, type Route } from './router';
import { Banner } from './ui/Banner';
import { config } from '../src/config';

const NAV: { path: Route; key: string }[] = [
  { path: '/', key: 'nav.link' },
  { path: '/lookup', key: 'nav.lookup' },
  { path: '/wall', key: 'nav.wall' },
  { path: '/demo', key: 'nav.demo' },
  { path: '/pay', key: 'nav.pay' },
];

function Home() {
  const { t } = useText();
  return (
    <>
      <div className="hero">
        <h1 className="hero__title">{t('app.headline')}</h1>
        <p className="hero__sub">{t('app.sub')}</p>
      </div>
      <LinkPage />
      <section className="how" aria-labelledby="how-title">
        <h2 id="how-title">{t('how.title')}</h2>
        <ol>
          <li>{t('how.one')}</li>
          <li>{t('how.two')}</li>
          <li>{t('how.three')}</li>
        </ol>
      </section>
    </>
  );
}

const PAGES: Record<Route, () => React.JSX.Element> = { '/': Home, '/lookup': LookupPage, '/wall': WallPage, '/demo': DemoPage, '/pay': PayPage };

export function App() {
  const { t, lang, setLang } = useText();
  const route = useRoute();
  const Page = PAGES[route];
  return (
    <KeysProvider>
      <a className="skip" href="#main">{t('app.skip')}</a>
      <Banner />
      <header className="top">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>{t('app.name')}</a>
        <nav className="nav" aria-label={t('nav.label')}>
          {NAV.map((n) => (
            <a
              key={n.path}
              href={n.path}
              aria-current={route === n.path ? 'page' : undefined}
              onClick={(e) => { e.preventDefault(); navigate(n.path); }}
            >
              {t(n.key)}
            </a>
          ))}
        </nav>
        <label className="lang">
          <span className="sr-only">{t('lang.label')}</span>
          <select value={lang} onChange={(e) => setLang(e.target.value)}>
            {config.site.languages.map((code) => (
              <option key={code} value={code}>{t(`lang.${code}`)}</option>
            ))}
          </select>
        </label>
      </header>
      <main id="main" className="shell">
        <Page />
      </main>
      <footer className="foot">
        <p>{t('footer.trust')}</p>
        <p>{t('footer.built')} {t('footer.license')}</p>
      </footer>
    </KeysProvider>
  );
}
