import type { BindingResult } from '../../src/core/verify';
import { useText } from '../i18n';
import { Checklist } from './Checklist';

/** Verdict, the keys a binding names, when it was published and every verification step. Shared by look-up and the verifier. */
export function BindingSummary({ result }: { result: BindingResult }) {
  const { t, lang } = useText();
  return (
    <>
      <p className={`badge ${result.ok ? 'badge--ok' : 'badge--fail'}`}>{result.ok ? t('lookup.verified') : t('lookup.failed')}</p>
      <dl className="facts">
        <dt>{t('lookup.nostrKey')}</dt>
        <dd><code>{result.npub}</code></dd>
        {result.claims.map((c) => [
          <dt key={`t-${c.address}`}>{t('lookup.bchAddress')}</dt>,
          <dd key={`d-${c.address}`}><code>{c.address}</code></dd>,
        ])}
        <dt>{t('lookup.published')}</dt>
        <dd>{new Date(result.createdAt * 1000).toLocaleString(lang)}</dd>
      </dl>
      <Checklist result={result} />
    </>
  );
}
