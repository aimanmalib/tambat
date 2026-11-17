/**
 * The embeddable badge: /embed/<npub or address> is a small page other sites may frame, and /embed.js inserts that
 * frame next to the script tag. Only /embed/ relaxes frame-ancestors (config embed.frameAncestors); every other page
 * keeps the server policy, which forbids framing.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };
import { config, cspHeader } from '../src/config.js';
import { EMBED_PATH } from '../src/core/badge.js';

export { EMBED_PATH };

export const EMBED_SCRIPT = '/embed.js';

/** The server policy with frame-ancestors taken from config embed.frameAncestors. */
export function embedPolicy(): string {
  return cspHeader({ ...config.server.contentSecurityPolicy, 'frame-ancestors': config.embed.frameAncestors });
}

/**
 * The loader: for every `<script data-tambat-id="...">` (optionally `data-lang`) it inserts one iframe after the tag,
 * pointing at the origin the script was loaded from. Plain ES5 so it runs on any host page.
 */
export function loaderScript(): string {
  const titles = JSON.stringify({ en: en.embed.title, ms: ms.embed.title });
  return `(function () {
  var W = ${config.embed.width}, H = ${config.embed.height}, TITLES = ${titles};
  function mount(s) {
    var id = s.getAttribute('data-tambat-id');
    if (!id || s.getAttribute('data-tambat-done')) return;
    s.setAttribute('data-tambat-done', '1');
    var lang = s.getAttribute('data-lang') || '';
    var f = document.createElement('iframe');
    f.src = new URL(s.src).origin + '${EMBED_PATH}' + encodeURIComponent(id) + (lang ? '?lang=' + encodeURIComponent(lang) : '');
    f.width = String(W);
    f.height = String(H);
    f.title = TITLES[lang] || TITLES.en;
    f.style.border = '0';
    f.style.maxWidth = '100%';
    s.parentNode.insertBefore(f, s.nextSibling);
  }
  var list = document.querySelectorAll('script[data-tambat-id]');
  for (var i = 0; i < list.length; i++) mount(list[i]);
})();
`;
}

/** Registers /embed.js always and /embed/<id> when the built badge page exists. */
export function registerEmbed(app: FastifyInstance, staticRoot: string): void {
  const script = loaderScript();
  app.get(EMBED_SCRIPT, async (_req, reply) =>
    reply.type('text/javascript; charset=utf-8').header('cache-control', 'no-cache').send(script),
  );
  const file = join(staticRoot, config.embed.page);
  if (!existsSync(file)) return;
  const page = readFileSync(file);
  const policy = embedPolicy();
  app.get<{ Params: { id?: string } }>(`${EMBED_PATH}:id`, async (req, reply) => {
    // An empty id is not a badge; it gets the app like any unknown path, under the no-framing policy.
    if (!req.params.id) return reply.callNotFound();
    return reply.header('content-security-policy', policy).type('text/html; charset=utf-8').send(page);
  });
}
