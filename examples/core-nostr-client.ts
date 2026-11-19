/**
 * A Nostr client checks that an npub is bound to a BCH address, with the library package only.
 * Run: npx tsx examples/core-nostr-client.ts [event.json]  (default: the signed example binding, no network)
 * Live: `await lookupByPubkey(npub)` returns the same result from the configured relays.
 */
import { readFileSync } from 'node:fs';
import { verifyBinding } from '@tambat/core';

const file = process.argv[2] ?? new URL('./binding-event.json', import.meta.url);
const result = verifyBinding(JSON.parse(readFileSync(file, 'utf8')));
for (const step of result.steps) console.log(step.status, step.name);
for (const claim of result.claims) console.log(claim.ok ? 'bound' : 'not bound', result.npub, '->', claim.address);
process.exitCode = result.ok ? 0 : 1;
