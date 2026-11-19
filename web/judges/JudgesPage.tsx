import { useState, type ReactNode } from 'react';
import { config } from '../../src/config';
import { useText } from '../i18n';
import { EMBED_OPEN_PARAM } from '../ui/EmbedCode';
import { shortHex } from '../ui/HexId';
import { AnchorProof } from './AnchorProof';
import { SampleCheck } from './SampleCheck';
import './judges.css';

const VERIFIER_PATH = '/verify/';
const repo = (path: string) => `${config.judges.repoUrl}/blob/main/${path}`;
const repoDir = (path: string) => `${config.judges.repoUrl}/tree/main/${path}`;
const look = (q: string) => `/lookup?q=${encodeURIComponent(q)}`;

/** Each bounty requirement with the live pages and files that show it, in the order the bounty lists them. */
const REQUIREMENTS: { key: string; links: { key: string; href: string }[] }[] = [
  { key: 'create', links: [{ key: 'link', href: '/' }, { key: 'revoke', href: look(config.judges.revocation.npub) }] },
  { key: 'binding', links: [{ key: 'vectors', href: repo('examples/vectors.json') }] },
  { key: 'discovery', links: [{ key: 'lookup', href: look(config.judges.sample.npub) }, { key: 'wall', href: '/wall' }, { key: 'embed', href: `${look(config.judges.sample.npub)}&${EMBED_OPEN_PARAM}=1` }] },
  { key: 'auth', links: [{ key: 'demo', href: '/demo' }, { key: 'verify', href: repo('docs/VERIFY.md') }, { key: 'vc', href: repo('examples/attestation-vc.json') }] },
  { key: 'docs', links: [{ key: 'readme', href: repo('README.md') }, { key: 'measured', href: repo('docs/MEASURED.md') }, { key: 'pkg', href: repoDir('docs/pkg') }] },
];

/** Each judging criterion with the one file that holds its evidence. */
const CRITERIA: { key: string; href: string }[] = [
  { key: 'correctness', href: repo('tests/verify.test.ts') },
  { key: 'security', href: repo('tests/auth.test.ts') },
  { key: 'decentralization', href: repo('tests/discover.test.ts') },
  { key: 'interop', href: repo('docs/NIP-39-bch.md') },
  { key: 'usability', href: repo('docs/PAYTACA.md') },
  { key: 'demo', href: repo('docs/MEASURED.md') },
];

/** A list that starts open on wide screens and closed on narrow ones, so the whole page fits one screen on both. */
function Fold({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  const [open] = useState(() => window.matchMedia(`(min-width: ${config.judges.openFromWidth})`).matches);
  return (
    <details className="jpanel jfold" open={open} data-fold={id}>
      <summary className="jpanel__title">{title}</summary>
      {children}
    </details>
  );
}

export function JudgesPage() {
  const { t } = useText();
  const j = config.judges;
  return (
    <div className="judges">
      <div className="judges__head">
        <h1 className="judges__title">{t('judges.title')}</h1>
        <p className="jsmall jwide">{t('judges.sub')}</p>
      </div>
      <div className="judges__col">
        <SampleCheck />
        <section className="jpanel" aria-labelledby="j-proof">
          <h2 id="j-proof" className="jpanel__title jnarrow-hide">{t('judges.proofTitle')}</h2>
          <ul className="jlist">
            <li data-proof="paytaca">
              {t('judges.paytaca')}: <code>{shortHex(j.paytaca.eventId)}</code> <a href={look(j.paytaca.npub)} data-event={j.paytaca.eventId}>{t('judges.open')}</a>
            </li>
            <AnchorProof />
            <li data-proof="revocation">
              {t('judges.revocation')}: <code>{shortHex(j.revocation.eventId)}</code> <a href={look(j.revocation.npub)} data-event={j.revocation.eventId}>{t('judges.open')}</a>
            </li>
          </ul>
        </section>
        <nav className="jactions" aria-label={t('judges.actionsTitle')}>
          <a className="btn btn--small btn--primary" href="/demo">{t('judges.signIn')}</a>
          <a className="btn btn--small" href={VERIFIER_PATH}>{t('judges.verifyYourself')}</a>
          <a className="btn btn--small" href={repo('docs/SPEC.md')}>{t('judges.spec')}</a>
          <a className="btn btn--small" href={j.repoUrl}>{t('judges.repo')}</a>
        </nav>
      </div>
      <Fold id="requirements" title={t('judges.reqTitle')}>
        <ol className="jlist">
          {REQUIREMENTS.map((r) => (
            <li key={r.key} data-req={r.key}>
              <span className="jlist__name">{t(`judges.req.${r.key}`)}</span>
              <span className="jlinks">
                {r.links.map((l) => <a key={l.key} href={l.href}>{t(`judges.link.${l.key}`)}</a>)}
              </span>
            </li>
          ))}
        </ol>
      </Fold>
      <Fold id="criteria" title={t('judges.critTitle')}>
        <ul className="jlist">
          {CRITERIA.map((c) => (
            <li key={c.key} data-crit={c.key}>
              {t(`judges.crit.${c.key}`)} <a href={c.href} aria-label={`${t('judges.proof')}: ${t(`judges.crit.${c.key}`)}`}>{t('judges.proof')}</a>
            </li>
          ))}
        </ul>
      </Fold>
    </div>
  );
}
