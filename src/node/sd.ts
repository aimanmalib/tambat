/**
 * Selective disclosure from the command line (ADR 0019). `sd issue` makes the holder's credential with every
 * disclosure from its binding (read from a file or the relays) and the holder's key file; the holder keeps that file.
 * `sd present` keeps only the named fields. `sd verify` checks a presentation offline and lists what it reveals.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { config } from '../config.js';
import { lookupByPubkey, type QueryFn } from '../core/discover.js';
import { keysFromPhrase } from '../core/paytaca.js';
import { toNpub } from '../core/nostr.js';
import { issueSd, presentSd, verifySdPresentation, type SdPresentation, type SdProblem } from '../core/sd.js';
import { verifyBinding } from '../core/verify.js';

export const SD_REASONS: Record<SdProblem, string> = {
  shape: 'not a selective disclosure presentation (context, type, holder, credential, _sd)',
  issuer: 'holder, issuer, subject and proof key are not the same key',
  proof: `the proof is not a ${config.vc.proofType} with a selective disclosure label event`,
  proof_event: 'the proof event does not match its id',
  proof_signature: 'the proof event signature does not verify',
  proof_hash: 'the proof event signs a different credential',
  disclosure_malformed: 'a disclosure is not [salt, field, value] with a long enough salt and a known field',
  disclosure_duplicate: 'a disclosure or field appears twice',
  disclosure_unknown: 'a disclosure digest is not in the credential (changed value or another credential)',
  bch_signature: 'the BCH signature in the address is not for the holder\'s npub',
};

const readJson = (file: string): unknown => JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8'));

const write = (out: string | undefined, value: unknown): void => {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (out) writeFileSync(out, text, { mode: 0o600 });
  else process.stdout.write(text);
};

/** Issues from the holder's phrase. The binding comes from `bindingFile` or from the relays. */
export async function sdIssue(phrase: string, bindingFile: string | undefined, out: string | undefined, query: QueryFn): Promise<number> {
  const keys = keysFromPhrase(phrase, config.network);
  const binding = bindingFile ? verifyBinding(readJson(bindingFile)) : await lookupByPubkey(keys.nostrPubkey, { query });
  if (!binding?.ok || binding.pubkey !== keys.nostrPubkey) {
    console.error(`no verified binding of ${keys.npub}${bindingFile ? ` in ${bindingFile}` : ' on the relays'}`);
    return 1;
  }
  write(out, issueSd({ binding, secretKey: keys.nostrSecretKey }));
  if (out) console.error(`wrote ${out}: every field disclosed; keep it private and share only: tambat sd present ${out} --reveal <fields>`);
  return 0;
}

/** Writes a presentation that reveals only `reveal` (comma separated field names, may be empty). */
export function sdPresent(file: string, reveal: string, out: string | undefined): number {
  const names = reveal.split(',').map((s) => s.trim()).filter((s) => s !== '');
  write(out, presentSd(readJson(file) as SdPresentation, names));
  return 0;
}

/** Exit 0 when the presentation verifies, 1 with the reason when it does not. */
export function sdVerify(file: string, json: boolean): number {
  const r = verifySdPresentation(readJson(file));
  if (json) console.log(JSON.stringify(r, null, 2));
  else if (r.ok) {
    console.log(
      [
        `VERIFIED  selective disclosure by ${toNpub(r.holder)} (${r.validFrom})`,
        ...r.disclosed.map((d) =>
          d.name === 'bchAddress' ? `  bchAddress ${(d.value as { address: string }).address} (BCH signature for this npub checked)` : `  ${d.name} ${String(d.value)}`,
        ),
        `  ${r.hidden} of ${r.fields} field(s) hidden`,
        'Checked offline. Revealed values are seen as they are; this is not a zero-knowledge proof.',
      ].join('\n'),
    );
  } else console.log(`NOT VERIFIED  ${SD_REASONS[r.reason]}${r.path ? ` (${r.path})` : ''}`);
  return r.ok ? 0 : 1;
}
