import { useText } from '../i18n';
import { useCopy } from './Copy';

/** First 8 and last 4 characters of a long hex id, the form used across the site. */
export const shortHex = (value: string): string => (value.length > 13 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value);

/**
 * A 64-character id shortened in the middle so it never widens a card, with the full value in `title` and on the
 * clipboard. The copy button announces "Copied" through a live region.
 */
export function HexId({ value, label }: { value: string; label: string }) {
  const { t } = useText();
  const { copied, copy } = useCopy(value);
  return (
    <span className="hexid">
      <code className="hexid__text" title={value} data-full={value}>{shortHex(value)}</code>
      <button type="button" className="hexid__copy" onClick={copy} aria-label={`${t('common.copy')}: ${label}`}>
        <span aria-live="polite">{copied ? t('common.copied') : t('common.copy')}</span>
      </button>
    </span>
  );
}
