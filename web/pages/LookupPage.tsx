import { useEffect, useState } from 'react';
import { didDocument } from '../../src/core/did';
import { hasNoCurrentLink, type BindingResult } from '../../src/core/verify';
import { findIdentity, type Found } from '../find';
import { useText } from '../i18n';
import { navigate, queryParam } from '../router';
import { BindingSummary } from '../ui/BindingSummary';
import { errorText } from '../../src/errors';
import { Notice } from '../ui/Notice';
import { OwnerActions } from './OwnerActions';

const VERIFIER_PATH = '/verify/';

type State = { kind: 'idle' } | { kind: 'busy' } | ({ kind: 'done' } & Found) | { kind: 'error'; message: string };

function Result({ result, onChanged }: { result: BindingResult; onChanged: () => void }) {
  const { t, lang } = useText();
  if (hasNoCurrentLink(result)) {
    return <Notice>{t('lookup.noLink', { date: new Date(result.createdAt * 1000).toLocaleString(lang) })}</Notice>;
  }
  const did = didDocument(result.pubkey, result);
  return (
    <article className="result" data-ok={result.ok}>
      <BindingSummary result={result} />
      <OwnerActions result={result} onChanged={onChanged} />
      {result.ok ? (
        <button type="button" className="btn" onClick={() => navigate('/pay', `?npub=${result.npub}`)}>{t('lookup.pay')}</button>
      ) : null}
      <details className="more">
        <summary>{t('lookup.event')}</summary>
        <pre className="json" tabIndex={0} aria-label={t('lookup.event')}>{JSON.stringify(result.event, null, 2)}</pre>
      </details>
      <details className="more">
        <summary>{t('lookup.did')}</summary>
        <pre className="json" tabIndex={0} aria-label={t('lookup.did')}>{JSON.stringify(did, null, 2)}</pre>
        <a href={`/api/did/${result.npub}`}>{t('lookup.didLink')}</a>
      </details>
    </article>
  );
}

export function LookupPage() {
  const { t } = useText();
  const [input, setInput] = useState(queryParam('q'));
  const [state, setState] = useState<State>(() => (queryParam('q') ? { kind: 'busy' } : { kind: 'idle' }));

  const settle = (value: string): Promise<State> =>
    findIdentity(value).then(
      (found): State => (found === 'bad_input' ? { kind: 'error', message: t('lookup.inputError') } : { kind: 'done', ...found }),
      (e: unknown): State => ({ kind: 'error', message: errorText(e, t) }),
    );
  const run = (value: string) => {
    setState({ kind: 'busy' });
    void settle(value).then(setState);
  };

  useEffect(() => {
    const q = queryParam('q');
    if (q) void settle(q).then(setState);
    // Runs once for a shared link; later lookups come from the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="card" aria-labelledby="lookup-title">
      <h1 className="card__title" id="lookup-title">{t('lookup.title')}</h1>
      <p className="option__help">{t('lookup.help')}</p>
      <p className="option__help">
        {t('verifier.downloadHelp')} <a href={VERIFIER_PATH}>{t('verifier.open')}</a>
        {' · '}
        <a href={`${VERIFIER_PATH}tambat-verify.html`} download>{t('verifier.download')}</a>
      </p>
      <form
        className="row row--form"
        onSubmit={(e) => {
          e.preventDefault();
          window.history.replaceState(null, '', `/lookup?q=${encodeURIComponent(input.trim())}`);
          run(input);
        }}
      >
        <label className="field field--grow">
          <span className="field__label">{t('lookup.label')}</span>
          <input className="input" name="q" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <button type="submit" className="btn btn--primary" disabled={state.kind === 'busy' || input.trim() === ''}>{t('lookup.submit')}</button>
      </form>
      {state.kind === 'busy' ? <Notice>{t('lookup.searching')}</Notice> : null}
      {state.kind === 'error' ? <Notice tone="error">{state.message}</Notice> : null}
      {state.kind === 'done' && state.via ? <Notice>{t('nip05.points', state.via)}</Notice> : null}
      {state.kind === 'done' && state.results.length === 0 ? <Notice>{t('lookup.none')}</Notice> : null}
      {state.kind === 'done' ? state.results.map((r) => <Result key={r.eventId} result={r} onChanged={() => run(input)} />) : null}
    </section>
  );
}
