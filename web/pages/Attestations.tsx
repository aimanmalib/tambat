import { useEffect, useState } from 'react';
import { attestationsOf } from '../../src/core/attest-find';
import type { AttestationSummary, ParsedAttestation } from '../../src/core/attest';
import { credentialFileName, credentialFrom } from '../../src/core/vc';
import { toNpub } from '../../src/core/nostr';
import type { BindingResult } from '../../src/core/verify';
import { useText } from '../i18n';
import { Notice } from '../ui/Notice';
import { HexId } from '../ui/HexId';

/** The attestation as a W3C Verifiable Credential 2.0 file, built here from the two checked events (ADR 0017). */
function CredentialLink({ attestation, binding }: { attestation: ParsedAttestation; binding: BindingResult }) {
  const { t } = useText();
  if (!binding.event) return null;
  const vc = credentialFrom(attestation, binding);
  const href = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(vc, null, 2))}`;
  return (
    <p className="option__help attest__vc">
      <a className="btn btn--small" href={href} download={credentialFileName(vc)} data-vc={vc.credentialSubject.attestationEvent}>
        {t('attest.vcDownload')}
      </a>{' '}
      {t('attest.vcHelp')}
    </p>
  );
}

/**
 * Attestations of a verified binding, read from the relays in the browser: other keys that signed "verified" for
 * this exact binding event. Attestations of an earlier binding of the same key no longer count and are only counted.
 */
export function Attestations({ result }: { result: BindingResult }) {
  const { t, lang } = useText();
  const [summary, setSummary] = useState<AttestationSummary | null>(null);
  useEffect(() => {
    let live = true;
    void attestationsOf(result.pubkey, {}, result).then(
      (s) => live && setSummary(s),
      () => live && setSummary({ current: [], replaced: 0 }),
    );
    return () => {
      live = false;
    };
  }, [result]);

  return (
    <div className="picker attest" data-attest={summary ? summary.current.length : 'checking'}>
      <h3 className="picker__title">{t('attest.title')}</h3>
      {!summary ? <Notice>{t('attest.checking')}</Notice> : null}
      {summary && summary.current.length === 0 ? <Notice>{t('attest.none')}</Notice> : null}
      {summary && summary.current.length > 0 ? (
        <ul className="attest__list">
          {summary.current.map((a) => (
            <li key={a.event.id} className="attest__item">
              <Notice tone="ok">{t('attest.by', { date: new Date(a.event.created_at * 1000).toLocaleDateString(lang, { dateStyle: 'medium' }) })}</Notice>
              <p className="option__help attest__who"><code>{toNpub(a.attester)}</code></p>
              <p className="option__help attest__who">{t('attest.event')} <HexId value={a.event.id} label={t('attest.event')} /></p>
              <CredentialLink attestation={a} binding={result} />
            </li>
          ))}
        </ul>
      ) : null}
      {summary && summary.replaced > 0 ? <p className="option__help">{t('attest.replaced', { count: summary.replaced })}</p> : null}
      <p className="option__help">{t('attest.help')}</p>
    </div>
  );
}
