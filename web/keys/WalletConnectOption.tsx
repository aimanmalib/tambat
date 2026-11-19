import { useState } from 'react';
import { useText } from '../i18n';
import { errorText } from '../../src/errors';
import { CopyValue } from '../ui/Copy';
import { Notice } from '../ui/Notice';
import { Qr } from '../ui/Qr';
import type { BchSigner } from './bch';
import { connectWallet, walletConnectAvailable } from './walletconnect';

/** The steps for pairing a wallet on the same phone, where the QR code cannot be scanned (lang `bch.wcPhoneSteps`). */
const PHONE_STEPS = ['copy', 'open', 'paste', 'back'] as const;

/**
 * Pairing with Paytaca over WalletConnect: QR on a computer, a link on the phone. The pairing link is shown as text with
 * a copy button; on a narrow screen it comes before the QR code, because a phone cannot scan its own screen.
 */
export function WalletConnectOption({ onConnected }: { onConnected: (signer: BchSigner) => void }) {
  const { t } = useText();
  const [uri, setUri] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!walletConnectAvailable()) return <p className="option__help">{t('bch.wcUnavailable')}</p>;

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const pending = await connectWallet(t('app.name'), t('app.headline'));
      setUri(pending.uri);
      onConnected(await pending.approved);
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
      setUri('');
    }
  };

  return (
    <div className="stack">
      <p className="option__help">{t('bch.wcHelp')}</p>
      {uri ? (
        <div className="pairing">
          <Notice>{t('bch.wcWaiting')}</Notice>
          <div className="pairing__phone" data-pairing="phone">
            <CopyValue label={t('bch.wcLink')} value={uri} />
            <p className="pairing__title">{t('bch.wcPhoneTitle')}</p>
            <ol className="pairing__steps">
              {PHONE_STEPS.map((step) => <li key={step}>{t(`bch.wcPhoneSteps.${step}`)}</li>)}
            </ol>
          </div>
          <Qr value={uri} label={t('bch.wc')} />
          <a className="btn pairing__open" href={uri}>{t('bch.wcOpen')}</a>
        </div>
      ) : (
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void start()}>{t('bch.wcStart')}</button>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
