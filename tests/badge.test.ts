import { afterAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';
import { badgeStatus, shortAddress, shortNpub, type ProbeFn } from '../src/core/badge.js';
import { signMessage } from '../src/core/bchmsg.js';
import { claimIdentity, createBindingEvent, createRevocationEvent } from '../src/core/binding.js';
import { verificationText } from '../src/core/nostr.js';
import { bchKeyAt } from '../src/core/paytaca.js';
import { createProbe } from '../src/core/probe.js';
import { clone, fakeRelay, keys, other, vectors } from './helpers.js';
import { holding, proofTx, server as chainServer } from './tx-proof-kit.js';

const binding = clone(vectors.bindingEvent);
const address = vectors.bch.address.bitcoincash;
const answered = (n: number): ProbeFn => async () => n;
const RELAYS = ['wss://a.example', 'wss://b.example'];
const status = (input: string, events: unknown[], reachable = 2) =>
  badgeStatus(input, { relays: RELAYS, timeoutMs: 200, query: fakeRelay(events), probe: answered(reachable) });

describe('badgeStatus', () => {
  it('is verified by npub and by address when the newest binding checks out', async () => {
    const want = { state: 'verified', npub: keys.npub, address };
    expect(await status(keys.npub, [binding])).toEqual(want);
    expect(await status(address, [binding])).toEqual(want);
    expect(await status(keys.nostrPubkey, [binding])).toEqual(want);
  });

  it('shows the address that was asked for when one key claims two', async () => {
    const second = bchKeyAt(vectors.phrase, 1, 'bitcoincash');
    const tag = ['i', claimIdentity(second.address), signMessage(second.bchPrivateKey, verificationText(keys.npub))];
    const two = finalizeEvent({ ...binding, created_at: binding.created_at + 5, tags: [...binding.tags, tag] }, keys.nostrSecretKey);
    expect(await status(second.address, [two])).toEqual({ state: 'verified', npub: keys.npub, address: second.address });
    expect(await status(address, [two])).toEqual({ state: 'verified', npub: keys.npub, address });
  });

  it('is verified for a binding proved by a transaction once the chain servers agree on it', async () => {
    const t = proofTx(keys.npub);
    const onChain = finalizeEvent(createBindingEvent({ claim: { address: keys.address, signature: `tx:${t.txid}` }, createdAt: binding.created_at }), keys.nostrSecretKey);
    const base = { relays: RELAYS, timeoutMs: 200, query: fakeRelay([onChain]), probe: answered(2) };
    const servers = ['a', 'b'].map((n) => chainServer(n, holding(t.evidence)));
    expect(await badgeStatus(keys.npub, { ...base, chain: { servers, quorum: 2 } })).toEqual({ state: 'verified', npub: keys.npub, address: keys.address });
    // Without chain servers the proof cannot be read, so the badge does not claim it.
    expect(await badgeStatus(keys.npub, base)).toEqual({ state: 'not_linked' });
  });

  it('is not linked when relays answer but hold no binding', async () => {
    expect(await status(keys.npub, [])).toEqual({ state: 'not_linked' });
    expect(await status(other.address, [binding])).toEqual({ state: 'not_linked' });
  });

  it('is not linked when the binding was revoked by a newer event', async () => {
    const revoked = finalizeEvent(createRevocationEvent(binding, binding.created_at + 10), keys.nostrSecretKey);
    expect(await status(keys.npub, [binding, revoked])).toEqual({ state: 'not_linked' });
    expect(await status(address, [binding, revoked])).toEqual({ state: 'not_linked' });
  });

  it('never shows a tampered binding as verified', async () => {
    const forged = clone(binding);
    forged.tags = forged.tags.map((t) => (t[0] === 'i' ? [t[0], t[1] ?? '', `${t[2]?.slice(0, -4)}AAAA`] : t));
    expect(await status(keys.npub, [forged])).toEqual({ state: 'not_linked' });
  });

  it('says relays are unreachable, not "not linked", when no relay answered', async () => {
    expect(await status(keys.npub, [], 0)).toEqual({ state: 'unreachable' });
    expect(await status(address, [], 0)).toEqual({ state: 'unreachable' });
  });

  it('refuses input that is neither a key nor an address without asking relays', async () => {
    let asked = false;
    const probe: ProbeFn = async () => ((asked = true), 2);
    expect(await badgeStatus('alice@example.com', { probe, query: fakeRelay([binding]) })).toEqual({ state: 'bad_input' });
    expect(await badgeStatus('', { probe, query: fakeRelay([binding]) })).toEqual({ state: 'bad_input' });
    expect(asked).toBe(false);
  });
});

describe('short forms', () => {
  it('keeps the start and end of an npub and an address', () => {
    expect(shortNpub(keys.npub)).toBe(`${keys.npub.slice(0, 10)}…${keys.npub.slice(-6)}`);
    const bare = address.replace('bitcoincash:', '');
    expect(shortAddress(address)).toBe(`${bare.slice(0, 8)}…${bare.slice(-6)}`);
  });
});

/** A local socket server on a free port: `answer` decides whether it replies EOSE to a REQ like a relay. */
async function server(answer: boolean): Promise<{ url: string; close: () => Promise<void> }> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss.once('listening', r));
  wss.on('connection', (ws) => ws.on('message', (data) => {
    const msg = JSON.parse(String(data)) as unknown[];
    if (answer && msg[0] === 'REQ') ws.send(JSON.stringify(['EOSE', msg[1]]));
  }));
  const { port } = wss.address() as AddressInfo;
  return { url: `ws://127.0.0.1:${port}`, close: () => new Promise((r) => wss.close(() => r())) };
}

describe('createProbe', () => {
  const probe = createProbe(WebSocket as unknown as Parameters<typeof createProbe>[0]);
  const servers: Awaited<ReturnType<typeof server>>[] = [];
  afterAll(async () => {
    await Promise.all(servers.map((s) => s.close()));
  });

  it('counts relays that answer, and not a closed port or a socket that never answers', async () => {
    const relay = await server(true);
    const silent = await server(false);
    servers.push(relay, silent);
    expect(await probe([relay.url], 2000)).toBe(1);
    expect(await probe(['ws://127.0.0.1:1', silent.url], 400)).toBe(0);
    expect(await probe([relay.url, silent.url, 'ws://127.0.0.1:1'], 400)).toBe(1);
  });

  it('answers 0 without a WebSocket class instead of throwing', async () => {
    expect(await createProbe(undefined)([], 100)).toBe(0);
  });
});
