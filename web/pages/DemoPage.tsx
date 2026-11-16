import { useEffect, useState } from 'react';
import { createAuthEvent } from '../../src/core/auth';
import { getChallenge, getSession, login, logout, type SessionView } from '../api';
import { useText } from '../i18n';
import { useKeys } from '../keys/KeysContext';
import { NostrConnect } from '../keys/NostrConnect';
import { errorText, Notice } from '../ui/Notice';

/** The relying app: it only talks to /api/rp/*, and its server decides what the session shows. */
export function DemoPage() {
  const { t, lang } = useText();
  const { nostr, bch } = useKeys();
  const [session, setSession] = useState<SessionView | null>(null);
  const [alsoBch, setAlsoBch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getSession().then((r) => setSession(r.session), () => setSession(null));
  }, []);

  const signIn = async () => {
    if (!nostr) return;
    setBusy(true);
    setError('');
    try {
      const challenge = await getChallenge();
      const event = await nostr.sign(createAuthEvent({ origin: window.location.origin, nonce: challenge.nonce }));
      const bchSignature = alsoBch && bch ? await bch.signMessage(challenge.bchText) : undefined;
      setSession((await login(event, bchSignature)).session);
    } catch (e) {
      setError(`${t('demo.failed')}: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await logout().catch(() => undefined);
    setSession(null);
  };

  return (
    <section className="card card--app" aria-labelledby="demo-title">
      <h1 className="card__title" id="demo-title">{t('demo.title')}</h1>
      <p className="option__help">{t('demo.help')}</p>
      {session ? (
        <div className="stack" data-testid="session">
          <Notice tone="ok">{t('demo.signedIn')}</Notice>
          <dl className="facts">
            <dt>{t('lookup.nostrKey')}</dt>
            <dd><code>{session.npub}</code></dd>
            <dt>{t('demo.address')}</dt>
            <dd>{session.address ? <code>{session.address}</code> : t('demo.noAddress')}</dd>
            <dt>{t('demo.expires')}</dt>
            <dd>{new Date(session.expiresAt * 1000).toLocaleTimeString(lang)}</dd>
          </dl>
          {session.bchSigned ? <p className="option__help">{t('demo.bchSigned')}</p> : null}
          <button type="button" className="btn" onClick={() => void signOut()}>{t('demo.signOut')}</button>
        </div>
      ) : (
        <div className="stack">
          <NostrConnect headingLevel={2} />
          {nostr && bch ? (
            <label className="checkbox">
              <input type="checkbox" checked={alsoBch} onChange={(e) => setAlsoBch(e.target.checked)} />
              <span>{t('demo.alsoBch')}</span>
            </label>
          ) : null}
          {nostr ? (
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void signIn()}>
              {busy ? t('demo.signingIn') : t('demo.signIn')}
            </button>
          ) : null}
        </div>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </section>
  );
}
