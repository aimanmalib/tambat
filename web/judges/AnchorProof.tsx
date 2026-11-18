import { useEffect, useState } from 'react';
import { config } from '../../src/config';
import { anchorStatus, electrumChain } from '../../src/core/anchor-chain';
import { proofState, type ProofState } from '../../src/core/anchor-proof';
import { parsePubkey } from '../../src/core/nostr';
import { useText } from '../i18n';
import { HexId } from '../ui/HexId';

/**
 * The recorded BCH commitment of the Paytaca binding, read again from the chain when the page opens. It shows a check
 * mark only when the chain shows the same transaction in the same block; otherwise it says what it saw.
 */
export function AnchorProof() {
  const { t } = useText();
  const a = config.judges.anchor;
  const [state, setState] = useState<ProofState | 'checking'>('checking');
  useEffect(() => {
    let live = true;
    const key = parsePubkey(config.judges.paytaca.npub);
    const pubkey = 'hex' in key ? key.hex : '';
    void anchorStatus(a.address, pubkey, a.eventId, electrumChain()).then((s) => {
      if (live) setState(proofState(s, a));
    });
    return () => {
      live = false;
    };
  }, [a]);
  const label = t(`judges.anchorState.${state}`);
  // A confirmed or pending line keeps to a mark so the page still fits one phone screen; a failure is spelled out.
  const mark = state === 'confirmed' ? '✓' : state === 'checking' ? '…' : null;
  return (
    <li data-proof="anchor" data-anchor={state}>
      {t('judges.anchor', { block: a.block })}: <HexId value={a.txid} label={t('judges.anchorTx')} />{' '}
      <a href={config.anchor.explorerTx.replace('{txid}', a.txid)}>{t('judges.explorer')}</a>{' '}
      <span className={mark ? 'jmark' : 'chip chip--fail jchip'} role="status" title={label}>
        {mark ? <><span aria-hidden="true">{mark}</span><span className="sr-only">{label}</span></> : label}
      </span>
    </li>
  );
}
