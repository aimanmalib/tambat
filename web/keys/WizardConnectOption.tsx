import { useEffect, useRef, useState } from 'react';
import { config } from '../../src/config';
import type { BchClaim } from '../../src/core/binding';
import type { TxLookup } from '../../src/core/tx-proof';
import { errorText } from '../../src/errors';
import { useText } from '../i18n';
import { CopyValue, useCopy } from '../ui/Copy';
import { Notice } from '../ui/Notice';
import { Qr } from '../ui/Qr';
import { planProof, signProof, type ProofPlan, type ProofWallet } from './anchor-wizard';
import type { WizardSession } from './anchor-wizard-session';
import './wizard.css';

type Step =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'pairing'; uri: string }
  | { kind: 'planning'; name: string }
  | { kind: 'preview'; name: string; wallet: ProofWallet; plan: ProofPlan }
  | { kind: 'signing'; name: string };

/** A wizard's hat, the mark wallets use for WizardConnect. Drawn here; decorative. */
function WizardHat() {
  return (
    <svg className="wizard__hat" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2 6.5 16h11L12 2Z" className="wizard__hat-cone" />
      <path d="M3 17.5c0-.8 4-1.5 9-1.5s9 .7 9 1.5S17 20 12 20s-9-1.7-9-2.5Z" className="wizard__hat-brim" />
      <path d="m10.6 9.2.9-.4.4-.9.4.9.9.4-.9.4-.4.9-.4-.9-.9-.4Z" className="wizard__hat-star" />
    </svg>
  );
}

/** The pairing link as a QR code that copies the link when pressed, and the same link as text below it. */
function Pairing({ uri }: { uri: string }) {
  const { t } = useText();
  const { copied, copy } = useCopy(uri);
  return (
    <div className="pairing" data-pairing="wizard">
      <Notice>{t('wizard.waiting')}</Notice>
      <button type="button" className="wizard__qr" onClick={copy} aria-label={`${t('common.copy')}: ${t('wizard.qr')}`}>
        <Qr value={uri} label={t('wizard.qr')} />
      </button>
      <span className="wizard__copied" aria-live="polite">{copied ? t('common.copied') : t('wizard.qrHint')}</span>
      <CopyValue label={t('wizard.link')} value={uri} />
    </div>
  );
}

/**
 * The second wallet option on Link: a WizardConnect wallet signs a small transaction whose OP_RETURN is the NIP-39
 * text, the page checks it as a verifier would and sends it, and the binding carries `tx:<txid>` as its proof.
 */
export function WizardConnectOption({ npub, onClaim }: { npub: string; onClaim: (claim: BchClaim, txLookups: Record<string, TxLookup>) => void }) {
  const { t } = useText();
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [error, setError] = useState('');
  const session = useRef<WizardSession | null>(null);

  useEffect(() => () => session.current?.close(), []);

  const fail = (e: unknown) => {
    session.current?.close();
    session.current = null;
    setError(errorText(e, t));
    setStep({ kind: 'idle' });
  };

  const start = async () => {
    setError('');
    setStep({ kind: 'opening' });
    try {
      const { openWizardSession } = await import('./anchor-wizard-session');
      const s = await openWizardSession(t('app.name'));
      session.current = s;
      setStep({ kind: 'pairing', uri: s.uri });
      const { wallet, name } = await s.ready;
      setStep({ kind: 'planning', name });
      setStep({ kind: 'preview', name, wallet, plan: await planProof(wallet, npub) });
    } catch (e) {
      fail(e);
    }
  };

  const sign = async (name: string, wallet: ProofWallet, plan: ProofPlan) => {
    setError('');
    setStep({ kind: 'signing', name });
    try {
      const { claim, txLookups } = await signProof(wallet, plan, npub, t('wizard.prompt'));
      session.current?.close();
      session.current = null;
      onClaim(claim, txLookups);
    } catch (e) {
      setError(errorText(e, t));
      setStep({ kind: 'preview', name, wallet, plan });
    }
  };

  return (
    <div className="stack">
      <p className="option__help">{t('wizard.help')}</p>
      {step.kind === 'idle' || step.kind === 'opening' ? (
        <button type="button" className="btn wizard__start" disabled={step.kind === 'opening'} onClick={() => void start()}>
          <WizardHat />
          <span>{t('wizard.start')}</span>
        </button>
      ) : null}
      {step.kind === 'pairing' ? <Pairing uri={step.uri} /> : null}
      {step.kind === 'planning' ? <Notice>{t('wizard.planning', { wallet: step.name || t('wizard.wallet') })}</Notice> : null}
      {step.kind === 'preview' ? (
        <>
          <p className="option__help option__help--wrap">
            {t('wizard.preview', { address: step.plan.address, change: step.plan.changeSats, fee: step.plan.feeSats })}
          </p>
          <button type="button" className="btn btn--primary" onClick={() => void sign(step.name, step.wallet, step.plan)}>{t('wizard.sign')}</button>
        </>
      ) : null}
      {step.kind === 'signing' ? <Notice>{t('wizard.signing')}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <p className="wizard__note">
        {t('wizard.untested')}{' '}
        {t('wizard.license')} <a href={config.wizardConnect.sourceUrl} rel="noreferrer">{t('wizard.source')}</a>,{' '}
        <a href={config.wizardConnect.licenseUrl} rel="noreferrer">{t('wizard.licenseLink')}</a>.
      </p>
    </div>
  );
}
