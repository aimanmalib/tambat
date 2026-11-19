/**
 * Writes examples/sd-presentation.json: a selective disclosure presentation (ADR 0019) of the main demo identity that
 * reveals the BCH address only; every other field stays a salted digest. The binding is the published demo binding
 * carried by examples/attestation-vc.json. The demo phrase is read from state/ and never printed; the issued file
 * with every disclosure is not written anywhere. Usage: npx tsx scripts/make-sd-example.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../src/config.js';
import { keysFromPhrase } from '../src/core/paytaca.js';
import { issueSd, presentSd, verifySdPresentation } from '../src/core/sd.js';
import type { AttestationCredential } from '../src/core/vc.js';
import { verifyBinding } from '../src/core/verify.js';
import { readPhrase } from '../src/node/manage.js';

const holder = keysFromPhrase(readPhrase(resolve('state/demo-keys.json')), config.network);
const published = JSON.parse(readFileSync('examples/attestation-vc.json', 'utf8')) as AttestationCredential;
const binding = verifyBinding(published.proof.binding);
if (!binding.ok || binding.pubkey !== holder.nostrPubkey) throw new Error('examples/attestation-vc.json does not carry the demo binding');

const presentation = presentSd(issueSd({ binding, secretKey: holder.nostrSecretKey }), ['bchAddress']);
const check = verifySdPresentation(JSON.parse(JSON.stringify(presentation)));
if (!check.ok || check.disclosed.length !== 1 || check.hidden < 2) throw new Error(`the presentation does not verify as expected: ${JSON.stringify(check)}`);
writeFileSync('examples/sd-presentation.json', `${JSON.stringify(presentation, null, 2)}\n`);
console.log(`wrote examples/sd-presentation.json: ${check.disclosed.map((d) => d.name).join(', ')} revealed, ${check.hidden} hidden`);
