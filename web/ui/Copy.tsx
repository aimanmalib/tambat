import { useState } from 'react';
import { useText } from '../i18n';

/** A value shown in full (wrapping, monospace) with a copy button. */
export function CopyValue({ label, value }: { label: string; value: string }) {
  const { t } = useText();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="value">
      <span className="value__label">{label}</span>
      <div className="value__row">
        <code className="value__text">{value}</code>
        <button type="button" className="btn btn--small" onClick={() => void copy()} aria-label={`${t('common.copy')}: ${label}`}>
          <span aria-live="polite">{copied ? t('common.copied') : t('common.copy')}</span>
        </button>
      </div>
    </div>
  );
}
