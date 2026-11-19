import { toNpub } from '../src/core/nostr';
import type { BchAddressValue, SdCheck } from '../src/core/sd';
import { useText } from '../web/i18n';
import { Notice } from '../web/ui/Notice';

/**
 * The outcome of checking a pasted selective disclosure presentation (ADR 0019): the revealed fields, how many stay
 * hidden, or the named reason it was rejected. Hidden values are never known here, only counted.
 */
export function SdResult({ check }: { check: SdCheck }) {
  const { t } = useText();
  if (!check.ok) {
    return (
      <article className="result" data-ok="false" data-sd-reason={check.reason}>
        <Notice tone="error">{t('sdProof.bad', { reason: t(`sdProof.reason.${check.reason}`, { path: check.path ?? '' }) })}</Notice>
      </article>
    );
  }
  return (
    <article className="result" data-ok="true" data-sd-hidden={check.hidden}>
      <Notice tone="ok">{t('sdProof.ok')}</Notice>
      <dl className="vc">
        <div className="vc__row">
          <dt>{t('sdProof.holder')}</dt>
          <dd><code>{toNpub(check.holder)}</code></dd>
        </div>
        <div className="vc__row">
          <dt>{t('sdProof.issued')}</dt>
          <dd>{check.validFrom}</dd>
        </div>
        {check.disclosed.map((d) => (
          <div key={d.name} className="vc__row" data-revealed={d.name}>
            <dt>{t(`sdProof.field.${d.name}`)}</dt>
            {d.name === 'bchAddress' ? (
              <dd>
                <code>{(d.value as BchAddressValue).address}</code>
                <span className="option__help">{t('sdProof.addressChecked')}</span>
              </dd>
            ) : (
              <dd><code>{String(d.value)}</code></dd>
            )}
          </div>
        ))}
        <div className="vc__row" data-hidden-count={check.hidden}>
          <dt>{t('sdProof.hiddenLabel')}</dt>
          <dd>{check.hidden > 0 ? t('sdProof.hidden', { hidden: check.hidden, fields: check.fields }) : t('sdProof.hiddenNone')}</dd>
        </div>
      </dl>
      <p className="option__help">{t('sdProof.offline')}</p>
    </article>
  );
}
