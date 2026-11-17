import { useState } from 'react';
import { config } from '../../src/config';
import { errorText } from '../../src/errors';
import { getChallenge, loginWithBch, type Challenge, type SessionView } from '../api';
import { useText } from '../i18n';
import type { BchSigner } from '../keys/bch';
import { useKeys } from '../keys/KeysContext';
import { WalletConnectOption } from '../keys/WalletConnectOption';
import { CopyValue } from '../ui/Copy';
import { KeyBadge } from '../ui/KeyBadge';
import { Notice } from '../ui/Notice';

/**
 * Sign-in with a BCH key only: a connected wallet (WalletConnect `bch_signMessage`, or the key used on the Link page)
 * signs the challenge text, or the user pastes a signature made in any wallet with Sign message.
 */
export function BchSignIn({ onSession }: { onSession: (session: SessionView) => void }) {
  const { t } = useText();
  const { bch, setBch } = useKeys();
  const [pasted, setPasted] = useState<Challenge | null>(null);
  const [address, setAddress] = useState('');
  const [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(`${t('demo.failed')}: ${errorText(e, t)}`);
    } finally {
      setBusy(false);
    }
  };

  const signWith = (signer: BchSigner) =>
    run(async () => {
      const challenge = await getChallenge();
      const sig = await signer.signMessage(challenge.bchText);
      onSession((await loginWithBch(signer.address, sig, challenge.nonce)).session);
    });

  const fetchChallenge = () => run(async () => setPasted(await getChallenge()));

  const submitPasted = () =>
    run(async () => {
      if (!pasted) return;
      setPasted(null);
      onSession((await loginWithBch(address, signature, pasted.nonce)).session);
    });

  return (
    <section className="picker" aria-labelledby="demo-bch-title">
      <h2 className="picker__title" id="demo-bch-title">{t('demo.bchTitle')}</h2>
      <p className="option__help">{t('demo.bchHelp')}</p>
      {bch ? (
        <div className="stack">
          <KeyBadge label={t('bch.signedBy')} value={bch.address} demo={bch.kind === 'demo'} onChange={() => setBch(null)} />
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void signWith(bch)}>
            {busy ? t('demo.signingIn') : t('demo.bchSignIn')}
          </button>
          {busy && bch.kind === 'walletconnect' ? <Notice>{t('bch.wcSigning')}</Notice> : null}
        </div>
      ) : (
        <div className="option">
          <h3 className="option__title">{t('bch.wc')}</h3>
          <WalletConnectOption onConnected={setBch} />
        </div>
      )}
      <details className="more">
        <summary>{t('demo.bchPaste')}</summary>
        <div className="stack">
          <p className="option__help">{t('demo.bchPasteHelp', { minutes: Math.round(config.auth.challengeTtlSeconds / 60) })}</p>
          {pasted ? (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void submitPasted();
              }}
            >
              <CopyValue label={t('demo.bchTextLabel')} value={pasted.bchText} />
              <label className="field">
                <span className="field__label">{t('bch.addressLabel')}</span>
                <input className="input" name="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={`${config.network}:q`} autoComplete="off" spellCheck={false} />
              </label>
              <label className="field">
                <span className="field__label">{t('bch.signatureLabel')}</span>
                <textarea className="input input--area" name="signature" value={signature} onChange={(e) => setSignature(e.target.value)} rows={3} spellCheck={false} />
              </label>
              <button type="submit" className="btn" disabled={busy || address.trim() === '' || signature.trim() === ''}>{t('demo.bchPasteSubmit')}</button>
            </form>
          ) : (
            <button type="button" className="btn" disabled={busy} onClick={() => void fetchChallenge()}>{t('demo.bchGetChallenge')}</button>
          )}
        </div>
      </details>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </section>
  );
}
