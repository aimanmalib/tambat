import { useEffect, useState } from 'react';
import { config } from '../../src/config';
import { shortAddress, shortNpub } from '../../src/core/badge';
import { createProbe } from '../../src/core/probe';
import { loadWall, type Wall } from '../../src/core/wall';
import { useText } from '../i18n';
import { navigate } from '../router';
import { Notice } from '../ui/Notice';

type State = { kind: 'busy' } | ({ kind: 'done'; reachable: boolean } & Wall);

const probe = createProbe();

/** Loads the wall; when nothing came back it asks whether any relay answered, so an outage never reads as "empty". */
async function load(): Promise<State> {
  const wall = await loadWall().catch((): Wall => ({ entries: [], hidden: 0 }));
  const empty = wall.entries.length === 0 && wall.hidden === 0;
  const reachable = !empty || (await probe(config.nostr.relays, config.nostr.queryTimeoutMs)) > 0;
  return { kind: 'done', reachable, ...wall };
}

/** The newest bindings on the relays, each verified in this browser. Failures are only counted, never listed. */
export function WallPage() {
  const { t, lang } = useText();
  const [state, setState] = useState<State>({ kind: 'busy' });
  const refresh = () => {
    setState({ kind: 'busy' });
    void load().then(setState);
  };
  useEffect(() => {
    void load().then(setState);
  }, []);

  return (
    <section className="card" aria-labelledby="wall-title">
      <h1 className="card__title" id="wall-title">{t('wall.title')}</h1>
      <p className="option__help">{t('wall.help', { limit: config.wall.limit })}</p>
      <div className="row">
        <button type="button" className="btn" onClick={refresh} disabled={state.kind === 'busy'}>{t('wall.refresh')}</button>
      </div>
      {state.kind === 'busy' ? <Notice>{t('wall.loading')}</Notice> : null}
      {state.kind === 'done' && !state.reachable ? <Notice tone="error">{t('wall.unreachable')}</Notice> : null}
      {state.kind === 'done' && state.reachable && state.entries.length === 0 ? <Notice>{t('wall.empty')}</Notice> : null}
      {state.kind === 'done' && state.entries.length > 0 ? (
        <ol className="wall" aria-label={t('wall.listLabel')}>
          {state.entries.map((e) => (
            <li className="wall__card" key={e.eventId} data-event={e.eventId}>
              <p className="badge badge--ok">{t('lookup.verified')}</p>
              <dl className="facts">
                <dt>{t('lookup.nostrKey')}</dt>
                <dd><code title={e.npub}>{shortNpub(e.npub)}</code></dd>
                <dt>{t('lookup.bchAddress')}</dt>
                <dd><code title={e.address}>{shortAddress(e.address)}</code></dd>
                <dt>{t('lookup.published')}</dt>
                <dd><time dateTime={new Date(e.createdAt * 1000).toISOString()}>{new Date(e.createdAt * 1000).toLocaleString(lang)}</time></dd>
              </dl>
              <a
                className="btn btn--link"
                href={`/lookup?q=${encodeURIComponent(e.npub)}`}
                onClick={(ev) => { ev.preventDefault(); navigate('/lookup', `?q=${encodeURIComponent(e.npub)}`); }}
              >
                {t('wall.open')}
              </a>
            </li>
          ))}
        </ol>
      ) : null}
      {state.kind === 'done' ? <p className="wall__hidden" data-hidden={state.hidden}>{t('wall.hidden', { count: state.hidden })}</p> : null}
    </section>
  );
}
