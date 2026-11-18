/**
 * Reading commitments from the chain, read only: address history, transactions and block headers from Fulcrum
 * (Electrum protocol) servers over WebSocket. No relay is involved, so address to Nostr key works when relays are gone.
 */
import { ElectrumClient } from '@electrum-cash/network';
import { ElectrumWebSocket } from '@electrum-cash/web-socket';
import { binToHex, cashAddressToLockingBytecode, hexToBin, sha256 } from '@bitauth/libauth';
import { config } from '../config.js';
import { commitmentFromTransaction, earliestCommitment, type Commitment, type Utxo } from './anchor.js';

export interface HistoryItem {
  tx_hash: string;
  height: number;
}

/** The chain calls the anchor needs. Tests pass a fake; the app uses an Electrum server. */
export interface ChainSource {
  history(scripthash: string): Promise<HistoryItem[]>;
  transaction(txid: string): Promise<string>;
  header(height: number): Promise<string>;
  unspent(scripthash: string): Promise<Utxo[]>;
  /** Sends a signed transaction and returns the txid the server reports. Only the demo key script calls it. */
  send?(transactionHex: string): Promise<string>;
  close(): Promise<void>;
}

export type OpenChain = () => Promise<ChainSource>;

/** Electrum script hash of an address: SHA-256 of its locking bytecode, bytes reversed, as hex. */
export function scripthashOf(address: string): string {
  const locking = cashAddressToLockingBytecode(address);
  if (typeof locking === 'string') throw new Error(locking);
  return binToHex(sha256.hash(locking.bytecode).reverse());
}

/** Unix time of an 80-byte block header (bytes 68 to 71, little-endian). */
export function headerTime(headerHex: string): number {
  const h = hexToBin(headerHex);
  if (h.length < 80) throw new Error('block header must be 80 bytes');
  return new DataView(h.buffer, h.byteOffset).getUint32(68, true);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('chain server timed out')), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

function electrumSource(client: ElectrumClient<never>, timeoutMs: number): ChainSource {
  const call = async <T>(method: string, ...params: (string | number | boolean)[]): Promise<T> => {
    const result = await withTimeout(client.request(method, ...params), timeoutMs);
    if (result instanceof Error) throw result;
    return result as T;
  };
  return {
    history: (s) => call<HistoryItem[]>('blockchain.scripthash.get_history', s),
    transaction: (txid) => call<string>('blockchain.transaction.get', txid, false),
    header: (height) => call<string>('blockchain.block.header', height),
    unspent: async (s) =>
      (await call<{ tx_hash: string; tx_pos: number; value: number; height: number }[]>('blockchain.scripthash.listunspent', s)).map((u) => ({
        txid: u.tx_hash,
        vout: u.tx_pos,
        satoshis: u.value,
        height: u.height,
      })),
    send: (hex) => call<string>('blockchain.transaction.broadcast', hex),
    close: async () => {
      await client.disconnect(true).catch(() => false);
    },
  };
}

/** Opens the first configured Electrum server that answers. Throws when none does. */
export function electrumChain(servers: string[] = config.anchor.electrum, timeoutMs: number = config.anchor.timeoutMs): OpenChain {
  return async () => {
    for (const server of servers) {
      const url = new URL(server);
      const socket = new ElectrumWebSocket(url.hostname, {
        port: Number(url.port || (url.protocol === 'wss:' ? 443 : 80)),
        encrypted: url.protocol === 'wss:',
        timeoutInMilliSeconds: timeoutMs,
      });
      const client = new ElectrumClient<never>('tambat', '1.4', socket);
      try {
        await withTimeout(client.connect(), timeoutMs);
        return electrumSource(client, timeoutMs);
      } catch {
        await client.disconnect(true).catch(() => false);
      }
    }
    throw new Error('no chain server answered');
  };
}

/** Every commitment made from an address, oldest block first, with block times. Unconfirmed ones have height 0. */
export async function readCommitments(address: string, chain: ChainSource): Promise<Commitment[]> {
  const history = (await chain.history(scripthashOf(address)))
    .map((h) => ({ ...h, height: h.height > 0 ? h.height : 0 }))
    .sort((a, b) => (a.height || Infinity) - (b.height || Infinity))
    .slice(0, config.anchor.historyLimit);
  const found: Commitment[] = [];
  for (const item of history) {
    const payload = commitmentFromTransaction(hexToBin(await chain.transaction(item.tx_hash)), address);
    if (typeof payload === 'string') continue;
    const commitment: Commitment = { ...payload, txid: item.tx_hash, height: item.height };
    if (item.height > 0) commitment.blockTime = headerTime(await chain.header(item.height));
    found.push(commitment);
  }
  return found;
}

export type AnchorStatus =
  | { kind: 'anchored'; commitment: Commitment; sameEvent: boolean }
  | { kind: 'none' }
  | { kind: 'unreachable' };

/**
 * Anchor status of a verified binding: the earliest confirmed commitment from `address` to `pubkey`. `sameEvent` is
 * false when the anchored event is not the binding event now on the relays (the pair still counts).
 */
export async function anchorStatus(address: string, pubkey: string, eventId: string, open: OpenChain = electrumChain()): Promise<AnchorStatus> {
  let chain: ChainSource;
  try {
    chain = await open();
  } catch {
    return { kind: 'unreachable' };
  }
  try {
    const earliest = earliestCommitment(await readCommitments(address, chain), pubkey);
    return earliest ? { kind: 'anchored', commitment: earliest, sameEvent: earliest.eventId === eventId } : { kind: 'none' };
  } catch {
    return { kind: 'unreachable' };
  } finally {
    await chain.close();
  }
}
