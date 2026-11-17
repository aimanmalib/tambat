/** The badge page: reads the identity from the path, checks it on relays in this browser and shows one of four states. */
import en from '../../lang/en.json';
import ms from '../../lang/ms.json';
import { config } from '../../src/config';
import { badgeStatus, EMBED_PATH, shortAddress, shortNpub, type BadgeState } from '../../src/core/badge';
import { createProbe } from '../../src/core/probe';
import { translator, type Dictionary } from '../../src/i18n';
import './embed.css';

const dictionaries: Record<string, Dictionary> = { en, ms };
const asked = new URLSearchParams(location.search).get('lang') ?? '';
const lang = asked in dictionaries ? asked : config.site.defaultLanguage;
const t = translator(dictionaries[lang] ?? en);
document.documentElement.lang = lang;
document.title = t('embed.title');

const id = (() => {
  try {
    return decodeURIComponent(location.pathname.slice(EMBED_PATH.length)).trim();
  } catch {
    return '';
  }
})();

const root = document.querySelector<HTMLElement>('.embed');
const stateLine = document.querySelector<HTMLElement>('.embed__state');
const detail = document.querySelector<HTMLElement>('.embed__detail');
const open = document.querySelector<HTMLAnchorElement>('.embed__open');

const TEXT: Record<BadgeState['state'] | 'checking', string> = {
  checking: 'embed.checking',
  verified: 'embed.verified',
  not_linked: 'embed.notLinked',
  unreachable: 'embed.unreachable',
  bad_input: 'embed.badInput',
};

function show(state: BadgeState | { state: 'checking' }): void {
  if (!root || !stateLine || !detail || !open) return;
  root.dataset.state = state.state;
  stateLine.textContent = t(TEXT[state.state]);
  detail.textContent = state.state === 'verified' ? `${shortNpub(state.npub)} · ${shortAddress(state.address)}` : t('embed.checkedHere');
  open.textContent = t('embed.open');
  open.href = `/lookup?q=${encodeURIComponent(id)}&lang=${lang}`;
}

show({ state: 'checking' });
void badgeStatus(id, { probe: createProbe() }).then(show, () => show({ state: 'unreachable' }));
