import { useId, useState } from 'react';
import { failedSteps, TAMPER_FIELDS, verifyTampered, type TamperField } from '../../src/core/tamper';
import type { BindingResult } from '../../src/core/verify';
import { useText } from '../i18n';
import { Checklist } from './Checklist';

/** Edits one field of a local copy of a verified binding and shows which named steps catch the edit. Publishes nothing. */
export function Tamper({ result }: { result: BindingResult }) {
  const { t } = useText();
  const name = useId();
  const [field, setField] = useState<TamperField>('content');
  const [tampered, setTampered] = useState<BindingResult | null>(null);
  const failed = tampered ? failedSteps(tampered) : [];
  return (
    <section className="tamper" aria-label={t('tamper.title')} data-tamper={tampered ? field : 'none'}>
      <h2 className="tamper__title">{t('tamper.title')}</h2>
      <p className="option__help">{t('tamper.help')}</p>
      <fieldset className="tamper__fields" disabled={tampered !== null}>
        <legend className="field__label">{t('tamper.choose')}</legend>
        {TAMPER_FIELDS.map((f) => (
          <label key={f} className="checkbox">
            <input type="radio" name={name} value={f} checked={field === f} onChange={() => setField(f)} />
            {t(`tamper.field.${f}`)}
          </label>
        ))}
      </fieldset>
      {tampered ? (
        <>
          <p className={`badge ${tampered.ok ? 'badge--ok' : 'badge--fail'} tamper__verdict`} role="status">{tampered.ok ? t('lookup.verified') : t('tamper.caught', { steps: failed.map((s) => t(`steps.${s}`)).join(', ') })}</p>
          <Checklist result={tampered} />
          <button type="button" className="btn" onClick={() => setTampered(null)}>{t('tamper.reset')}</button>
        </>
      ) : (
        <button type="button" className="btn" onClick={() => setTampered(verifyTampered(result, field))}>{t('tamper.try')}</button>
      )}
    </section>
  );
}
