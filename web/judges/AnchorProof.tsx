import { useEffect, useState } from 'react';
import { config } from '../../src/config';
import { addressStatus, electrumServers } from '../../src/core/anchor-chain';
import type { Tally } from '../../src/core/chain-quorum';
import { proofState, type ProofState } from '../../src/core/anchor-proof';
import { parsePubkey } from '../../src/core/nostr';
import { useText } from '../i18n';
import { HexId } from '../ui/HexId';
import { tallyDetail } from '../ui/chainTally';

/**
 * The recorded BCH commitment of the Paytaca binding, read again from the chain when the page opens. It shows a check
 * mark only when the chain servers agree (quorum) on the same transaction in the same block, with how many agreed;
 * otherwise it says what it saw.
 */
export function AnchorProof() {
  const { t } = useText();
  const a = config.judges.anchor;
  const [state, setState] = useState<ProofState | 'checking'>('checking');
  const [servers, setServers] = useState<Tally | null>(null);
  useEffect(() => {
    let live = true;
    const key = parsePubkey(config.judges.paytaca.npub);
    const pubkey = 'hex' in key ? key.hex : '';
    void addressStatus(a.address, pubkey, a.eventId, electrumServers()).then((s) => {
      if (!live) return;
      setState(proofState(s.anchor, a));
      setServers(s.servers);
    });
    return () => {
      live = false;
    };
  }, [a]);
  const count = servers && state !== 'unknown' && state !== 'unreachable' ? `${servers.agreed.length}/${servers.total}` : '';
  const label = [
    t(`judges.anchorState.${state}`),
    count && servers ? t('judges.anchorServers', { agreed: servers.agreed.length, total: servers.total }) : '',
    state === 'unknown' && servers ? tallyDetail(servers, t) : '',
  ].filter(Boolean).join('. ');
  // A confirmed or pending line keeps to a mark so the page still fits one phone screen; a failure is spelled out.
  const mark = state === 'confirmed' ? '✓' : state === 'checking' ? '…' : null;
  return (
    <li data-proof="anchor" data-anchor={state}>
      {t('judges.anchor', { block: a.block })}: <HexId value={a.txid} label={t('judges.anchorTx')} />{' '}
      <a href={config.anchor.explorerTx.replace('{txid}', a.txid)}>{t('judges.explorer')}</a>{' '}
      <span className={mark ? 'jmark' : 'chip chip--fail jchip'} role="status" title={label} data-servers={count || undefined}>
        {mark ? <><span aria-hidden="true">{count ? `${mark} ${count}` : mark}</span><span className="sr-only">{label}</span></> : t(`judges.anchorState.${state}`)}
      </span>
    </li>
  );
}
