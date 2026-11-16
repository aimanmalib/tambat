/** Every reason the web app shows has text in both languages, and errors never reach the page as bare English. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REASON_CODES, verifyBinding, verifyClaim, type Step } from '../src/core/verify.js';
import { ApiError, errorText, stepReason, TextError } from '../src/errors.js';
import { translate, translator, type Dictionary } from '../src/i18n.js';
import { clone, keys, other, vectors } from './helpers.js';

const load = (name: string) => JSON.parse(readFileSync(new URL(`../lang/${name}.json`, import.meta.url), 'utf8')) as Dictionary;
const dicts = { en: load('en'), ms: load('ms') };
const ms = translator(dicts.ms);

describe('reason codes', () => {
  it.each(Object.entries(dicts))('every code has text in %s', (_lang, dict) => {
    for (const code of REASON_CODES) expect(translate(dict, `steps.reasons.${code}`), code).not.toBe(`steps.reasons.${code}`);
  });

  it('every failed or skipped step carries a code next to its English reason', () => {
    const tampered = clone(vectors.bindingEvent);
    tampered.content = 'edited';
    const steps: Step[] = [
      ...verifyBinding(tampered).steps,
      ...verifyBinding({}).steps,
      ...verifyBinding(clone(vectors.bindingEvent)).steps,
      ...verifyClaim(other.address, vectors.bchSignature, keys.npub, keys.nostrPubkey, 'bitcoincash').steps,
      ...verifyClaim('bitcoincash:nope', 'x', keys.npub, keys.nostrPubkey, 'bitcoincash').steps,
    ];
    const explained = steps.filter((s) => s.status !== 'pass');
    expect(explained.length).toBeGreaterThan(4);
    for (const s of explained) {
      expect(s.reason, s.name).toBeTruthy();
      expect(REASON_CODES, s.name).toContain(s.code);
    }
  });

  it('shows a wrong signer in Malay with the address and npub filled in', () => {
    const r = verifyClaim(other.address, vectors.bchSignature, keys.npub, keys.nostrPubkey, 'bitcoincash');
    const step = r.steps.find((s) => s.name === 'address_match');
    expect(step?.code).toBe('wrong_signer');
    const text = stepReason(step as Step, ms) ?? '';
    expect(text).toContain(other.address);
    expect(text).toContain(keys.npub);
    expect(text).not.toMatch(/signature was not made|\{/);
  });
});

describe('errorText', () => {
  it('translates language-key errors and known server codes', () => {
    expect(errorText(new TextError('errors.noExtension'), ms)).toBe(translate(dicts.ms, 'errors.noExtension'));
    expect(errorText(new ApiError('challenge_expired', 'challenge expired; request a new one'), ms)).toBe(
      translate(dicts.ms, 'errors.api.challenge_expired'),
    );
  });

  it('wraps outside text in a translated sentence', () => {
    const text = errorText(new Error('connection refused'), ms);
    expect(text).toContain('connection refused');
    expect(text.startsWith(translate(dicts.ms, 'errors.unexpected').split('{')[0] ?? '')).toBe(true);
    expect(errorText(new ApiError('unknown_code', 'boom'), ms)).toContain('boom');
  });
});
