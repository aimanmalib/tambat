import { useState } from 'react';
import { config } from '../../src/config';
import { electrumChain } from '../../src/core/anchor-chain';
import { parsePubkey } from '../../src/core/nostr';
import { publishEvent, type RelayOutcome } from '../../src/core/publish';
import { createReceiptEvent, type ReceiptCheck } from '../../src/core/receipt';
import { checkReceipts, findReceipts } from '../../src/core/receipt-find';
import { errorText } from '../../src/errors';
import { useText } from '../i18n';
import { useKeys } from '../keys/KeysContext';
import { NostrConnect } from '../keys/NostrConnect';
import { Notice } from '../ui/Notice';
import { RelayList } from '../ui/RelayList';
import { HexId } from '../ui/HexId';

const TXID = /^[0-9a-f]{64}$/;

function ReceiptLine({ check }: { check: ReceiptCheck }) {
  const { t } = useText();
  const proven = check.payer === 'from_bound' && check.paysPayee;
  return (
    <li className="receipt" data-payer={check.payer} data-chain={check.chain}>
      <Notice tone={proven ? 'ok' : 'info'}>{t(check.payer === 'from_bound' ? 'receipt.fromBound' : 'receipt.notProven')}</Notice>
      <p className="option__help">{t(`receipt.chain.${check.chain}`)}</p>
      {check.chain === 'found' ? <p className="option__help">{t(check.paysPayee ? 'receipt.paysPayee' : 'receipt.notPayee')}</p> : null}
      <p className="option__help receipt__who">{t('receipt.by')} <code>{check.payerNpub}</code></p>
      <p className="option__help receipt__who">{t('receipt.event')} <HexId value={check.eventId} label={t('receipt.event')} /></p>
    </li>
  );
}

/**
 * After paying: the payer may publish a receipt (a NIP-32 label naming the paid key and the transaction) signed by
 * their own Nostr key, and anyone can check the receipts of a transaction against the bindings and the chain.
 */
export function ReceiptPanel({ payeeNpub }: { payeeNpub: string }) {
  const { t } = useText();
  const { nostr } = useKeys();
  const [txid, setTxid] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcomes, setOutcomes] = useState<RelayOutcome[] | null>(null);
  const [checks, setChecks] = useState<ReceiptCheck[] | null>(null);
  const clean = txid.trim().toLowerCase();
  const valid = TXID.test(clean);
  const payee = parsePubkey(payeeNpub);

  const run = async (publish: boolean) => {
    setBusy(true);
    setError('');
    setChecks(null);
    if (!publish) setOutcomes(null);
    try {
      if (publish && nostr && 'hex' in payee) {
        const event = await nostr.sign(createReceiptEvent({ payee: payee.hex, txid: clean }));
        setOutcomes(await publishEvent(event, config.nostr.relays, config.nostr.publishTimeoutMs));
      }
      setChecks(await checkReceipts(await findReceipts({ txid: clean }), electrumChain()));
    } catch (e) {
      setError(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="picker receipts" aria-labelledby="receipt-title">
      <h2 className="picker__title" id="receipt-title">{t('receipt.title')}</h2>
      <p className="option__help">{t('receipt.help')}</p>
      <label className="field">
        <span className="field__label">{t('receipt.txid')}</span>
        <input className="input" name="txid" value={txid} onChange={(e) => setTxid(e.target.value)} autoComplete="off" spellCheck={false} aria-invalid={txid !== '' && !valid ? true : undefined} />
      </label>
      {txid !== '' && !valid ? <Notice tone="error">{t('receipt.txidFormat')}</Notice> : null}
      {nostr ? null : <NostrConnect />}
      <div className="row">
        <button type="button" className="btn btn--primary" disabled={busy || !valid || !nostr} onClick={() => void run(true)}>{t('receipt.publish')}</button>
        <button type="button" className="btn" disabled={busy || !valid} onClick={() => void run(false)}>{t('receipt.check')}</button>
      </div>
      {busy ? <Notice>{t('receipt.checking')}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {outcomes ? <RelayList outcomes={outcomes} /> : null}
      {checks && checks.length === 0 ? <Notice>{t('receipt.none')}</Notice> : null}
      {checks && checks.length > 0 ? <ul className="receipts__list">{checks.map((c) => <ReceiptLine key={c.eventId} check={c} />)}</ul> : null}
    </section>
  );
}
