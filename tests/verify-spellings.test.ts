/** VERIFY.md lists the tag spellings a reader may meet; these checks fail when that list and the reading code drift apart. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { claimFromTag, claimIdentities } from '../src/core/binding.js';
import { parseProofs } from '../src/core/tx-proof.js';
import { vectors } from './helpers.js';

const verify = readFileSync(new URL('../docs/VERIFY.md', import.meta.url), 'utf8');
const full = vectors.bch.address.bitcoincash;
const payload = full.split(':')[1]!;
const signature = 'A'.repeat(88);
const txid = 'ab'.repeat(32);
const fill = (text: string) =>
  text
    .replaceAll('q…', payload)
    .replaceAll('<base64>', signature)
    .replaceAll('<64 hex>', txid)
    .replaceAll('<txid>', txid)
    .replaceAll('\\|', '|');

/** Rows of the "Tag spellings" table: [tag JSON, address column, proof column]. */
function rows(): [string, string, string][] {
  const table = verify.split('Tag spellings')[1]?.split('\n\n')[1] ?? '';
  return table
    .split('\n')
    .slice(2)
    .map((line) => /^\| `(.+?)` \| (.+?) \| (.+?) \|$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1]!, m[2]!, m[3]!]);
}

describe('VERIFY.md tag spellings', () => {
  it('every tag in the table is read as a claim on the right address with the proof the table names', () => {
    const table = rows();
    expect(table.length).toBeGreaterThanOrEqual(5);
    for (const [tagText, , proof] of table) {
      const tag = JSON.parse(fill(tagText)) as string[];
      const claim = claimFromTag(tag);
      expect(claim, tagText).not.toBeNull();
      expect(claim!.address.endsWith(payload), tagText).toBe(true);
      const forms = parseProofs(claim!.signature).map((p) => p.form).sort().join('+');
      const expected = proof.startsWith('both') ? 'message+tx' : proof.startsWith('signed') ? 'message' : 'tx';
      expect(forms, tagText).toBe(expected);
    }
  });

  it('the address look-up asks for spellings the reader produces', () => {
    const req = /"#i": (\[.+?\])\}\]`/.exec(verify)?.[1] ?? '[]';
    const asked = JSON.parse(fill(req)) as string[];
    expect(asked.length).toBeGreaterThanOrEqual(3);
    const known = claimIdentities(full);
    for (const spelling of asked) expect(known).toContain(spelling);
  });
});
