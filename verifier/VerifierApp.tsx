import { useState } from 'react';
import { config } from '../src/config';
import { hasNoCurrentLink, type BindingResult } from '../src/core/verify';
import { errorText } from '../src/errors';
import { useText } from '../web/i18n';
import { BindingSummary } from '../web/ui/BindingSummary';
import { Notice } from '../web/ui/Notice';
import { check, type CheckOutcome } from './check';
import { BundleResult } from './BundleResult';
import { CredentialResult } from './CredentialResult';
import { SdResult } from './SdResult';

type State = { kind: 'idle' } | { kind: 'busy' } | CheckOutcome | { kind: 'failed'; message: string };

function Result({ result }: { result: BindingResult }) {
  const { t, lang } = useText();
  if (hasNoCurrentLink(result) && result.steps.some((s) => s.name === 'newest' && s.status === 'pass')) {
    return <Notice>{t('lookup.noLink', { date: new Date(result.createdAt * 1000).toLocaleString(lang) })}</Notice>;
  }
  return (
    <article className="result" data-ok={result.ok}>
      <BindingSummary result={result} />
      {result.event ? (
        <details className="more">
          <summary>{t('lookup.event')}</summary>
          <pre className="json" tabIndex={0} aria-label={t('lookup.event')}>{JSON.stringify(result.event, null, 2)}</pre>
        </details>
      ) : null}
    </article>
  );
}

function Outcome({ state }: { state: State }) {
  const { t } = useText();
  switch (state.kind) {
    case 'idle':
      return null;
    case 'busy':
      return <Notice>{t('lookup.searching')}</Notice>;
    case 'failed':
      return <Notice tone="error">{state.message}</Notice>;
    case 'error':
      return <Notice tone="error">{t(state.key, state.vars)}</Notice>;
    case 'pasted':
      return (
        <>
          <Notice>{t('verifier.pastedNote')}</Notice>
          <Result result={state.result} />
        </>
      );
    case 'credential':
      return <CredentialResult check={state.check} />;
    case 'bundle':
      return <BundleResult check={state.check} credentials={state.credentials} />;
    case 'sd':
      return <SdResult check={state.check} />;
    case 'found':
      return (
        <>
          <Notice>{t('verifier.asked', { relays: state.relays.join(', ') })}</Notice>
          {state.results.length === 0 ? <Notice>{t('verifier.none')}</Notice> : null}
          {state.results.map((r) => <Result key={r.eventId} result={r} />)}
        </>
      );
  }
}

/** The one-file verifier: paste an event or ask relays, then see every verification step. Talks to no server. */
export function VerifierApp() {
  const { t, lang, setLang } = useText();
  const [input, setInput] = useState('');
  const [relays, setRelays] = useState(config.nostr.relays.join('\n'));
  const [state, setState] = useState<State>({ kind: 'idle' });

  const run = () => {
    setState({ kind: 'busy' });
    check(input, relays).then(setState, (e: unknown) => setState({ kind: 'failed', message: errorText(e, t) }));
  };

  return (
    <>
      <header className="top">
        <p className="brand">{t('app.name')} <span className="brand__tag">{t('verifier.tag')}</span></p>
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
        <section className="card" aria-labelledby="verifier-title">
          <h1 className="card__title" id="verifier-title">{t('verifier.title')}</h1>
          <p className="option__help">{t('verifier.intro')}</p>
          <form
            className="verifier"
            onSubmit={(e) => {
              e.preventDefault();
              run();
            }}
          >
            <div className="field">
              <label className="field__label" htmlFor="verifier-q">{t('verifier.inputLabel')}</label>
              <textarea id="verifier-q" className="input input--area" name="q" rows={4} value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" spellCheck={false} aria-describedby="verifier-q-help" />
              <p className="option__help" id="verifier-q-help">{t('verifier.inputHelp')}</p>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="verifier-relays">{t('verifier.relaysLabel')}</label>
              <textarea id="verifier-relays" className="input input--area" name="relays" rows={3} value={relays} onChange={(e) => setRelays(e.target.value)} autoComplete="off" spellCheck={false} aria-describedby="verifier-relays-help" />
              <p className="option__help" id="verifier-relays-help">{t('verifier.relaysHelp')}</p>
            </div>
            <button type="submit" className="btn btn--primary" disabled={state.kind === 'busy' || input.trim() === ''}>{t('verifier.submit')}</button>
          </form>
          <div aria-live="polite">
            <Outcome state={state} />
          </div>
        </section>
      </main>
      <footer className="foot">
        <p>{t('verifier.trust')}</p>
        <p>{t('footer.license')}</p>
      </footer>
    </>
  );
}
