import { useEffect, useState } from 'react';
import { config } from '../../src/config';
import { shortAddress, shortNpub } from '../../src/core/badge';
import { answeredCount, createRelayWatch, type RelayStatus } from '../../src/core/relay-watch';
import { electrumServers } from '../../src/core/anchor-chain';
import { loadWall, type Wall } from '../../src/core/wall';
import { useText } from '../i18n';
import { navigate } from '../router';
import { Notice } from '../ui/Notice';
import { RelayAnswers } from '../ui/RelayList';
import { SinceBadge } from '../ui/SinceBadge';

type State = { kind: 'busy' } | ({ kind: 'done'; reachable: boolean; relays: RelayStatus[] } & Wall);

/** Loads the wall and records which relays answered, so an outage never reads as "empty". */
async function load(): Promise<State> {
  const watch = createRelayWatch(config.nostr.relays);
  const wall = await loadWall({ watch, chain: { servers: electrumServers() } }).catch((): Wall => ({ entries: [], hidden: 0, scanned: 0 }));
  const empty = wall.entries.length === 0 && wall.hidden === 0;
  const reachable = !empty || answeredCount(watch.statuses()) > 0;
  return { kind: 'done', reachable, relays: watch.statuses(), ...wall };
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
              <div className="wall__badges">
                <p className="badge badge--ok">{t('lookup.verified')}</p>
                <SinceBadge address={e.address} pubkey={e.pubkey} eventId={e.eventId} />
              </div>
              <dl className="facts">
                <dt>{t('lookup.nostrKey')}</dt>
                <dd><code title={e.npub}>{shortNpub(e.npub)}</code></dd>
                <dt>{t('lookup.bchAddress')}</dt>
                <dd><code title={e.address}>{shortAddress(e.address)}</code></dd>
                <dt>{t('lookup.proof')}</dt>
                <dd data-proof-form={e.proof}>{t(e.proof === 'tx' ? 'lookup.proofTx' : 'lookup.proofMessage')}</dd>
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
      {state.kind === 'done' && state.reachable ? (
        <p className="wall__scanned" data-scanned={state.scanned}>{t('wall.scanned', { shown: state.entries.length, scanned: state.scanned })}</p>
      ) : null}
      {state.kind === 'done' ? <p className="wall__hidden" data-hidden={state.hidden}>{t('wall.hidden', { count: state.hidden })}</p> : null}
      {state.kind === 'done' ? <RelayAnswers statuses={state.relays} /> : null}
    </section>
  );
}
