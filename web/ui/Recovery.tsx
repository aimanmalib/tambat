import type { BindingResult } from '../../src/core/verify';
import { useText } from '../i18n';
import { Notice } from './Notice';
import { StepList } from './Checklist';

/**
 * What a recovery claim means for this binding: this key took over from a lost key (or the claim was refused, with
 * its steps), and, in an address look-up, that the owner of the address has since moved to another key.
 */
export function Recovery({ result }: { result: BindingResult }) {
  const { t } = useText();
  const r = result.recovery;
  return (
    <>
      {result.recoveredBy ? <Notice>{t('recovery.by', { npub: result.recoveredBy })}</Notice> : null}
      {r ? (
        <div className="recovery" data-recovered={r.ok}>
          <Notice tone={r.ok ? 'ok' : 'info'}>{t(r.ok ? 'recovery.from' : 'recovery.refused', { npub: r.from })}</Notice>
          <details className="more" open={!r.ok}>
            <summary>{t('recovery.title')}</summary>
            <StepList steps={r.steps} />
          </details>
        </div>
      ) : null}
    </>
  );
}
