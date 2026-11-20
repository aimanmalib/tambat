import { useState } from 'react';
import { config } from '../../src/config';
import { useText } from '../i18n';
import { firstCommitHref } from './first-commit';

/** The address in one line on a phone: the start and the end, which is what people compare. The copy button copies it whole. */
export function shortAddress(address: string): string {
  const body = address.slice(address.indexOf(':') + 1);
  return body.length > 14 ? `${body.slice(0, 6)}…${body.slice(-6)}` : body;
}

/**
 * Event banner at the top of every page: the presentation, the source code and the team's BCH address, each shown only when
 * config.banner has a value for it, and the note that this is a new project with a link to its first commit (config.banner.note). The judges page is one screen, so there the banner keeps to one line: no link to itself,
 * and the address is left to the home page.
 */
export function Banner({ onJudges = false }: { onJudges?: boolean }) {
  const { t } = useText();
  const b = config.banner;
  const commit = firstCommitHref(b);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(b.contactAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="banner">
      <strong>{t('banner.event')}</strong>
      {onJudges ? null : <a href="/judges">{t('banner.judges')}</a>}
      {b.deckUrl ? <a href={b.deckUrl} data-banner="deck">{t('banner.presentation')}</a> : null}
      {b.repoUrl ? <a href={b.repoUrl} data-banner="repo">{t('banner.source')}</a> : null}
      {commit ? <a href={commit} data-banner="note" className="banner__note">{t('banner.note')}</a> : null}
      {!onJudges && b.contactAddress ? (
        <span className="banner__address" data-banner="address">
          <span>{t('banner.address')}</span>
          <code title={b.contactAddress}>
            <span aria-hidden="true">{shortAddress(b.contactAddress)}</span>
            <span className="sr-only">{b.contactAddress}</span>
          </code>
          <button type="button" className="banner__copy" onClick={() => void copy()} aria-label={`${t('banner.copy')}: ${t('banner.address')}`}>
            <span aria-live="polite">{copied ? t('banner.copied') : t('banner.copy')}</span>
          </button>
        </span>
      ) : null}
    </div>
  );
}
