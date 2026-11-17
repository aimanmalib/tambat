import { useEffect, useState } from 'react';
import { config } from '../../src/config';
import { claimsOf, createBindingEvent, createRotationEvent, replacingCreatedAt, type BchClaim } from '../../src/core/binding';
import { lookupByPubkey } from '../../src/core/discover';
import type { Event } from '../../src/core/nostr';
import { publishEvent, type RelayOutcome } from '../../src/core/publish';
import { verifyBinding, type BindingResult } from '../../src/core/verify';
import { useText } from '../i18n';
import { BchSign } from '../keys/BchSign';
import { useKeys } from '../keys/KeysContext';
import { NostrConnect } from '../keys/NostrConnect';
import { navigate } from '../router';
import { Checklist } from '../ui/Checklist';
import { errorText } from '../../src/errors';
import { Notice } from '../ui/Notice';
import { RelayList } from '../ui/RelayList';

/** The three steps: connect Nostr, get a BCH signature, sign and publish the NIP-39 event. */
export function LinkPage() {
  const { t } = useText();
  const { nostr } = useKeys();
  // State is tagged with the key it belongs to, so picking another key starts the flow again.
  const [claimed, setClaimed] = useState<{ pubkey: string; claim: BchClaim } | null>(null);
  const [found, setFound] = useState<{ pubkey: string; event: Event | null } | null>(null);
  const [result, setResult] = useState<BindingResult | null>(null);
  const [outcomes, setOutcomes] = useState<RelayOutcome[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pubkey = nostr?.pubkey ?? '';

  const claim = claimed && claimed.pubkey === pubkey ? claimed.claim : null;
  const previous = found && found.pubkey === pubkey ? found.event : null;

  useEffect(() => {
    if (!pubkey) return;
    let live = true;
    void lookupByPubkey(pubkey).then((r) => {
      if (live) setFound({ pubkey, event: r?.event ?? null });
    });
    return () => {
      live = false;
    };
  }, [pubkey]);

  const setClaim = (c: BchClaim) => {
    setResult(null);
    setOutcomes(null);
    setClaimed({ pubkey, claim: c });
  };

  const step = !nostr ? 1 : !claim ? 2 : 3;
  // An address this key is already linked to: publishing a different one moves the link (rotation).
  const current = previous ? claimsOf(previous)[0]?.address : undefined;
  const moving = current !== undefined && claim !== null && current.toLowerCase() !== claim.address.toLowerCase();
  const keptOthers = (previous?.tags ?? []).some((tag) => tag[0] === 'i' && !tag[1]?.startsWith(`${config.nostr.platform}:`));

  const publish = async () => {
    if (!nostr || !claim) return;
    setBusy(true);
    setError('');
    try {
      // The new event must be newer than the one it replaces, even within the same second.
      const createdAt = replacingCreatedAt(previous);
      const template =
        moving && previous && current
          ? createRotationEvent(previous, current, claim, createdAt)
          : createBindingEvent({ claim, previous, createdAt });
      const event = await nostr.sign(template);
      // The event found on relays before signing is the one this replaces; the new event must be newer.
      const checked = verifyBinding(event, { sameAuthorEvents: previous ? [previous] : [] });
      setResult(checked);
      if (checked.ok) setOutcomes(await publishEvent(event, config.nostr.relays, config.nostr.publishTimeoutMs));
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const accepted = outcomes?.filter((o) => o.ok).length ?? 0;

  return (
    <section className="card" aria-labelledby="link-step">
      <h2 className="card__step" id="link-step">
        {t('link.step', { n: step })}: <strong>{t(`link.step${step}`)}</strong>
      </h2>
      <ol className="progress" aria-hidden="true">
        {[1, 2, 3].map((n) => (
          <li key={n} className={n < step ? 'is-done' : n === step ? 'is-now' : ''} />
        ))}
      </ol>
      <NostrConnect />
      {nostr && !claim ? <BchSign pubkey={nostr.pubkey} onClaim={setClaim} /> : null}
      {nostr && claim ? (
        <div className="picker">
          <h3 className="picker__title">{t('link.review')}</h3>
          <dl className="facts">
            <dt>{t('lookup.bchAddress')}</dt>
            <dd><code>{claim.address}</code></dd>
          </dl>
          {moving ? <Notice>{t('link.moving', { address: current ?? '' })}</Notice> : null}
          {keptOthers ? <p className="option__help">{t('link.kept')}</p> : null}
          {result ? <Checklist result={result} /> : null}
          {result && !result.ok ? <Notice tone="error">{t('link.invalid')}</Notice> : null}
          {!outcomes ? (
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void publish()}>
              {busy ? t('link.publishing') : t('link.publish')}
            </button>
          ) : (
            <div className="stack">
              <Notice tone={accepted > 0 ? 'ok' : 'error'}>{t('link.result', { ok: accepted, total: outcomes.length })}</Notice>
              <RelayList outcomes={outcomes} />
              <div className="row">
                <button type="button" className="btn btn--primary" onClick={() => navigate('/lookup', `?q=${encodeURIComponent(claim.address)}`)}>
                  {t('link.lookUp')}
                </button>
                <button type="button" className="btn" onClick={() => navigate('/demo')}>{t('link.signIn')}</button>
              </div>
            </div>
          )}
          {error ? <Notice tone="error">{error}</Notice> : null}
        </div>
      ) : null}
    </section>
  );
}
