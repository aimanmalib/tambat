/**
 * A fake Fulcrum server for tests: answers the Electrum JSON-RPC calls the anchor reader makes from fixed data.
 * `answer` maps one request line to one response line, so a Node WebSocket server (unit tests) and a Playwright
 * WebSocket route (e2e) can both use it.
 */
export interface FakeChainTx {
  hex: string;
  txid: string;
  height: number;
}

export interface FakeChain {
  /** Script hash to the transactions in its history. */
  history: Record<string, FakeChainTx[]>;
  unspent?: Record<string, { tx_hash: string; tx_pos: number; value: number; height: number }[]>;
  /** Block height to 80-byte header hex. */
  headers: Record<number, string>;
}

/** An 80-byte header whose time field (bytes 68 to 71, little-endian) is `time`. */
export function headerWithTime(time: number): string {
  const bytes = new Uint8Array(80);
  new DataView(bytes.buffer).setUint32(68, time, true);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function answer(chain: FakeChain, line: string): string {
  const request = JSON.parse(line) as { id: number; method: string; params: unknown[] };
  const reply = (result: unknown) => `${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}`;
  const fail = (message: string) => `${JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: 1, message } })}`;
  const [first] = request.params;
  const all = Object.values(chain.history).flat();
  switch (request.method) {
    case 'server.version':
      return reply(['Fulcrum 1.11.1', '1.4']);
    case 'server.ping':
      return reply(null);
    case 'blockchain.scripthash.get_history':
      return reply((chain.history[String(first)] ?? []).map((t) => ({ tx_hash: t.txid, height: t.height })));
    case 'blockchain.scripthash.listunspent':
      return reply(chain.unspent?.[String(first)] ?? []);
    case 'blockchain.transaction.get': {
      const tx = all.find((t) => t.txid === first);
      return tx ? reply(tx.hex) : fail('no such transaction');
    }
    case 'blockchain.block.header': {
      const header = chain.headers[Number(first)];
      return header ? reply(header) : fail('no such block');
    }
    default:
      return fail(`unknown method ${request.method}`);
  }
}
