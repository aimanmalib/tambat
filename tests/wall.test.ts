/** The wall lists only bindings that pass every step, counts the ones that fail, and leaves out replaced ones. */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { finalizeEvent } from 'nostr-tools/pure';
import { config } from '../src/config.js';
import { signMessage } from '../src/core/bchmsg.js';
import { claimIdentity, createRevocationEvent } from '../src/core/binding.js';
import { createRelayQuery, type Filter } from '../src/core/discover.js';
import { verificationText, type Event } from '../src/core/nostr.js';
import { buildWall, loadWall } from '../src/core/wall.js';
import { clone, fakeRelay, keys, other, vectors } from './helpers.js';

const binding = clone(vectors.bindingEvent);

/** A genuine binding by the second test key, newer than the vector. */
const second = finalizeEvent(
  {
    kind: config.nostr.bindingKind,
    created_at: binding.created_at + 100,
    content: '',
    tags: [['i', claimIdentity(other.address), signMessage(other.bchPrivateKey, verificationText(other.npub))]],
  },
  other.nostrSecretKey,
) as Event;

/** The Nostr signature changed: the relay copy no longer verifies. */
function badNostrSig(e: Event): Event {
  const forged = clone(e);
  forged.sig = `${forged.sig.slice(0, -4)}${forged.sig.endsWith('0000') ? '1111' : '0000'}`;
  return forged;
}

/** A binding re-signed with a later date, then its signature broken: a distinct id that no longer verifies. */
const forged = badNostrSig(finalizeEvent({ ...binding, created_at: binding.created_at + 50 }, keys.nostrSecretKey) as Event);

describe('buildWall', () => {
  it('lists genuine bindings newest first and hides a forged one', () => {
    const wall = buildWall([binding, second, forged], 30);
    expect(wall.entries.map((e) => e.npub)).toEqual([other.npub, keys.npub]);
    expect(wall.entries[0]).toEqual({
      npub: other.npub,
      pubkey: other.nostrPubkey,
      address: other.address,
      createdAt: second.created_at,
      eventId: second.id,
      proof: 'message',
    });
    expect(wall.hidden).toBe(1);
  });

  it('hides a binding whose BCH signature was made by another key', () => {
    const wrong = finalizeEvent(
      { ...binding, created_at: binding.created_at + 5, tags: [['i', claimIdentity(keys.address), signMessage(other.bchPrivateKey, verificationText(keys.npub))]] },
      keys.nostrSecretKey,
    ) as Event;
    expect(buildWall([wrong], 30)).toEqual({ entries: [], hidden: 1, scanned: 1 });
  });

  it('leaves out a binding replaced by a newer event without counting it as a failure', () => {
    const revoked = finalizeEvent(createRevocationEvent(binding, binding.created_at + 10), keys.nostrSecretKey) as Event;
    expect(buildWall([binding, revoked, second], 30)).toEqual({ entries: [expect.objectContaining({ npub: other.npub })], hidden: 0, scanned: 3 });
  });

  it('does not let a forged newer event push out the genuine one', () => {
    const fakeNewer = badNostrSig(finalizeEvent(createRevocationEvent(binding, binding.created_at + 10), keys.nostrSecretKey) as Event);
    const wall = buildWall([binding, fakeNewer], 30);
    expect(wall.entries.map((e) => e.eventId)).toEqual([binding.id]);
  });

  it('counts each event once when several relays return it, keeping the copy that verifies', () => {
    expect(buildWall([badNostrSig(binding), binding, clone(binding)], 30)).toEqual({ entries: [expect.objectContaining({ eventId: binding.id })], hidden: 0, scanned: 1 });
  });

  it('ignores events of other platforms and junk, and counts a malformed BCH claim event', () => {
    const github = finalizeEvent({ kind: config.nostr.bindingKind, created_at: 1, content: '', tags: [['i', 'github:someone', 'abc']] }, other.nostrSecretKey);
    const malformed = { tags: [['i', claimIdentity(keys.address), 'x']] };
    expect(buildWall([github, null, 'junk', 42, malformed], 30)).toEqual({ entries: [], hidden: 1, scanned: 1 });
  });

  it('shows at most the limit', () => {
    expect(buildWall([binding, second], 1).entries.map((e) => e.eventId)).toEqual([second.id]);
  });
});

describe('loadWall', () => {
  it('asks for one page of the newest identity events and verifies them', async () => {
    const filters: Filter[] = [];
    const query = fakeRelay([binding, forged]);
    const wall = await loadWall({ relays: ['wss://a.example'], timeoutMs: 200, limit: 7, pageSize: 50, maxPages: 5, query: (r, f, t) => (filters.push(f), query(r, f, t)) });
    expect(filters).toEqual([{ kinds: [config.nostr.bindingKind], limit: 50 }]);
    expect(wall).toEqual({ entries: [expect.objectContaining({ eventId: binding.id })], hidden: 1, scanned: 2 });
  });

  it('reads as empty when the relays fail', async () => {
    expect(await loadWall({ relays: ['wss://a.example'], timeoutMs: 50, query: () => Promise.reject(new Error('down')) })).toEqual({ entries: [], hidden: 0, scanned: 0 });
  });
});

describe('createRelayQuery keepUnverified', () => {
  let server: Server | undefined;
  afterAll(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  it('passes a forged event through only when asked to, so the wall can count it', async () => {
    server = createServer();
    const wss = new WebSocketServer({ server });
    wss.on('connection', (ws) => {
      ws.on('message', (data) => {
        const [type, id] = JSON.parse(String(data)) as [string, string];
        if (type !== 'REQ') return;
        ws.send(JSON.stringify(['EVENT', id, binding]));
        ws.send(JSON.stringify(['EVENT', id, forged]));
        ws.send(JSON.stringify(['EOSE', id]));
      });
    });
    await new Promise<void>((done) => server?.listen(0, '127.0.0.1', done));
    const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const Socket = WebSocket as unknown as typeof globalThis.WebSocket;
    const filter = { kinds: [config.nostr.bindingKind] };
    const checked = (await createRelayQuery(Socket)([url], filter, 1500)) as Event[];
    const kept = (await createRelayQuery(Socket, { keepUnverified: true })([url], filter, 1500)) as Event[];
    expect(checked.map((e) => e.id)).toEqual([binding.id]);
    expect(kept.map((e) => e.id).sort()).toEqual([binding.id, forged.id].sort());
  });
});
