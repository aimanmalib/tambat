import { useEffect, useState } from 'react';
import { parseP2pkhAddress } from '../../src/core/cashaddr';
import { didDocument } from '../../src/core/did';
import { lookupByAddress, lookupByPubkey } from '../../src/core/discover';
import { parsePubkey } from '../../src/core/nostr';
import type { BindingResult } from '../../src/core/verify';
import { useText } from '../i18n';
import { navigate, queryParam } from '../router';
import { Checklist } from '../ui/Checklist';
import { errorText, Notice } from '../ui/Notice';

type State = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; results: BindingResult[] } | { kind: 'error'; message: string };

/** Runs a lookup by npub (or hex key) or by BCH address. Results are verified in this browser. */
export async function lookUp(input: string): Promise<BindingResult[] | 'bad_input'> {
  const key = parsePubkey(input);
  if ('hex' in key) {
    const r = await lookupByPubkey(key.hex);
    return r ? [r] : [];
  }
  if (typeof parseP2pkhAddress(input) !== 'string') return lookupByAddress(input);
  return 'bad_input';
}

function Result({ result }: { result: BindingResult }) {
  const { t, lang } = useText();
  const did = didDocument(result.pubkey, result);
  return (
    <article className="result" data-ok={result.ok}>
      <p className={`badge ${result.ok ? 'badge--ok' : 'badge--fail'}`}>{result.ok ? t('lookup.verified') : t('lookup.failed')}</p>
      <dl className="facts">
        <dt>{t('lookup.nostrKey')}</dt>
        <dd><code>{result.npub}</code></dd>
        {result.claims.map((c) => [
          <dt key={`t-${c.address}`}>{t('lookup.bchAddress')}</dt>,
          <dd key={`d-${c.address}`}><code>{c.address}</code></dd>,
        ])}
        <dt>{t('lookup.published')}</dt>
        <dd>{new Date(result.createdAt * 1000).toLocaleString(lang)}</dd>
      </dl>
      <Checklist result={result} />
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
    lookUp(value.trim()).then(
      (results): State => (results === 'bad_input' ? { kind: 'error', message: t('lookup.inputError') } : { kind: 'done', results }),
      (e: unknown): State => ({ kind: 'error', message: errorText(e) }),
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
      {state.kind === 'done' && state.results.length === 0 ? <Notice>{t('lookup.none')}</Notice> : null}
      {state.kind === 'done' ? state.results.map((r) => <Result key={r.eventId} result={r} />) : null}
    </section>
  );
}
