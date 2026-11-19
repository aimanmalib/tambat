/**
 * A wallet that holds a BCH address and knows the user's npub builds the binding with the library package only.
 * The public test phrase stands in for the wallet's keys; a real wallet signs with bch_signMessage and NIP-07/NIP-46.
 * Run: npx tsx examples/core-wallet.ts
 */
import { createBindingEvent, keysFromPhrase, signMessage, verificationText, verifyClaim } from '@tambat/core';

const wallet = keysFromPhrase('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', 'bitcoincash');
const text = verificationText(wallet.npub); // 1. the text the BCH key signs
const signature = signMessage(wallet.bchPrivateKey, text); // 2. the wallet's bch_signMessage answer
const template = createBindingEvent({ claim: { address: wallet.address, signature }, createdAt: 1763251200 });
const check = verifyClaim(wallet.address, signature, wallet.npub, wallet.nostrPubkey, 'bitcoincash');
console.log(JSON.stringify({ text, template, claimOk: check.ok }, null, 2)); // 3. sign `template` with the Nostr key
process.exitCode = check.ok ? 0 : 1;
