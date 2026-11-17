import { config } from '../../src/config';
import { useText } from '../i18n';
import { CopyValue } from './Copy';

/** Event banner. Each link appears only when config.banner has a value for it. */
export function Banner() {
  const { t } = useText();
  const b = config.banner;
  return (
    <div className="banner">
      <strong>{t('banner.event')}</strong>
      <a href="/judges">{t('banner.judges')}</a>
      {b.deckUrl ? <a href={b.deckUrl}>{t('banner.presentation')}</a> : null}
      {b.repoUrl ? <a href={b.repoUrl}>{t('banner.source')}</a> : null}
      {b.contactAddress ? <CopyValue label={t('banner.address')} value={b.contactAddress} /> : null}
    </div>
  );
}
