import { useState } from 'react';
import { config } from '../../src/config';
import type { BchClaim } from '../../src/core/binding';
import type { TxLookup } from '../../src/core/tx-proof';
import { toNpub, verificationText } from '../../src/core/nostr';
import { verifyClaim, type ClaimResult } from '../../src/core/verify';
import { useText, type Translate } from '../i18n';
import { CopyValue } from '../ui/Copy';
import { KeyBadge } from '../ui/KeyBadge';
import { errorText, stepReason } from '../../src/errors';
import { Notice } from '../ui/Notice';
import { demoBchSigner, type BchSigner } from './bch';
import { useKeys } from './KeysContext';
import { WalletConnectOption } from './WalletConnectOption';
import { WizardConnectOption } from './WizardConnectOption';
import { walletConnectAvailable } from './walletconnect';

interface Props {
  pubkey: string;
  /** Called with a claim whose BCH checks all pass, and for an on-chain proof the transaction it was checked against. */
  onClaim: (claim: BchClaim, txLookups?: Record<string, TxLookup>) => void;
}

function failedSteps(result: ClaimResult, t: Translate): string {
  return result.steps
    .filter((s) => s.status === 'fail')
    .map((s) => stepReason(s, t) ?? t(`steps.${s.name}`))
    .join(' ');
}

/** Gets a BCH signature over the NIP-39 text for this npub, from a wallet, a pasted signature or a demo key. */
export function BchSign({ pubkey, onClaim }: Props) {
  const { t } = useText();
  const { bch, setBch } = useKeys();
  const npub = toNpub(pubkey);
  const text = verificationText(npub);
  const [address, setAddress] = useState('');
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const accept = (claim: BchClaim, txLookups?: Record<string, TxLookup>) => {
    const result = verifyClaim(claim.address, claim.signature, npub, pubkey, config.network, txLookups);
    if (result.ok) onClaim({ address: result.address, signature: claim.signature.trim() }, txLookups);
    else setError(failedSteps(result, t));
  };

  const signWith = async (signer: BchSigner) => {
    setBusy(true);
    setError('');
    try {
      accept({ address: signer.address, signature: await signer.signMessage(text) });
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const pickDemo = () => {
    const signer = demoBchSigner();
    setBch(signer);
    void signWith(signer);
  };

  return (
    <div className="picker">
      <h3 className="picker__title">{t('bch.title')}</h3>
      <CopyValue label={t('bch.textLabel')} value={text} />
      {bch ? (
        <div className="stack">
          <KeyBadge label={t('bch.signedBy')} value={bch.address} demo={bch.kind === 'demo'} onChange={() => setBch(null)} />
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void signWith(bch)}>
            {t('bch.wcSign')}
          </button>
          {busy && bch.kind === 'walletconnect' ? <Notice>{t('bch.wcSigning')}</Notice> : null}
        </div>
      ) : (
        <>
          <div className="option">
            <h4 className="option__title">{t('bch.wc')}</h4>
            <WalletConnectOption onConnected={setBch} />
          </div>
          {config.wizardConnect.enabled ? (
            <div className="option" data-option="wizardconnect">
              <h4 className="option__title">{t('wizard.title')}</h4>
              <WizardConnectOption npub={npub} onClaim={accept} />
            </div>
          ) : null}
          <div className="option">
            <button type="button" className={walletConnectAvailable() ? 'btn' : 'btn btn--primary'} disabled={busy} onClick={pickDemo}>
              {t('bch.demo')}
            </button>
            <p className="option__help">{t('bch.demoHelp')}</p>
          </div>
          <details className="more">
            <summary>{t('bch.paste')}</summary>
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                setError('');
                accept({ address, signature });
              }}
            >
              <p className="option__help">{t('bch.pasteHelp')}</p>
              <label className="field">
                <span className="field__label">{t('bch.addressLabel')}</span>
                <input className="input" name="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={`${config.network}:q`} autoComplete="off" spellCheck={false} />
              </label>
              <label className="field">
                <span className="field__label">{t('bch.signatureLabel')}</span>
                <textarea className="input input--area" name="signature" value={signature} onChange={(e) => setSignature(e.target.value)} rows={3} spellCheck={false} />
              </label>
              <button type="submit" className="btn" disabled={address.trim() === '' || signature.trim() === ''}>{t('bch.pasteCheck')}</button>
            </form>
          </details>
        </>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
