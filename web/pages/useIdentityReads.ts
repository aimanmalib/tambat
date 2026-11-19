import { useEffect, useState } from 'react';
import { config } from '../../src/config';
import { addressStatus, electrumChain, electrumServers, type AddressStatus } from '../../src/core/anchor-chain';
import type { AttestationSummary } from '../../src/core/attest';
import { attestationsOf } from '../../src/core/attest-find';
import type { ReceiptCheck } from '../../src/core/receipt';
import { checkReceipts, findReceipts } from '../../src/core/receipt-find';
import { answeredCount, createRelayWatch, type RelayWatch } from '../../src/core/relay-watch';
import type { BindingResult } from '../../src/core/verify';

/**
 * The reads behind a verified binding on the look-up page, made once and shared by the anchor panel, the attestation
 * list and the reputation summary. `undefined` = still reading; `null` = no relay answered (attestations, receipts).
 */
export interface IdentityReads {
  chain?: AddressStatus;
  attestations?: AttestationSummary | null;
  receipts?: ReceiptCheck[] | null;
}

/** Runs `read` with a fresh relay watch and gives null when no configured relay answered it. */
async function fromRelays<T>(read: (watch: RelayWatch) => Promise<T>): Promise<T | null> {
  const watch = createRelayWatch(config.nostr.relays);
  const value = await read(watch).catch(() => null);
  return value !== null && answeredCount(watch.statuses()) > 0 ? value : null;
}

export function useIdentityReads(result: BindingResult): IdentityReads {
  // Reads are kept with the result they belong to, so a new result starts from "still reading" without a reset.
  const [reads, setReads] = useState<{ of: BindingResult; value: IdentityReads } | null>(null);
  useEffect(() => {
    let live = true;
    const put = (part: IdentityReads) =>
      live && setReads((r) => ({ of: result, value: { ...(r?.of === result ? r.value : {}), ...part } }));
    const address = result.claims[0]?.address ?? '';
    void addressStatus(address, result.pubkey, result.eventId, electrumServers()).then((chain) => put({ chain }));
    void fromRelays((watch) => attestationsOf(result.pubkey, { watch }, result)).then((attestations) => put({ attestations }));
    void fromRelays((watch) => findReceipts({ payee: result.pubkey }, { watch }))
      .then((found) => (found ? checkReceipts(found, electrumChain()) : null))
      .catch(() => null)
      .then((receipts) => put({ receipts }));
    return () => {
      live = false;
    };
  }, [result]);
  return reads?.of === result ? reads.value : {};
}
