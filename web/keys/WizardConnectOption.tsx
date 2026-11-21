import { useEffect, useRef, useState } from 'react';
import { config } from '../../src/config';
import type { BchClaim } from '../../src/core/binding';
import type { TxLookup } from '../../src/core/tx-proof';
import { errorText, TextError } from '../../src/errors';
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
    let s: WizardSession | undefined;
    /** False once the wallet left or the page closed this session: later results of it are dropped. */
    const live = () => s !== undefined && session.current === s;
    try {
      const { openWizardSession } = await import('./anchor-wizard-session');
      const opened = await openWizardSession(t('app.name'));
      s = opened;
      session.current = opened;
      // The wallet can end the session at any step (pairing, planning, preview, signing): back to the start, saying so.
      opened.onClose(() => {
        if (session.current === opened) fail(new TextError('wizard.disconnected'));
      });
      setStep({ kind: 'pairing', uri: opened.uri });
      const { wallet, name } = await opened.ready;
      if (!live()) return;
      setStep({ kind: 'planning', name });
      const plan = await planProof(wallet, npub);
      if (live()) setStep({ kind: 'preview', name, wallet, plan });
    } catch (e) {
      if (s === undefined || live()) fail(e);
    }
  };

  const sign = async (name: string, wallet: ProofWallet, plan: ProofPlan) => {
    const s = session.current;
    setError('');
    setStep({ kind: 'signing', name });
    try {
      const { claim, txLookups } = await signProof(wallet, plan, npub, t('wizard.prompt'));
      if (session.current !== s) return;
      session.current?.close();
      session.current = null;
      onClaim(claim, txLookups);
    } catch (e) {
      // The wallet left while it was asked to sign: onClose already went back to the start.
      if (session.current !== s) return;
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
          {step.plan.unconfirmed ? <p className="option__help option__help--wrap" data-unconfirmed="yes">{t('wizard.previewUnconfirmed')}</p> : null}
          <button type="button" className="btn btn--primary" onClick={() => void sign(step.name, step.wallet, step.plan)}>{t('wizard.sign')}</button>
        </>
      ) : null}
      {step.kind === 'signing' ? <Notice>{t('wizard.signing')}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <p className="wizard__note">
        {t('wizard.tested')}{' '}
        {t('wizard.license')} <a href={config.wizardConnect.sourceUrl} rel="noreferrer">{t('wizard.source')}</a>,{' '}
        <a href={config.wizardConnect.licenseUrl} rel="noreferrer">{t('wizard.licenseLink')}</a>.
      </p>
    </div>
  );
}
