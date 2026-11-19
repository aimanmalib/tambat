import { useEffect, useRef } from 'react';
import { config } from '../../src/config';
import { EMBED_PATH } from '../../src/core/badge';
import { embedSnippets } from '../../src/core/embed-code';
import { useText } from '../i18n';
import { queryParam } from '../router';
import { EMBED_OPEN_PARAM } from '../judges/links';
import { CopyValue } from './Copy';

/** "Embed this badge": the script tag and the iframe for one verified identity, each with a copy button. */
export function EmbedCode({ npub }: { npub: string }) {
  const { t, lang } = useText();
  const ref = useRef<HTMLDetailsElement>(null);
  const opened = queryParam(EMBED_OPEN_PARAM) === '1';
  useEffect(() => {
    if (opened) ref.current?.scrollIntoView({ block: 'start' });
  }, [opened]);
  const code = embedSnippets(window.location.origin, npub, lang, config.embed, t('embed.title'));
  return (
    <details className="more" id="embed" data-embed ref={ref} open={opened}>
      <summary>{t('lookup.embed.title')}</summary>
      <p className="option__help">{t('lookup.embed.help')}</p>
      <CopyValue label={t('lookup.embed.script')} value={code.script} />
      <CopyValue label={t('lookup.embed.iframe')} value={code.iframe} />
      <a href={`${EMBED_PATH}${encodeURIComponent(npub)}?lang=${encodeURIComponent(lang)}`} target="_blank" rel="noopener">
        {t('lookup.embed.preview')}
      </a>
    </details>
  );
}
