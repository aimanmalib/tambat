import type { BindingResult, Step } from '../../src/core/verify';
import { useText } from '../i18n';

function StepRow({ step }: { step: Step }) {
  const { t } = useText();
  return (
    <li className={`check check--${step.status}`} data-step={step.name} data-status={step.status}>
      <span className="check__mark" aria-hidden="true">{step.status === 'pass' ? '✓' : step.status === 'fail' ? '✕' : '–'}</span>
      <span className="check__name">{t(`steps.${step.name}`)}</span>
      <span className="check__status">{t(`steps.${step.status}`)}</span>
      {step.reason ? <span className="check__reason">{step.reason}</span> : null}
    </li>
  );
}

/** Every named verification step of a binding, event steps first, then the steps of each BCH claim. */
export function Checklist({ result }: { result: BindingResult }) {
  const steps = [...result.steps, ...result.claims.flatMap((c) => c.steps)];
  return (
    <ol className="checklist">
      {steps.map((s, i) => (
        <StepRow key={`${s.name}-${i}`} step={s} />
      ))}
    </ol>
  );
}
