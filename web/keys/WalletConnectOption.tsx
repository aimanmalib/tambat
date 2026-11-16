import { useState } from 'react';
import { useText } from '../i18n';
import { errorText } from '../../src/errors';
import { Notice } from '../ui/Notice';
import { Qr } from '../ui/Qr';
import type { BchSigner } from './bch';
import { connectWallet, walletConnectAvailable } from './walletconnect';

/** Pairing with Paytaca over WalletConnect: QR on a computer, a link on the phone. */
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
          <Qr value={uri} label={t('bch.wc')} />
          <a className="btn" href={uri}>{t('bch.wcOpen')}</a>
        </div>
      ) : (
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void start()}>{t('bch.wcStart')}</button>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
