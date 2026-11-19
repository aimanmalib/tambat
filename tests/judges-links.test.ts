/** Every line of /judges must open something real: a file in this tree, a heading in it, or the release the README installs from. */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { CRITERIA, releaseUrl, REQUIREMENTS } from '../web/judges/links.js';
import { ROUTES } from '../web/router.js';
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };
import rootPkg from '../package.json' with { type: 'json' };

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const all = [...REQUIREMENTS.flatMap((r) => r.links), ...CRITERIA];
const blob = `${config.judges.repoUrl}/blob/main/`;
const tree = `${config.judges.repoUrl}/tree/main/`;

/** GitHub's anchor for a markdown heading: lower case, punctuation dropped, spaces to hyphens. */
const slug = (heading: string) => heading.trim().toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-');
const anchorsOf = (md: string) => md.split('\n').filter((l) => /^#{1,6} /.test(l)).map((l) => slug(l.replace(/^#+ /, '')));

describe('/judges links', () => {
  it('each repository link names a file or folder that exists in this tree, and each #anchor a heading in it', () => {
    const repoLinks = all.filter((l) => l.href.startsWith(config.judges.repoUrl) && !l.href.includes('/releases/'));
    expect(repoLinks.length).toBeGreaterThan(10);
    for (const { key, href } of repoLinks) {
      const [url = '', anchor] = href.split('#');
      const isFile = url.startsWith(blob);
      const path = url.slice((isFile ? blob : tree).length);
      expect(url.startsWith(isFile ? blob : tree), `${key}: ${href}`).toBe(true);
      expect(existsSync(new URL(path, root)), `${key}: ${path} missing`).toBe(true);
      expect(statSync(new URL(path, root)).isFile(), `${key}: ${path}`).toBe(isFile);
      if (anchor) expect(anchorsOf(read(path)), `${key}: #${anchor} not a heading of ${path}`).toContain(anchor);
    }
  });

  it('every internal link opens a page the app routes (the server answers 200 for any path, so the router decides)', () => {
    const internal = all.filter((l) => l.href.startsWith('/'));
    expect(internal.length).toBeGreaterThan(3);
    for (const { key, href } of internal) expect(ROUTES as readonly string[], `${key}: ${href}`).toContain(href.split('?')[0]);
  });

  it('the release link is built from config.judges.repoUrl and is the release README installs from', () => {
    expect(releaseUrl).toBe(`${config.judges.repoUrl}/releases/tag/core-v${rootPkg.version}`);
    expect(read('README.md')).toContain(releaseUrl);
    expect(existsSync(new URL(`docs/pkg/tambat-core-${rootPkg.version}.tgz`, root))).toBe(true);
    expect(REQUIREMENTS.find((r) => r.key === 'docs')?.links.map((l) => l.href)).toContain(releaseUrl);
  });

  it('links each round 3 and 4 feature: relays, VC, package, release, phone, reputation, selective disclosure', () => {
    const keys = all.map((l) => l.key);
    for (const k of ['relays', 'vc', 'pkg', 'release', 'phone', 'reputation', 'repBundle', 'sd']) expect(keys).toContain(k);
  });

  it('every link has English and Malay text', () => {
    for (const { key } of REQUIREMENTS.flatMap((r) => r.links)) {
      expect((en.judges.link as Record<string, string>)[key], key).toBeTruthy();
      expect((ms.judges.link as Record<string, string>)[key], key).toBeTruthy();
    }
  });
});
