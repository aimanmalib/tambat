import { toNpub } from '../src/core/nostr';
import type { BundleCheck } from '../src/core/reputation';
import { useText } from '../web/i18n';
import { Notice } from '../web/ui/Notice';

/**
 * The outcome of checking a pasted reputation bundle: the recount, what was counted and why each other credential
 * was not, or why the bundle was rejected. The anchor block is shown as a claim: this page reads no chain.
 */
export function BundleResult({ check, credentials }: { check: BundleCheck; credentials: number }) {
  const { t } = useText();
  if (!check.ok) {
    const reason = t(`repBundle.reason.${check.reason}`, { path: check.path ?? '' });
    return (
      <article className="result" data-ok="false" data-bundle-reason={check.reason}>
        <Notice tone="error">{t('repBundle.bad', { reason })}</Notice>
        {check.count ? <p className="option__help">{t('repBundle.recount', { count: check.count.counted.length })}</p> : null}
      </article>
    );
  }
  const { counted, excluded } = check.count;
  return (
    <article className="result" data-ok="true" data-bundle={counted.length}>
      <Notice tone="ok">{t('repBundle.ok', { count: counted.length, total: credentials })}</Notice>
      <dl className="vc">
        <div className="vc__row">
          <dt>{t('repBundle.holder')}</dt>
          <dd><code>{toNpub(check.holder)}</code></dd>
        </div>
        <div className="vc__row">
          <dt>{t('vc.binding')}</dt>
          <dd><code>{check.binding.eventId}</code></dd>
        </div>
        {counted.map((c) => (
          <div key={c.attestationEvent} className="vc__row" data-counted={c.issuer}>
            <dt>{t('repBundle.counted')}</dt>
            <dd><code>{toNpub(c.issuer.replace('did:nostr:', ''))}</code> {c.validFrom}</dd>
          </div>
        ))}
        {excluded.map((e) => (
          <div key={e.index} className="vc__row" data-skipped={e.reason}>
            <dt>{t('repBundle.skipped', { n: e.index + 1 })}</dt>
            <dd>{t(`repBundle.skip.${e.reason}`)}{e.problem ? ` ${t(`vc.reason.${e.problem}`, { path: e.path ?? '' })}` : ''}</dd>
          </div>
        ))}
        {check.anchor.kind !== 'none' ? (
          <div className="vc__row" data-anchor="claimed">
            <dt>{t('reputation.anchor')}</dt>
            <dd>{t('repBundle.anchorClaimed', { height: check.anchor.height })}</dd>
          </div>
        ) : null}
      </dl>
      <p className="option__help">{t('repBundle.offline')}</p>
    </article>
  );
}
