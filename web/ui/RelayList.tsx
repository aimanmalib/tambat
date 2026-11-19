import type { RelayOutcome } from '../../src/core/publish';
import { answeredCount, type RelayStatus } from '../../src/core/relay-watch';
import { useText } from '../i18n';

const host = (relay: string) => relay.replace(/^wss:\/\//, '');
const seconds = (ms: number) => (ms / 1000).toFixed(1);

/** Where a signed event was sent: each relay with whether it accepted the event, its reason when not, and how fast. */
export function RelayList({ outcomes }: { outcomes: RelayOutcome[] }) {
  const { t } = useText();
  return (
    <ul className="relays">
      {outcomes.map((o) => (
        <li key={o.relay} data-ok={o.ok}>
          <code>{host(o.relay)}</code> <span>{o.ok ? t('link.accepted') : t('link.refused')}</span>
          {o.ms === undefined ? null : <span className="relays__time"> {t('relays.time', { seconds: seconds(o.ms) })}</span>}
          {o.ok ? null : <span className="relays__reason">{o.noAnswer ? t('link.noAnswer') : t('link.relaySaid', { reason: o.reason ?? '' })}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Which relays answered a lookup: every configured relay, answered, refused or silent, with the time of its answer. */
export function RelayAnswers({ statuses }: { statuses: RelayStatus[] }) {
  const { t } = useText();
  const answered = answeredCount(statuses);
  return (
    <details className="more relay-answers" data-answered={answered} data-total={statuses.length}>
      <summary>{t('relays.summary', { answered, total: statuses.length })}</summary>
      <ul className="relays" aria-label={t('relays.label')}>
        {statuses.map((s) => (
          <li key={s.relay} data-relay={host(s.relay)} data-state={s.state}>
            <code>{host(s.relay)}</code> <span>{t(`relays.${s.state}`)}</span>
            {s.ms === null ? null : <span className="relays__time"> {t('relays.time', { seconds: seconds(s.ms) })}</span>}
          </li>
        ))}
      </ul>
    </details>
  );
}
