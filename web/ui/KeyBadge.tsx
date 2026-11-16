import { useText } from '../i18n';

/** A connected key: what it is, its value, and a way to pick another. */
export function KeyBadge(props: { label: string; value: string; demo: boolean; onChange: () => void }) {
  const { t } = useText();
  return (
    <div className="keybadge">
      <div className="keybadge__head">
        <span className="keybadge__label">{props.label}</span>
        {props.demo ? <span className="tag">{t('common.demoBadge')}</span> : null}
        <button type="button" className="btn btn--link" onClick={props.onChange}>{t('common.change')}</button>
      </div>
      <code className="keybadge__value">{props.value}</code>
    </div>
  );
}
