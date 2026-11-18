import { useState } from 'react';
import { useText } from '../i18n';

/** Copies text to the clipboard; `copied` is true for two seconds after it worked. */
export function useCopy(value: string): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(value).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      },
      () => setCopied(false),
    );
  };
  return { copied, copy };
}

/** A value shown in full (wrapping, monospace) with a copy button. */
export function CopyValue({ label, value }: { label: string; value: string }) {
  const { t } = useText();
  const { copied, copy } = useCopy(value);
  return (
    <div className="value">
      <span className="value__label">{label}</span>
      <div className="value__row">
        <code className="value__text">{value}</code>
        <button type="button" className="btn btn--small" onClick={copy} aria-label={`${t('common.copy')}: ${label}`}>
          <span aria-live="polite">{copied ? t('common.copied') : t('common.copy')}</span>
        </button>
      </div>
    </div>
  );
}
