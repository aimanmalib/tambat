/**
 * Reading the same thing from several chain servers and keeping it only when enough of them say the same. One server
 * that lies, or is behind, could otherwise hide a revocation or invent a commitment. The rule is strict: every server
 * that answers must agree, and at least `quorum` must answer; a server that cannot be reached is left out, not counted
 * against. Anything else is unknown, with the names of the servers that differed or did not answer
 * (docs/decisions/0014-chain-quorum.md).
 */
import type { ChainSource, OpenChain } from './anchor-chain.js';

/** One chain server: a short name to show people and a way to open it. */
export interface ChainServer {
  name: string;
  open: OpenChain;
}

/** Which servers agreed, which answered something else, and which could not be read. Names keep the configured order. */
export interface Tally {
  quorum: number;
  total: number;
  agreed: string[];
  differing: string[];
  unreachable: string[];
}

export type QuorumRead<T> =
  | { kind: 'agreed'; value: T; tally: Tally }
  | { kind: 'unknown'; tally: Tally }
  | { kind: 'unreachable'; tally: Tally };

type Answer<T> = { name: string; ok: true; value: T; key: string } | { name: string; ok: false };

async function ask<T>(server: ChainServer, read: (chain: ChainSource) => Promise<T>, key: (value: T) => string): Promise<Answer<T>> {
  let chain: ChainSource;
  try {
    chain = await server.open();
  } catch {
    return { name: server.name, ok: false };
  }
  try {
    const value = await read(chain);
    return { name: server.name, ok: true, value, key: key(value) };
  } catch {
    return { name: server.name, ok: false };
  } finally {
    await chain.close().catch(() => undefined);
  }
}

/**
 * Runs `read` against every server at once and compares the answers by `key`. The largest group of equal answers is
 * "agreed" (the earliest configured server breaks a tie); the value is returned only when no answering server differs
 * and the group has at least `quorum` servers.
 */
export async function readQuorum<T>(
  servers: ChainServer[],
  quorum: number,
  read: (chain: ChainSource) => Promise<T>,
  key: (value: T) => string = (v) => JSON.stringify(v),
): Promise<QuorumRead<T>> {
  const answers = await Promise.all(servers.map((s) => ask(s, read, key)));
  const unreachable = answers.filter((a) => !a.ok).map((a) => a.name);
  const answered = answers.filter((a): a is Extract<Answer<T>, { ok: true }> => a.ok);
  const groups = new Map<string, typeof answered>();
  for (const a of answered) groups.set(a.key, [...(groups.get(a.key) ?? []), a]);
  let biggest: typeof answered = [];
  for (const g of groups.values()) if (g.length > biggest.length) biggest = g;
  const agreed = biggest.map((a) => a.name);
  const differing = answered.filter((a) => a.key !== biggest[0]?.key).map((a) => a.name);
  const tally: Tally = { quorum, total: servers.length, agreed, differing, unreachable };
  const first = biggest[0];
  if (!first) return { kind: 'unreachable', tally };
  if (differing.length > 0 || agreed.length < quorum) return { kind: 'unknown', tally };
  return { kind: 'agreed', value: first.value, tally };
}

/** Opens the first server that answers, in the configured order: for reads that need one server, such as receipts. */
export function firstAnswering(servers: ChainServer[]): OpenChain {
  return async () => {
    for (const server of servers) {
      try {
        return await server.open();
      } catch {
        // try the next one
      }
    }
    throw new Error('no chain server answered');
  };
}
