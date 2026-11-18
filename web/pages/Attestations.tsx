import { useEffect, useState } from 'react';
import { attestationsOf } from '../../src/core/attest-find';
import type { AttestationSummary } from '../../src/core/attest';
import { toNpub } from '../../src/core/nostr';
import type { BindingResult } from '../../src/core/verify';
import { useText } from '../i18n';
import { Notice } from '../ui/Notice';
import { HexId } from '../ui/HexId';

/**
 * Attestations of a verified binding, read from the relays in the browser: other keys that signed "verified" for
 * this exact binding event. Attestations of an earlier binding of the same key no longer count and are only counted.
 */
export function Attestations({ result }: { result: BindingResult }) {
  const { t, lang } = useText();
  const [summary, setSummary] = useState<AttestationSummary | null>(null);
  useEffect(() => {
    let live = true;
    void attestationsOf(result.pubkey, {}, result).then(
      (s) => live && setSummary(s),
      () => live && setSummary({ current: [], replaced: 0 }),
    );
    return () => {
      live = false;
    };
  }, [result]);

  return (
    <div className="picker attest" data-attest={summary ? summary.current.length : 'checking'}>
      <h3 className="picker__title">{t('attest.title')}</h3>
      {!summary ? <Notice>{t('attest.checking')}</Notice> : null}
      {summary && summary.current.length === 0 ? <Notice>{t('attest.none')}</Notice> : null}
      {summary && summary.current.length > 0 ? (
        <ul className="attest__list">
          {summary.current.map((a) => (
            <li key={a.event.id} className="attest__item">
              <Notice tone="ok">{t('attest.by', { date: new Date(a.event.created_at * 1000).toLocaleDateString(lang, { dateStyle: 'medium' }) })}</Notice>
              <p className="option__help attest__who"><code>{toNpub(a.attester)}</code></p>
              <p className="option__help attest__who">{t('attest.event')} <HexId value={a.event.id} label={t('attest.event')} /></p>
            </li>
          ))}
        </ul>
      ) : null}
      {summary && summary.replaced > 0 ? <p className="option__help">{t('attest.replaced', { count: summary.replaced })}</p> : null}
      <p className="option__help">{t('attest.help')}</p>
    </div>
  );
}
