import { useEffect, useState } from 'react';
import { config } from '../../src/config';
import { errorText } from '../../src/errors';
import { answeredCount, type RelayStatus } from '../../src/core/relay-watch';
import type { BindingResult } from '../../src/core/verify';
import { findIdentity } from '../find';
import { useText } from '../i18n';
import { Notice } from '../ui/Notice';

type State =
  | { kind: 'busy' }
  | { kind: 'done'; result: BindingResult | null; ms: number; relays: RelayStatus[] }
  | { kind: 'error'; reason: string; ms: number };

const seconds = (ms: number) => (ms / 1000).toFixed(1);

/** Looks up the demo identity on the relays when the page opens and shows every named check as it came back. */
export function SampleCheck() {
  const { t } = useText();
  const sample = config.judges.sample;
  const [state, setState] = useState<State>({ kind: 'busy' });

  useEffect(() => {
    const started = performance.now();
    let live = true;
    findIdentity(sample.npub).then(
      (found) => {
        if (!live) return;
        const result = found === 'bad_input' ? null : (found.results[0] ?? null);
        const relays = found === 'bad_input' ? [] : (found.relays ?? []);
        setState({ kind: 'done', result, ms: performance.now() - started, relays });
      },
      (e: unknown) => live && setState({ kind: 'error', reason: errorText(e, t), ms: performance.now() - started }),
    );
    return () => {
      live = false;
    };
    // Runs once when the page opens; the language switch must not ask the relays again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // How many relays answered this very look-up, so a judge sees the reads are spread over independent relays.
  const relayCount =
    state.kind === 'done' && state.relays.length > 0 ? (
      <span className="jrelays" data-answered={answeredCount(state.relays)} data-total={state.relays.length}>
        {' '}
        {t('relays.judges', { answered: answeredCount(state.relays), total: state.relays.length })}
      </span>
    ) : null;
  let status;
  if (state.kind === 'busy') status = <Notice>{t('judges.loading')}</Notice>;
  else if (state.kind === 'error') status = <Notice tone="error">{t('judges.failed', { reason: state.reason })}</Notice>;
  else if (!state.result) status = <Notice tone="error">{t('judges.notFound', { seconds: seconds(state.ms) })}{relayCount}</Notice>;
  else {
    const steps = [...state.result.steps, ...state.result.claims.flatMap((c) => c.steps)];
    const failed = steps.filter((s) => s.status === 'fail').length;
    const vars = { passed: steps.filter((s) => s.status === 'pass').length, failed, total: steps.length, seconds: seconds(state.ms) };
    status = (
      <>
        <Notice tone={state.result.ok ? 'ok' : 'error'}>
          {t(state.result.ok ? 'judges.verified' : 'judges.notVerified', vars)}
          {relayCount}
        </Notice>
        <ul className="chips" aria-label={t('judges.sampleTitle')}>
          {steps.map((s, i) => (
            <li key={`${s.name}-${i}`} className={`chip chip--${s.status}`} data-step={s.name} data-status={s.status}>
              <span aria-hidden="true">{s.status === 'pass' ? '✓' : s.status === 'fail' ? '✕' : '–'}</span> {t(`steps.${s.name}`)}
              <span className="sr-only"> {t(`steps.${s.status}`)}</span>
            </li>
          ))}
        </ul>
      </>
    );
  }

  const look = (q: string) => `/lookup?q=${encodeURIComponent(q)}`;
  return (
    <section className="jpanel jpanel--live" aria-labelledby="j-live" aria-busy={state.kind === 'busy'} data-state={state.kind === 'done' && state.result?.ok ? 'verified' : state.kind}>
      <h2 id="j-live" className="jpanel__title">
        {t('judges.sampleTitle')} <span className="jpanel__name">{sample.name}</span>
      </h2>
      <p className="jsmall jwide">{t('judges.sampleHelp')}</p>
      {status}
      <p className="jlinks">
        <a href={look(sample.npub)}>{t('judges.lookNpub')}</a>
        <a href={look(sample.address)}>{t('judges.lookAddress')}</a>
        <a href={look(sample.name)}>{t('judges.lookName')}</a>
      </p>
    </section>
  );
}
