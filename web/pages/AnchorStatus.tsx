import { useEffect, useState } from 'react';
import { addressStatus, electrumChain, type AddressStatus } from '../../src/core/anchor-chain';
import { toNpub } from '../../src/core/nostr';
import type { BindingResult } from '../../src/core/verify';
import { useText } from '../i18n';
import { Notice } from '../ui/Notice';
import { AnchorOffer } from '../keys/anchorOffer';
import { HexId } from '../ui/HexId';

/**
 * The optional BCH anchor of a verified binding, read from the chain in the browser: since which block the address
 * has committed to this Nostr key, or that it has not. When the chain's newest commitment revokes this key or names
 * another one, that is said first: the chain record wins over relays (docs/decisions/0013-revoke-by-transaction.md).
 */
export function AnchorStatus({ result }: { result: BindingResult }) {
  const { t, lang } = useText();
  const address = result.claims[0]?.address ?? '';
  const [read, setRead] = useState<AddressStatus | null>(null);
  useEffect(() => {
    let live = true;
    void addressStatus(address, result.pubkey, result.eventId, electrumChain()).then((s) => {
      if (live) setRead(s);
    });
    return () => {
      live = false;
    };
  }, [address, result.pubkey, result.eventId]);

  const status = read?.anchor ?? null;
  const verdict = read?.verdict ?? null;
  const day = (time?: number) => new Date((time ?? 0) * 1000).toLocaleDateString(lang, { dateStyle: 'medium' });
  let line;
  if (!status) line = <Notice>{t('anchor.checking')}</Notice>;
  else if (verdict?.kind === 'revoked') {
    const r = verdict.revocation;
    line = (
      <>
        <Notice tone="error">{t('anchor.revoked', { height: r.height, date: day(r.blockTime) })}</Notice>
        <p className="option__help anchor__tx">{t('anchor.tx')} <HexId value={r.txid} label={t('anchor.tx')} /></p>
      </>
    );
  } else if (verdict?.kind === 'conflict') {
    line = (
      <>
        <Notice tone="error">{t('anchor.conflict', { npub: toNpub(verdict.chainPubkey) })}</Notice>
        <p className="option__help anchor__tx">{t('anchor.tx')} <HexId value={verdict.commitment.txid} label={t('anchor.tx')} /></p>
      </>
    );
  }
  else if (status.kind === 'unreachable') line = <Notice>{t('anchor.unreachable')}</Notice>;
  else if (status.kind === 'none') line = <Notice>{t('anchor.none')}</Notice>;
  else {
    const c = status.commitment;
    const date = day(c.blockTime);
    line = (
      <>
        <Notice tone="ok">{t('anchor.since', { height: c.height, date })}</Notice>
        {status.sameEvent ? null : <p className="option__help">{t('anchor.otherEvent')}</p>}
        <p className="option__help anchor__tx">{t('anchor.tx')} <HexId value={c.txid} label={t('anchor.tx')} /></p>
      </>
    );
  }
  return (
    <div className="picker anchor" data-anchor={status?.kind ?? 'checking'} data-chain={verdict?.kind ?? (status ? 'unknown' : 'checking')}>
      <h3 className="picker__title">{t('anchor.title')}</h3>
      {line}
      {status && status.kind !== 'unreachable' && verdict?.kind !== 'conflict' ? <AnchorOffer result={result} anchored={status.kind === 'anchored'} /> : null}
      {verdict?.kind === 'bound' ? <AnchorOffer result={result} anchored revoke /> : null}
    </div>
  );
}
