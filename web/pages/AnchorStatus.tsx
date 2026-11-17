import { useEffect, useState } from 'react';
import { anchorStatus, electrumChain, type AnchorStatus as Status } from '../../src/core/anchor-chain';
import type { BindingResult } from '../../src/core/verify';
import { useText } from '../i18n';
import { Notice } from '../ui/Notice';
import { AnchorOffer } from '../keys/anchorOffer';

/**
 * The optional BCH anchor of a verified binding, read from the chain in the browser: since which block the address
 * has committed to this Nostr key, or that it has not. The binding above is verified without it either way.
 */
export function AnchorStatus({ result }: { result: BindingResult }) {
  const { t, lang } = useText();
  const address = result.claims[0]?.address ?? '';
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    let live = true;
    void anchorStatus(address, result.pubkey, result.eventId, electrumChain()).then((s) => {
      if (live) setStatus(s);
    });
    return () => {
      live = false;
    };
  }, [address, result.pubkey, result.eventId]);

  let line;
  if (!status) line = <Notice>{t('anchor.checking')}</Notice>;
  else if (status.kind === 'unreachable') line = <Notice>{t('anchor.unreachable')}</Notice>;
  else if (status.kind === 'none') line = <Notice>{t('anchor.none')}</Notice>;
  else {
    const c = status.commitment;
    const date = new Date((c.blockTime ?? 0) * 1000).toLocaleDateString(lang, { dateStyle: 'medium' });
    line = (
      <>
        <Notice tone="ok">{t('anchor.since', { height: c.height, date })}</Notice>
        {status.sameEvent ? null : <p className="option__help">{t('anchor.otherEvent')}</p>}
        <p className="option__help anchor__tx">{t('anchor.tx')} <code>{c.txid}</code></p>
      </>
    );
  }
  return (
    <div className="picker anchor" data-anchor={status?.kind ?? 'checking'}>
      <h3 className="picker__title">{t('anchor.title')}</h3>
      {line}
      {status && status.kind !== 'unreachable' ? <AnchorOffer result={result} anchored={status.kind === 'anchored'} /> : null}
    </div>
  );
}
