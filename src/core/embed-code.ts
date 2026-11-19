/**
 * The two snippets another site pastes to show the badge for one identity: a script tag (it inserts the frame) and a
 * plain iframe. Both point at the origin the snippets were copied from, so a copy from any deployment embeds that one.
 */
import { EMBED_PATH } from './badge.js';

export const EMBED_SCRIPT_PATH = '/embed.js';

export interface EmbedSnippets {
  script: string;
  iframe: string;
}

/** Escapes a value for a double-quoted HTML attribute. */
const attr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function embedSnippets(
  origin: string,
  id: string,
  lang: string,
  size: { width: number; height: number },
  title: string,
): EmbedSnippets {
  const base = new URL(origin).origin;
  const frameSrc = `${base}${EMBED_PATH}${encodeURIComponent(id)}?lang=${encodeURIComponent(lang)}`;
  return {
    script: `<script src="${attr(base + EMBED_SCRIPT_PATH)}" data-tambat-id="${attr(id)}" data-lang="${attr(lang)}" async></script>`,
    iframe:
      `<iframe src="${attr(frameSrc)}" width="${size.width}" height="${size.height}" title="${attr(title)}"` +
      ` style="border:0;max-width:100%"></iframe>`,
  };
}
