import { toNpub } from '../src/core/nostr';
import type { VcCheck } from '../src/core/vc';
import { useText } from '../web/i18n';
import { Notice } from '../web/ui/Notice';

/** The outcome of checking a pasted attestation credential: what it says when it verifies, the reason when not. */
export function CredentialResult({ check }: { check: VcCheck }) {
  const { t } = useText();
  if (!check.ok) {
    const reason = t(`vc.reason.${check.reason}`, { path: check.path ?? '' });
    return (
      <article className="result" data-ok="false" data-vc-reason={check.reason}>
        <Notice tone="error">{t('vc.bad', { reason })}</Notice>
      </article>
    );
  }
  const s = check.credential.credentialSubject;
  const rows: [string, string][] = [
    ['vc.issuer', toNpub(check.attestation.attester)],
    ['vc.subject', toNpub(check.attestation.subject)],
    ...s.bchAddress.map((a): [string, string] => ['vc.address', a]),
    ['vc.binding', s.bindingEvent],
    ['vc.attestation', s.attestationEvent],
    ['vc.validFrom', check.credential.validFrom],
  ];
  return (
    <article className="result" data-ok="true" data-vc="ok">
      <Notice tone="ok">{t('vc.ok')}</Notice>
      <dl className="vc">
        {rows.map(([key, value], i) => (
          <div key={`${key}-${i}`} className="vc__row">
            <dt>{t(key)}</dt>
            <dd><code>{value}</code></dd>
          </div>
        ))}
      </dl>
      <p className="option__help">{t('vc.current')}</p>
    </article>
  );
}
