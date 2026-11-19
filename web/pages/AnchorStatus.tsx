import type { AddressStatus } from '../../src/core/anchor-chain';
import { toNpub } from '../../src/core/nostr';
import type { BindingResult } from '../../src/core/verify';
import { useText } from '../i18n';
import { Notice } from '../ui/Notice';
import { AnchorOffer } from '../keys/anchorOffer';
import { HexId } from '../ui/HexId';
import { tallyAgreed, tallyDetail } from '../ui/chainTally';

/**
 * The optional BCH anchor of a verified binding, read from the chain in the browser: since which block the address
 * has committed to this Nostr key, or that it has not. When the chain's newest commitment revokes this key or names
 * another one, that is said first: the chain record wins over relays (docs/decisions/0013-revoke-by-transaction.md).
 * Every configured chain server is read (once per look-up, src/core reads shared through useIdentityReads); an answer
 * counts only when enough of them agree (docs/decisions/0014-chain-quorum.md).
 */
export function AnchorStatus({ result, read }: { result: BindingResult; read: AddressStatus | undefined }) {
  const { t, lang } = useText();
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
  else if (status.kind === 'unknown') line = <Notice tone="error">{t('chain.unknown', { detail: read ? tallyDetail(read.servers, t) : '' })}</Notice>;
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
      {read && status?.kind !== 'unknown' && status?.kind !== 'unreachable' ? <p className="option__help" data-servers={read.servers.agreed.length}>{tallyAgreed(read.servers, t)}</p> : null}
      {status && status.kind !== 'unreachable' && status.kind !== 'unknown' && verdict?.kind !== 'conflict' ? <AnchorOffer result={result} anchored={status.kind === 'anchored'} /> : null}
      {verdict?.kind === 'bound' ? <AnchorOffer result={result} anchored revoke /> : null}
    </div>
  );
}
