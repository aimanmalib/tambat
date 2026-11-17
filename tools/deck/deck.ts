/**
 * The event deck as HTML: one 1920 x 1080 page per slide, drawn with the app's own design tokens. build.ts prints it to
 * web/public/deck.pdf; the tests read the same inputs to tell whether that PDF is out of date.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import qrcode from 'qrcode-generator';

export const ROOT = resolve(import.meta.dirname, '../..');
export const OUT = 'web/public/deck.pdf';
export const STAMP = 'tools/deck/deck.sha256';
/** Every file the deck is made from, plus the config values it prints. A change to any of them means a new PDF. */
export const INPUTS = ['tools/deck/slides.json', 'tools/deck/deck.ts', 'web/tokens.css'];

export interface Item { text: string; measured?: string }
export interface Slide {
  template: string;
  kind: 'title' | 'tagline' | 'list' | 'thanks';
  title: string;
  lines?: string[];
  items?: Item[];
  numbered?: boolean;
  link?: 'repo';
}
interface Banner { deckUrl: string; repoUrl: string; contactAddress: string }

const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');
const deckConfig = () => {
  const c = JSON.parse(read('config/tambat.json')) as { site: { publicUrl: string }; banner: Banner };
  return { site: c.site.publicUrl, banner: c.banner };
};
export const loadSlides = (): Slide[] => (JSON.parse(read('tools/deck/slides.json')) as { slides: Slide[] }).slides;

/** sha256 over the inputs, in order, each with its name, so the stamp changes when any of them does. */
export function inputsHash(): string {
  const h = createHash('sha256');
  for (const f of INPUTS) h.update(`${f}\0${read(f)}\0`);
  h.update(JSON.stringify(deckConfig()));
  return h.digest('hex');
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

function qrSvg(text: string): string {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 10, margin: 2, scalable: true });
}

function body(s: Slide, n: number, total: number, site: string, banner: Banner): string {
  const foot = `<footer><span>Tambat</span><span>${esc(host(site))}</span><span>${n} / ${total}</span></footer>`;
  if (s.kind === 'title' || s.kind === 'tagline') {
    const lines = (s.lines ?? []).map((l) => `<p>${esc(l)}</p>`).join('');
    const link = s.link === 'repo' ? `<p class="link">${esc(host(banner.repoUrl))}</p>` : '';
    return `<section class="slide slide--${s.kind}"><div class="mark"></div><h1>${esc(s.title)}</h1>${lines}${link}${foot}</section>`;
  }
  if (s.kind === 'thanks') {
    const rows: [string, string][] = [['Live demo', host(site)], ['Source code', host(banner.repoUrl)], ['BCH address', banner.contactAddress]];
    const dl = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    return `<section class="slide slide--thanks"><div class="mark"></div><h1>${esc(s.title)}</h1><div class="thanks"><dl>${dl}</dl><figure>${qrSvg(site)}<figcaption>${esc(host(site))}</figcaption></figure></div>${foot}</section>`;
  }
  const tag = s.numbered ? 'ol' : 'ul';
  const items = (s.items ?? []).map((i) => `<li>${esc(i.text)}${i.measured ? '<span class="src">measured</span>' : ''}</li>`).join('');
  return `<section class="slide"><h2>${esc(s.title)}</h2><${tag}>${items}</${tag}>${foot}</section>`;
}

const CSS = `
@page { size: 1920px 1080px; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--font-text); }
.slide { position: relative; width: 1920px; height: 1080px; padding: 100px 160px; overflow: hidden; break-after: page; background: var(--paper); }
.slide:last-child { break-after: auto; }
h1, h2 { font-family: var(--font-display); font-weight: 600; margin: 0; line-height: 1.1; }
h1 { font-size: 160px; margin-top: 200px; }
h2 { font-size: 84px; margin-bottom: 56px; }
.mark { position: absolute; left: 0; top: 0; bottom: 0; width: 32px; background: var(--accent); }
.slide--title p, .slide--tagline p { font-size: 48px; margin: 32px 0 0; max-width: 1400px; color: var(--ink-soft); }
.slide--title p:first-of-type { color: var(--ink); }
.slide--tagline h1 { margin-top: 160px; }
.slide--tagline p { color: var(--ink); line-height: 1.3; }
p.link { font-family: var(--font-mono); font-size: 40px; color: var(--accent); }
ul, ol { margin: 0; padding-left: 64px; font-size: 40px; line-height: 1.35; max-width: 1560px; }
li { margin-bottom: 28px; padding-left: 16px; }
li::marker { color: var(--accent); font-weight: 600; }
.src { display: inline-block; margin-left: 20px; padding: 2px 16px; border-radius: var(--radius); font-size: 26px;
  vertical-align: middle; background: var(--accent-pale); color: var(--ink); }
.slide--thanks h1 { margin-top: 40px; font-size: 128px; }
.thanks { display: flex; gap: 96px; align-items: flex-start; margin-top: 72px; }
dl { margin: 0; flex: 1 1 auto; min-width: 0; }
dt { font-size: 32px; color: var(--ink-soft); }
dd { margin: 4px 0 40px; font-family: var(--font-mono); font-size: 40px; overflow-wrap: anywhere; }
figure { margin: 0; width: 360px; text-align: center; }
figure svg { width: 360px; height: 360px; background: var(--card); }
figcaption { font-size: 26px; color: var(--ink-soft); }
footer { position: absolute; left: 160px; right: 160px; bottom: 56px; display: flex; justify-content: space-between;
  font-size: 26px; color: var(--ink-soft); border-top: 2px solid var(--line); padding-top: 20px; }
`;

/** The whole deck as one HTML document. */
export function deckHtml(): string {
  const { site, banner } = deckConfig();
  const slides = loadSlides();
  const pages = slides.map((s, i) => body(s, i + 1, slides.length, site, banner)).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tambat</title><style>${read('web/tokens.css')}${CSS}</style></head><body>${pages}</body></html>`;
}
