import type { ReactNode } from 'react';
import { summarizeReputation } from '../../src/core/reputation';
import { toNpub } from '../../src/core/nostr';
import { useText } from '../i18n';
import { HexId } from '../ui/HexId';
import type { IdentityReads } from './useIdentityReads';

type Row = { name: 'attestations' | 'receipts' | 'anchor'; state: string; count?: number; line: string; notes?: string[]; sources?: ReactNode };

function RowView({ row }: { row: Row }) {
  const { t } = useText();
  const head = (
    <>
      <span className="rep__label">{t(`reputation.${row.name}`)}</span>
      <span className="rep__value">{row.line}</span>
    </>
  );
  return (
    <li className="rep__row" data-rep={row.name} data-state={row.state} data-count={row.count}>
      {row.sources ? (
        <details className="more rep__more">
          <summary>{head}</summary>
          {row.sources}
        </details>
      ) : (
        <p className="rep__line">{head}</p>
      )}
      {row.notes?.map((n) => <p key={n} className="option__help">{n}</p>)}
    </li>
  );
}

/**
 * Three checked counts side by side, each opening to its sources: attestations of the current binding, payment
 * receipts the chain confirms, and the block since which the chain binds the address. No score: see docs/SPEC.md.
 */
export function ReputationSummary({ reads }: { reads: IdentityReads }) {
  const { t } = useText();
  const rep = summarizeReputation({ attestations: reads.attestations ?? null, receipts: reads.receipts ?? null, chain: reads.chain ?? null });
  const checking = t('reputation.checking');
  const rows: Row[] = [];

  const a = rep.attestations;
  if (reads.attestations === undefined) rows.push({ name: 'attestations', state: 'checking', line: checking });
  else if (a.kind === 'unreadable') rows.push({ name: 'attestations', state: 'unreadable', line: t('reputation.unreadableRelays') });
  else
    rows.push({
      name: 'attestations', state: 'counted', count: a.items.length, line: t('reputation.attestationCount', { count: a.items.length }),
      sources: a.items.length > 0 ? (
        <ul className="rep__sources">
          {a.items.map((x) => (
            <li key={x.event.id}><code className="rep__npub">{toNpub(x.attester)}</code> <HexId value={x.event.id} label={t('attest.event')} /></li>
          ))}
        </ul>
      ) : undefined,
    });

  const r = rep.receipts;
  if (reads.receipts === undefined) rows.push({ name: 'receipts', state: 'checking', line: checking });
  else if (r.kind === 'unreadable') rows.push({ name: 'receipts', state: 'unreadable', line: t('reputation.unreadableRelays') });
  else {
    const notes = [
      ...(r.unchecked > 0 ? [t('reputation.receiptsUnchecked', { count: r.unchecked })] : []),
      ...(r.unproven > 0 ? [t('reputation.receiptsUnproven', { count: r.unproven })] : []),
    ];
    rows.push({
      name: 'receipts', state: 'counted', count: r.items.length, line: t('reputation.receiptCount', { count: r.items.length }), notes,
      sources: r.items.length > 0 ? (
        <ul className="rep__sources">
          {r.items.map((x) => (
            <li key={x.txid}>{t('reputation.receiptTx')} <HexId value={x.txid} label={t('reputation.receiptTx')} /> <code className="rep__npub">{x.payerNpub}</code></li>
          ))}
        </ul>
      ) : undefined,
    });
  }

  const s = rep.anchoredSince;
  if (reads.chain === undefined) rows.push({ name: 'anchor', state: 'checking', line: checking });
  else if (s.kind === 'unreadable') rows.push({ name: 'anchor', state: 'unreadable', line: t('reputation.unreadableChain') });
  else if (s.kind === 'not_anchored') rows.push({ name: 'anchor', state: 'not_anchored', line: t('reputation.notAnchored') });
  else
    rows.push({
      name: 'anchor', state: 'block', count: s.height, line: t('reputation.anchoredSince', { height: s.height }),
      sources: <p className="option__help">{t('anchor.tx')} <HexId value={s.commitment.txid} label={t('anchor.tx')} /></p>,
    });

  return (
    <div className="picker rep">
      <h3 className="picker__title">{t('reputation.title')}</h3>
      <ul className="rep__list">{rows.map((row) => <RowView key={row.name} row={row} />)}</ul>
      <p className="option__help">{t('reputation.help')}</p>
    </div>
  );
}
