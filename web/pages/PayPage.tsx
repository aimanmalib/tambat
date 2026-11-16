import { useEffect, useState } from 'react';
import { lookupByPubkey } from '../../src/core/discover';
import { parsePubkey } from '../../src/core/nostr';
import { amountProblem, paymentUri } from '../../src/core/pay';
import { useText } from '../i18n';
import { queryParam } from '../router';
import { CopyValue } from '../ui/Copy';
import { errorText } from '../../src/errors';
import { Notice } from '../ui/Notice';
import { Qr } from '../ui/Qr';

type Found = { address: string; npub: string } | 'none' | null;

/** Pay to an identity: the address comes from a binding verified here; the user's wallet sends the payment. */
export function PayPage() {
  const { t } = useText();
  const [input, setInput] = useState(queryParam('npub'));
  const [found, setFound] = useState<Found>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(() => queryParam('npub') !== '');
  const [error, setError] = useState('');

  const resolve = async (value: string): Promise<{ found: Found; error: string }> => {
    const key = parsePubkey(value);
    if ('error' in key) return { found: null, error: t('lookup.inputError') };
    try {
      const r = await lookupByPubkey(key.hex);
      const claim = r?.ok ? r.claims.find((c) => c.ok) : undefined;
      return { found: claim && r ? { address: claim.address, npub: r.npub } : 'none', error: '' };
    } catch (e) {
      return { found: null, error: errorText(e, t) };
    }
  };
  const apply = (r: { found: Found; error: string }) => {
    setFound(r.found);
    setError(r.error);
    setBusy(false);
  };
  const find = (value: string) => {
    setBusy(true);
    setFound(null);
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
