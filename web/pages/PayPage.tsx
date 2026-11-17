import { useEffect, useState } from 'react';
import { parseNip05 } from '../../src/core/nip05';
import { parsePubkey } from '../../src/core/nostr';
import { amountProblem, paymentUri } from '../../src/core/pay';
import { findIdentity } from '../find';
import { useText } from '../i18n';
import { queryParam } from '../router';
import { CopyValue } from '../ui/Copy';
import { errorText } from '../../src/errors';
import { Notice } from '../ui/Notice';
import { Qr } from '../ui/Qr';

type Found = { address: string; npub: string } | 'none' | null;
type Via = { name: string; npub: string } | null;
type Resolved = { found: Found; error: string; via: Via };

/** Pay to an identity: the address comes from a binding verified here; the user's wallet sends the payment. */
export function PayPage() {
  const { t } = useText();
  const [input, setInput] = useState(queryParam('npub'));
  const [found, setFound] = useState<Found>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(() => queryParam('npub') !== '');
  const [error, setError] = useState('');
  const [via, setVia] = useState<Via>(null);

  const resolve = async (value: string): Promise<Resolved> => {
    // Pay takes a person (key or name), not an address: an address is already where the money goes.
    if (!parseNip05(value) && 'error' in parsePubkey(value)) return { found: null, error: t('pay.inputError'), via: null };
    try {
      const r = await findIdentity(value);
      if (r === 'bad_input') return { found: null, error: t('pay.inputError'), via: null };
      const binding = r.results[0];
      const claim = binding?.ok ? binding.claims.find((c) => c.ok) : undefined;
      return { found: claim && binding ? { address: claim.address, npub: binding.npub } : 'none', error: '', via: r.via ?? null };
    } catch (e) {
      return { found: null, error: errorText(e, t), via: null };
    }
  };
  const apply = (r: Resolved) => {
    setFound(r.found);
    setVia(r.via);
    setError(r.error);
    setBusy(false);
  };
  const find = (value: string) => {
    setBusy(true);
    setFound(null);
    setVia(null);
    setError('');
    void resolve(value).then(apply);
  };

  useEffect(() => {
    const npub = queryParam('npub');
    if (npub) void resolve(npub).then(apply);
    // Runs once for a shared link; later searches come from the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const badAmount = amountProblem(amount);
  const uri = found && found !== 'none' && !badAmount ? paymentUri({ address: found.address, amount }) : '';

  return (
    <section className="card" aria-labelledby="pay-title">
      <h1 className="card__title" id="pay-title">{t('pay.title')}</h1>
      <p className="option__help">{t('pay.help')}</p>
      <form className="row row--form" onSubmit={(e) => { e.preventDefault(); find(input); }}>
        <label className="field field--grow">
          <span className="field__label">{t('pay.label')}</span>
          <input className="input" name="npub" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
        <button type="submit" className="btn btn--primary" disabled={busy || input.trim() === ''}>{t('pay.find')}</button>
      </form>
      {busy ? <Notice>{t('lookup.searching')}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {via ? <Notice>{t('nip05.points', via)}</Notice> : null}
      {found === 'none' ? <Notice>{t('pay.none')}</Notice> : null}
      {found && found !== 'none' ? (
        <div className="stack">
          <CopyValue label={t('lookup.bchAddress')} value={found.address} />
          <label className="field">
            <span className="field__label">{t('pay.amount')}</span>
            <input className="input" name="amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={badAmount ? true : undefined} />
          </label>
          {badAmount ? <Notice tone="error">{t(badAmount === 'zero' ? 'pay.amountZero' : 'pay.amountFormat')}</Notice> : null}
          {uri ? (
            <div className="pairing">
              <Qr value={uri} label={t('pay.qr')} />
              <CopyValue label={t('pay.uri')} value={uri} />
              <a className="btn" href={uri}>{t('pay.open')}</a>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
