import type { BindingResult } from '../../src/core/verify';
import { useText } from '../i18n';
import { Checklist } from './Checklist';
import { HexId } from './HexId';
import { Recovery } from './Recovery';

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
          <dt key={`p-${c.address}`}>{t('lookup.proof')}</dt>,
          <dd key={`f-${c.address}`} data-proof-form={c.proof}>
            {t(c.proof === 'tx' ? 'lookup.proofTx' : 'lookup.proofMessage')}
            {c.txid ? <> <HexId value={c.txid} label={t('lookup.proofTxid')} /></> : null}
          </dd>,
        ])}
        <dt>{t('lookup.published')}</dt>
        <dd>{new Date(result.createdAt * 1000).toLocaleString(lang)}</dd>
      </dl>
      <Recovery result={result} />
      <Checklist result={result} />
    </>
  );
}
