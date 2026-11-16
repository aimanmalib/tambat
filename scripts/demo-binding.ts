/**
 * The project's own demo identity, used to show a real binding on public relays.
 *   npx tsx scripts/demo-binding.ts keys                  make state/demo-keys.json (mode 0600) once; prints npub + address
 *   npx tsx scripts/demo-binding.ts publish               sign the binding and publish it to the configured relays
 *   npx tsx scripts/demo-binding.ts signin <site-url>     sign in to a deployed demo app through its API
 * The keys come from a fresh BIP39 phrase on the same paths a phrase wallet such as Paytaca uses. The phrase stays in
 * the state file; this script prints public values only (npub, address, event id, relay answers, session).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { generateBip39Mnemonic } from '@bitauth/libauth';
import { finalizeEvent } from 'nostr-tools/pure';
import { config } from '../src/config.js';
import { createAuthEvent } from '../src/core/auth.js';
import { signMessage } from '../src/core/bchmsg.js';
import { keysFromPhrase, bindingFromKeys } from '../src/core/paytaca.js';
import { publishEvent } from '../src/core/publish.js';
import { RelaySocket } from '../src/node/relay.js';

const KEY_FILE = resolve(process.env.TAMBAT_DEMO_KEYS ?? 'state/demo-keys.json');

function loadKeys() {
  if (!existsSync(KEY_FILE)) throw new Error(`${KEY_FILE} not found: run "keys" first`);
  const { phrase } = JSON.parse(readFileSync(KEY_FILE, 'utf8')) as { phrase: string };
  return keysFromPhrase(phrase, config.network);
}

function makeKeys(): void {
  if (!existsSync(KEY_FILE)) {
    const phrase = generateBip39Mnemonic();
    if (typeof phrase !== 'string') throw new Error(phrase);
    mkdirSync(dirname(KEY_FILE), { recursive: true });
    writeFileSync(KEY_FILE, JSON.stringify({ phrase }) + '\n', { mode: 0o600 });
  }
  chmodSync(KEY_FILE, 0o600);
  const keys = loadKeys();
  console.log(JSON.stringify({ npub: keys.npub, pubkey: keys.nostrPubkey, address: keys.address }, null, 2));
}

async function publish(): Promise<void> {
  const keys = loadKeys();
  const event = bindingFromKeys(keys, Math.floor(Date.now() / 1000));
  const ws = RelaySocket as unknown as typeof WebSocket;
  const outcomes = await publishEvent(event, config.nostr.relays, config.nostr.publishTimeoutMs, ws);
  console.log(JSON.stringify({ id: event.id, npub: keys.npub, address: keys.address, created_at: event.created_at, outcomes }, null, 2));
}

async function signIn(site: string): Promise<void> {
  const keys = loadKeys();
  const origin = new URL(site).origin;
  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(body),
    });
    return { status: res.status, cookie: res.headers.get('set-cookie') ?? '', body: (await res.json()) as Record<string, unknown> };
  };
  const challenge = await post('/api/rp/challenge', {});
  if (challenge.status !== 200) throw new Error(`challenge answered ${challenge.status}`);
  const c = challenge.body as { nonce: string; bchText: string };
  const event = finalizeEvent(createAuthEvent({ origin, nonce: c.nonce }), keys.nostrSecretKey);
  const login = await post('/api/rp/login', { event, bchSignature: signMessage(keys.bchPrivateKey, c.bchText) });
  const binding = login.body.binding as { ok?: boolean; event?: { id?: string } } | null | undefined;
  const summary = { status: login.status, sessionCookie: login.cookie !== '', session: login.body.session ?? login.body, bindingEvent: binding?.event?.id ?? null };
  console.log(JSON.stringify(summary, null, 2));
  if (login.status !== 200) process.exitCode = 1;
}

const [command, arg] = process.argv.slice(2);
if (command === 'keys') makeKeys();
else if (command === 'publish') await publish();
else if (command === 'signin' && arg) await signIn(arg);
else {
  console.error('usage: demo-binding.ts keys | publish | signin <site-url>');
  process.exitCode = 2;
}
