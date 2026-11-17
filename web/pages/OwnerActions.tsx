import { useState } from 'react';
import { config } from '../../src/config';
import { createRevocationEvent, replacingCreatedAt } from '../../src/core/binding';
import { publishEvent, type RelayOutcome } from '../../src/core/publish';
import type { BindingResult } from '../../src/core/verify';
import { errorText } from '../../src/errors';
import { useText } from '../i18n';
import { useKeys } from '../keys/KeysContext';
import { navigate } from '../router';
import { Notice } from '../ui/Notice';
import { RelayList } from '../ui/RelayList';

/**
 * Shown on a look-up result when the connected Nostr key is its author: revoke the link, or move it to a new
 * address (the Link page signs the new address and publishes one replacing event).
 */
export function OwnerActions({ result, onChanged }: { result: BindingResult; onChanged: () => void }) {
  const { t } = useText();
  const { nostr } = useKeys();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<RelayOutcome[] | null>(null);
  const [error, setError] = useState('');
  const previous = result.event;
  const address = result.claims[0]?.address;
  if (!nostr || nostr.pubkey !== result.pubkey || !previous || !address) return null;

  const revoke = async () => {
    setBusy(true);
    setError('');
    try {
      const event = await nostr.sign(createRevocationEvent(previous, replacingCreatedAt(previous)));
      setOutcomes(await publishEvent(event, config.nostr.relays, config.nostr.publishTimeoutMs));
      setConfirming(false);
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const accepted = outcomes?.filter((o) => o.ok).length ?? 0;
  return (
    <div className="picker owner">
      <h3 className="picker__title">{t('owner.title')}</h3>
      {outcomes ? (
        <div className="stack">
          <Notice tone={accepted > 0 ? 'ok' : 'error'}>{t('owner.done', { ok: accepted, total: outcomes.length })}</Notice>
          <RelayList outcomes={outcomes} />
          <button type="button" className="btn btn--primary" onClick={onChanged}>{t('owner.again')}</button>
        </div>
      ) : confirming ? (
        <div className="stack">
          <Notice>{t('owner.confirm', { address })}</Notice>
          <div className="row">
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void revoke()}>
              {busy ? t('owner.revoking') : t('owner.confirmYes')}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => setConfirming(false)}>{t('owner.cancel')}</button>
          </div>
        </div>
      ) : (
        <>
          <p className="option__help">{t('owner.help')}</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => setConfirming(true)}>{t('owner.revoke')}</button>
            <button type="button" className="btn" onClick={() => navigate('/')}>{t('owner.move')}</button>
          </div>
        </>
      )}
      {error ? <Notice tone="error">{error}</Notice> : null}
    </div>
  );
}
