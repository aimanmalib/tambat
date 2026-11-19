import { useEffect, useState } from 'react';
import { config } from '../../src/config';
import { addressStatus, electrumServers } from '../../src/core/anchor-chain';
import { guardedQuery, relayQuery } from '../../src/core/discover';
import { HERO_STEPS, runHeroCheck, type HeroDeps, type HeroStep, type HeroStepName } from '../../src/core/hero-check';
import { useText } from '../i18n';
import { navigate } from '../router';
import './hero.css';

type Shown = Partial<Record<HeroStepName, HeroStep>>;
type State = 'busy' | 'verified' | 'failed';

const short = (v: string, head: number, tail: number) => (v.length > head + tail + 1 ? `${v.slice(0, head)}…${v.slice(-tail)}` : v);

/** The relays and chain servers the page already uses; `paint` yields to the browser so each step is drawn when reported. */
const liveDeps: HeroDeps = {
  fetchEvents: (eventId, pubkey, timeoutMs) => guardedQuery(relayQuery, config.nostr.relays, { ids: [eventId], authors: [pubkey] }, timeoutMs),
  readChain: (address, pubkey, eventId) => addressStatus(address, pubkey, eventId, electrumServers()),
  paint: () => new Promise((resolve) => setTimeout(resolve, 0)),
};

function StepRow({ name, step }: { name: HeroStepName; step: HeroStep | undefined }) {
  const { t } = useText();
  const status = step?.status ?? 'wait';
  let detail: string | null = null;
  if (step?.name === 'anchor' && step.status === 'pass' && step.block) detail = t('hero.block', { block: step.block });
  if (step?.name === 'anchor' && step.status === 'skip') detail = t(step.miss === 'none' ? 'hero.anchorNone' : 'hero.anchorUnreadable');
  return (
    <li className={`hstep hstep--${status}`} data-step={name} data-status={status}>
      <span className="hstep__mark" aria-hidden="true">{status === 'pass' ? '✓' : status === 'fail' ? '✕' : status === 'skip' ? '–' : '·'}</span>
      <span className="hstep__name">
        {t(`hero.steps.${name}`)}
        {detail ? <span className="hstep__detail"> {detail}</span> : null}
      </span>
      <span className="sr-only"> {t(`hero.status.${status}`)}</span>
    </li>
  );
}

/**
 * The first card of the home page: the owner's real Paytaca binding, fetched from the relays when the page opens and
 * checked here in the browser. A mark appears only when its own check has returned; a failed step is named.
 */
export function HeroCard() {
  const { t } = useText();
  const hero = config.hero;
  const [shown, setShown] = useState<Shown>({});
  const [state, setState] = useState<State>('busy');
  const [failedAt, setFailedAt] = useState<HeroStepName | null>(null);

  useEffect(() => {
    let live = true;
    void runHeroCheck(hero, liveDeps, (step) => live && setShown((s) => ({ ...s, [step.name]: step }))).then((outcome) => {
      if (!live) return;
      setFailedAt(outcome.failedAt ?? null);
      setState(outcome.verified ? 'verified' : 'failed');
    });
    return () => {
      live = false;
    };
    // Runs once when the page opens; switching the language must not ask the relays again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The address is shown once the check has proved the signer owns it, not when the event merely names it.
  const matched = shown.address_match;
  const address = matched?.status === 'pass' ? (matched.address ?? null) : null;
  const query = `?q=${encodeURIComponent(hero.npub)}`;
  return (
    <section className="herohome" aria-labelledby="hero-line" data-hero data-state={state}>
      <h1 className="hero__title" id="hero-line">{t('hero.line')}</h1>
      <a className="herocard" href={`/lookup${query}`} onClick={(e) => { e.preventDefault(); navigate('/lookup', query); }} aria-describedby="hero-by">
        <span className="herocard__label">{t('hero.label')}</span>
        <span className="herocard__key"><span className="herocard__tag">{t('hero.nostr')}</span> <code title={hero.npub}>{short(hero.npub, 10, 6)}</code></span>
        <span className="herocard__key"><span className="herocard__tag">{t('hero.bch')}</span> <code title={address ?? undefined}>{address ? short(address.replace(/^bitcoincash:/, ''), 8, 6) : '–'}</code></span>
        <ol className="herocard__steps" aria-live="polite" aria-busy={state === 'busy'}>
          {HERO_STEPS.map((name) => <StepRow key={name} name={name} step={shown[name]} />)}
        </ol>
        <span className="herocard__by" id="hero-by">{t('hero.by')}</span>
        <span className="herocard__open">{t('hero.open')} <span aria-hidden="true">→</span></span>
      </a>
      {failedAt ? <p className="herohome__failed" role="status">{t('hero.failed', { step: t(`hero.steps.${failedAt}`) })}</p> : null}
      <a className="herohome__own" href="#link">{t('hero.own')} <span aria-hidden="true">↓</span></a>
    </section>
  );
}
