/**
 * Where every line of the judges page points. Kept apart from the page, with imports Node can resolve, so a unit test can check that each repository
 * link names a file present in the tree and that the release link is the one the README installs from.
 */
import pkg from '../../package.json' with { type: 'json' };
import { config } from '../../src/config.js';

/** `?embed=1` on a Look up link opens the embed panel and scrolls to it (the /judges link uses it). */
export const EMBED_OPEN_PARAM = 'embed';

export const repo = (path: string) => `${config.judges.repoUrl}/blob/main/${path}`;
export const repoDir = (path: string) => `${config.judges.repoUrl}/tree/main/${path}`;
export const look = (q: string) => `/lookup?q=${encodeURIComponent(q)}`;

/** The GitHub release of the library package at the version this tree packs (scripts/pack-core.ts reads the same field). */
export const releaseUrl = `${config.judges.repoUrl}/releases/tag/core-v${pkg.version}`;

export type JudgeLink = { key: string; href: string };

/** Each bounty requirement with the live pages and files that show it, in the order the bounty lists them. */
export const REQUIREMENTS: { key: string; links: JudgeLink[] }[] = [
  { key: 'create', links: [{ key: 'link', href: '/' }, { key: 'revoke', href: look(config.judges.revocation.npub) }] },
  { key: 'binding', links: [{ key: 'hero', href: '/' }, { key: 'vectors', href: repo('examples/vectors.json') }] },
  {
    key: 'discovery',
    links: [
      { key: 'lookup', href: look(config.judges.sample.npub) },
      { key: 'wall', href: '/wall' },
      { key: 'embed', href: `${look(config.judges.sample.npub)}&${EMBED_OPEN_PARAM}=1` },
      { key: 'relays', href: `${repo('docs/MEASURED.md')}#relays` },
      { key: 'reputation', href: look(config.judges.paytaca.npub) },
      { key: 'repBundle', href: repo('examples/reputation-bundle.json') },
    ],
  },
  {
    key: 'auth',
    links: [
      { key: 'demo', href: '/demo' },
      { key: 'verify', href: repo('docs/VERIFY.md') },
      { key: 'vc', href: repo('examples/attestation-vc.json') },
      { key: 'sd', href: repo('examples/sd-presentation.json') },
      { key: 'phone', href: `${repo('docs/PAYTACA.md')}#on-an-iphone` },
    ],
  },
  {
    key: 'docs',
    links: [
      { key: 'readme', href: repo('README.md') },
      { key: 'measured', href: repo('docs/MEASURED.md') },
      { key: 'pkg', href: repoDir('docs/pkg') },
      { key: 'release', href: releaseUrl },
    ],
  },
];

/** Each judging criterion with the one file that holds its evidence. */
export const CRITERIA: JudgeLink[] = [
  { key: 'correctness', href: repo('tests/verify.test.ts') },
  { key: 'security', href: repo('tests/auth.test.ts') },
  { key: 'decentralization', href: repo('tests/discover.test.ts') },
  { key: 'interop', href: repo('docs/NIP-39-bch.md') },
  { key: 'usability', href: repo('docs/PAYTACA.md') },
  { key: 'demo', href: repo('docs/MEASURED.md') },
];
