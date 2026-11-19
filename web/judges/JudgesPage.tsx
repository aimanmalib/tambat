import { useState, type ReactNode } from 'react';
import { config } from '../../src/config';
import { useText } from '../i18n';
import { shortHex } from '../ui/HexId';
import { AnchorProof } from './AnchorProof';
import { CRITERIA, look, repo, REQUIREMENTS } from './links';
import { SampleCheck } from './SampleCheck';
import './judges.css';

const VERIFIER_PATH = '/verify/';

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
