import { useState } from 'react';
import { toNpub } from '../../src/core/nostr';
import { useText } from '../i18n';
import { KeyBadge } from '../ui/KeyBadge';
import { errorText } from '../../src/errors';
import { Notice } from '../ui/Notice';
import { useKeys } from './KeysContext';
import { bunkerSigner, demoNostrSigner, extensionSigner, hasExtension, type NostrSigner } from './nostr';

/** Picks the Nostr key. The extension is the main choice when one is installed; otherwise the demo key is. */
export function NostrConnect({ headingLevel = 3 }: { headingLevel?: 2 | 3 }) {
  const { t } = useText();
  const { nostr, setNostr } = useKeys();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [bunker, setBunker] = useState('');
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  if (nostr) {
    return (
      <KeyBadge label={t('nostr.connected')} value={toNpub(nostr.pubkey)} demo={nostr.kind === 'demo'} onChange={() => setNostr(null)} />
    );
  }

  const run = async (make: () => Promise<NostrSigner>) => {
    setBusy(true);
    setError('');
    try {
      setNostr(await make());
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };
  const extension = hasExtension();
  const pickDemo = () => run(async () => demoNostrSigner());

  return (
    <div className="picker">
      <Heading className="picker__title">{t('nostr.title')}</Heading>
      {extension ? (
        <div className="option">
          <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void run(extensionSigner)}>
            {t('nostr.extension')}
          </button>
          <p className="option__help">{t('nostr.extensionHelp')}</p>
        </div>
      ) : null}
      <div className="option">
        <button type="button" className={extension ? 'btn' : 'btn btn--primary'} disabled={busy} onClick={() => void pickDemo()}>
          {t('nostr.demo')}
        </button>
        <p className="option__help">{t('nostr.demoHelp')}</p>
      </div>
      {!extension ? <p className="option__help">{t('nostr.extensionMissing')}</p> : null}
      <details className="more">
        <summary>{t('nostr.bunker')}</summary>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => bunkerSigner(bunker));
          }}
        >
          <p className="option__help">{t('nostr.bunkerHelp')}</p>
          <label className="field">
            <span className="field__label">{t('nostr.bunkerLabel')}</span>
            <input className="input" value={bunker} onChange={(e) => setBunker(e.target.value)} placeholder="bunker://" autoComplete="off" spellCheck={false} />
          </label>
          <button type="submit" className="btn" disabled={busy || bunker.trim() === ''}>{t('nostr.bunkerConnect')}</button>
        </form>
      </details>
      {busy ? <Notice>{t('common.working')}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
