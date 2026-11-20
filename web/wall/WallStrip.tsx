import type { ReactNode } from 'react';
import { config } from '../../src/config';
import { useText } from '../i18n';
import type { Strip } from './strip';

/** One count: a dash with a spoken "not read yet" when the number was not read. */
function Value({ value, children }: { value: unknown; children?: ReactNode }) {
  const { t } = useText();
  if (value === null) return <span data-read="no" title={t('wall.strip.noneLabel')} aria-label={t('wall.strip.noneLabel')}>{t('wall.strip.none')}</span>;
  return <span data-read="yes">{children ?? String(value)}</span>;
}

/**
 * The counts above the wall, from this page's own reads. The counts are a polite live region; the time of the last
 * check sits outside it, so a screen reader is not interrupted every interval when nothing else changed.
 */
export function WallStrip({ strip }: { strip: Strip }) {
  const { t } = useText();
  const items: [string, string, unknown, ReactNode?][] = [
    ['verified', t('wall.strip.verified'), strip.verified],
    ['anchored', t('wall.strip.anchored'), strip.anchored, strip.anchored ? t('wall.strip.anchoredOf', strip.anchored) : null],
    ['on-chain', t('wall.strip.onChain'), strip.onChain],
    ['attestations', t('wall.strip.attestations'), strip.attestations],
    ['relays', t('wall.strip.relays'), strip.relays, t('wall.strip.relaysOf', strip.relays)],
    ['latest-block', t('wall.strip.latestBlock'), strip.latestBlock],
  ];
  return (
    <section className="wall__strip" aria-label={t('wall.strip.label')}>
      <dl className="wall__counts" aria-live="polite">
        {items.map(([key, label, value, shown]) => (
          <div className="wall__count" key={key} data-count={key}>
            <dt>{label}</dt>
            <dd><Value value={value}>{shown ?? undefined}</Value></dd>
          </div>
        ))}
      </dl>
      {strip.updated ? <p className="wall__updated" data-updated={strip.updated}>{t('wall.strip.updated', { time: strip.updated, seconds: config.wall.refreshSeconds })}</p> : null}
    </section>
  );
}
