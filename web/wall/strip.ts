/**
 * The count strip above the wall. Every number is counted from what this page read in this session; a number that
 * could not be read is null (shown as a dash), never a zero.
 */
import { config } from '../../src/config.js';
import { parseAttestation, type ParsedAttestation } from '../../src/core/attest.js';
import { guardedQuery, relayQuery, type QueryFn } from '../../src/core/discover.js';
import { answeredCount, createRelayWatch, type RelayStatus } from '../../src/core/relay-watch.js';
import type { Wall, WallEntry } from '../../src/core/wall.js';

export interface StripInput {
  /** The wall as last read; null while no relay answered. */
  wall: Wall | null;
  relays: RelayStatus[];
  /** Chain reads so far by binding event id: the anchored block, or null when read and not anchored. */
  anchors: ReadonlyMap<string, number | null>;
  /** Attestations of the listed bindings; null when no relay answered that query. */
  attestations: number | null;
  /** When the last check finished. */
  updatedAt: Date | null;
}

export interface Strip {
  verified: number | null;
  /** Anchored bindings among those whose chain read finished; null before any finished. */
  anchored: { count: number; checked: number } | null;
  /** Listed bindings proved by a transaction; null while some on-chain proof is not read yet. */
  onChain: number | null;
  attestations: number | null;
  relays: { answered: number; total: number };
  /** The newest block any listed binding is anchored in. */
  latestBlock: number | null;
  /** HH:MM:SS in UTC. */
  updated: string | null;
}

export function stripOf(input: StripInput): Strip {
  const { wall } = input;
  const reads = (wall?.entries ?? []).filter((e) => input.anchors.has(e.eventId)).map((e) => input.anchors.get(e.eventId) ?? null);
  const heights = reads.filter((h): h is number => h !== null);
  return {
    verified: wall ? wall.entries.length : null,
    anchored: reads.length > 0 ? { count: heights.length, checked: reads.length } : null,
    onChain: wall && !wall.unchecked ? wall.entries.filter((e) => e.proof === 'tx').length : null,
    attestations: wall ? input.attestations : null,
    relays: { answered: answeredCount(input.relays), total: input.relays.length },
    latestBlock: heights.length > 0 ? Math.max(...heights) : null,
    updated: input.updatedAt ? input.updatedAt.toISOString().slice(11, 19) : null,
  };
}

/** Attestations that name a listed key and the binding listed for it, one per attester and key. */
export function countAttestations(found: ParsedAttestation[], entries: WallEntry[]): number {
  const listed = new Map(entries.map((e) => [e.pubkey, e.eventId]));
  const pairs = new Set(found.filter((a) => listed.get(a.subject) === a.bindingEventId).map((a) => `${a.attester} ${a.subject}`));
  return pairs.size;
}

/** Reads the attestations of the listed keys in one query. Null when no relay answered. */
export async function readAttestationCount(entries: WallEntry[], query: QueryFn = relayQuery, relays = config.nostr.relays): Promise<number | null> {
  if (entries.length === 0) return 0;
  const watch = createRelayWatch(relays);
  const filter = { kinds: [config.attest.kind], '#p': entries.map((e) => e.pubkey), '#L': [config.attest.namespace] };
  const raw = await guardedQuery(query, relays, filter, config.nostr.queryTimeoutMs, watch);
  if (answeredCount(watch.statuses()) === 0) return null;
  const parsed = raw.map(parseAttestation).filter((a): a is ParsedAttestation => typeof a !== 'string');
  return countAttestations(parsed, entries);
}
