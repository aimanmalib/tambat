import { useState } from 'react';
import type { AnchorPayload, PreparedAnchor } from '../../src/core/anchor';
import type { BindingResult } from '../../src/core/verify';
import { errorText } from '../../src/errors';
import { useText } from '../i18n';
import { Notice } from '../ui/Notice';
import { canAnchor, prepareAnchor, requestAnchor } from './anchor';
import { useKeys } from './KeysContext';
import { HexId } from '../ui/HexId';

/** Set through the CSSOM, which the style-src policy allows, so a long address breaks instead of widening the page. */

type Step = { kind: 'offer' } | { kind: 'busy' } | { kind: 'preview'; unsigned: PreparedAnchor } | { kind: 'asking' } | { kind: 'sent'; txid: string };

/**
 * "Anchor this link on BCH", shown only to the person whose wallet holds the bound address over WalletConnect.
 * The outputs and the fee are shown before the wallet is asked; the wallet signs and sends.
 */
export function AnchorOffer({ result, anchored }: { result: BindingResult; anchored: boolean }) {
  const { t } = useText();
  const { bch } = useKeys();
  const [step, setStep] = useState<Step>({ kind: 'offer' });
  const [error, setError] = useState('');
  const address = result.claims[0]?.address ?? '';
  if (!result.ok || !canAnchor(bch) || bch.address !== address) return null;
  const payload: AnchorPayload = { pubkey: result.pubkey, eventId: result.eventId };
  /** `hint` is a text key added after the error, such as the note on coins not yet in a block. */
  const attempt = async (busy: Step, work: () => Promise<Step>, back: Step, hint?: string) => {
    setError('');
    setStep(busy);
    try {
      setStep(await work());
    } catch (e) {
      setError(hint ? `${errorText(e, t)} ${t(hint)}` : errorText(e, t));
      setStep(back);
    }
  };

  return (
    <div className="stack">
      {step.kind === 'offer' || step.kind === 'busy' ? (
        <>
          {/* The help names the 54-character address, which must wrap at 320 px (docs/decisions/0012-wallet-errors.md). */}
          <p className="option__help option__help--wrap">{t(anchored ? 'anchor.helpAgain' : 'anchor.help', { address })}</p>
          <button type="button" className="btn" disabled={step.kind === 'busy'}
            onClick={() => void attempt({ kind: 'busy' }, async () => ({ kind: 'preview', unsigned: await prepareAnchor(address, payload) }), { kind: 'offer' })}>
            {step.kind === 'busy' ? t('anchor.preparing') : t('anchor.offer')}
          </button>
        </>
      ) : null}
      {step.kind === 'preview' || step.kind === 'asking' ? (
        <>
          {step.kind === 'preview' ? (
            <Notice>{t('anchor.preview', { change: step.unsigned.changeSats, fee: step.unsigned.feeSats, address })}</Notice>
          ) : <Notice>{t('anchor.asking')}</Notice>}
          <div className="row">
            <button type="button" className="btn btn--primary" disabled={step.kind === 'asking'}
              onClick={() => {
                if (step.kind !== 'preview') return;
                const unsigned = step.unsigned;
                const hint = unsigned.unconfirmed ? 'anchor.hintUnconfirmed' : undefined;
                void attempt({ kind: 'asking' }, async () => ({ kind: 'sent', txid: await requestAnchor(bch, unsigned, payload, t('anchor.prompt')) }), step, hint);
              }}>
              {t('anchor.ask')}
            </button>
            <button type="button" className="btn" disabled={step.kind === 'asking'} onClick={() => setStep({ kind: 'offer' })}>{t('owner.cancel')}</button>
          </div>
        </>
      ) : null}
      {step.kind === 'sent' ? <Notice tone="ok">{t('anchor.sent')} <HexId value={step.txid} label={t('anchor.tx')} /></Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
