import type { RelayOutcome } from '../../src/core/publish';
import { useText } from '../i18n';

export function RelayList({ outcomes }: { outcomes: RelayOutcome[] }) {
  const { t } = useText();
  return (
    <ul className="relays">
      {outcomes.map((o) => (
        <li key={o.relay} data-ok={o.ok}>
          <code>{o.relay.replace(/^wss:\/\//, '')}</code> <span>{o.ok ? t('link.accepted') : t('link.refused')}</span>
          {o.reason ? <span className="relays__reason">{o.reason}</span> : null}
        </li>
      ))}
    </ul>
  );
}
