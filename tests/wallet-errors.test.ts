/**
 * Wallet errors reach the page as a named reason in the chosen language. WalletConnect rejects a request with a plain
 * JSON-RPC object `{ code, message }`, not an Error, so this file only uses modules that turned such an object into
 * "[object Object]" before, and checks the text against the language files.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { errorText } from '../src/errors.js';
import { translate, translator, type Dictionary } from '../src/i18n.js';

const load = (name: string) => JSON.parse(readFileSync(new URL(`../lang/${name}.json`, import.meta.url), 'utf8')) as Dictionary;
const dicts = { en: load('en'), ms: load('ms') };
const config = JSON.parse(readFileSync(new URL('../config/tambat.json', import.meta.url), 'utf8')) as {
  walletConnect: { errorCodes?: Record<string, number[]> };
};

describe.each(Object.entries(dicts))('wallet errors in %s', (_lang, dict) => {
  const t = translator(dict);
  const text = (key: string) => translate(dict, key);

  it('names a refusal in the wallet (WalletConnect USER_REJECTED, as Paytaca sends it)', () => {
    expect(errorText({ code: 5000, message: 'User rejected' }, t)).toBe(text('errors.wallet.rejected'));
  });

  it('names an unsupported method and an ended session', () => {
    expect(errorText({ code: -32601, message: 'Method not found' }, t)).toBe(text('errors.wallet.unsupported'));
    expect(errorText({ code: 6000, message: 'User disconnected.' }, t)).toBe(text('errors.wallet.sessionEnded'));
  });

  it('reads a code sent as text', () => {
    expect(errorText({ code: '5000', message: 'User rejected' }, t)).toBe(text('errors.wallet.rejected'));
  });

  it('shows the message and code of an unknown wallet error inside a translated sentence', () => {
    const out = errorText({ code: -32603, message: 'Signing failed' }, t);
    expect(out).toContain('Signing failed');
    expect(out).toContain('-32603');
    expect(out).not.toBe('Signing failed');
    expect(out).not.toContain('[object Object]');
  });

  it('never shows "[object Object]" for objects, nulls or text', () => {
    for (const e of [{}, { code: -32603 }, { message: 'Expired' }, { data: { nested: true } }, null, undefined, 'plain text']) {
      const out = errorText(e, t);
      expect(out, JSON.stringify(e)).not.toContain('[object Object]');
      expect(out).not.toBe('');
    }
  });

  it('keeps a long unknown detail short', () => {
    expect(errorText({ data: 'x'.repeat(5000) }, t).length).toBeLessThan(400);
  });
});

describe('wallet error codes in config', () => {
  it('lists integer codes once each, and every name has text in both languages', () => {
    const codes = config.walletConnect.errorCodes ?? {};
    expect(Object.keys(codes)).toEqual(expect.arrayContaining(['rejected', 'unsupported', 'sessionEnded']));
    const all = Object.values(codes).flat();
    expect(all.every((c) => Number.isInteger(c))).toBe(true);
    expect(new Set(all).size).toBe(all.length);
    for (const dict of Object.values(dicts)) {
      for (const name of [...Object.keys(codes), 'other', 'otherCode']) {
        expect(translate(dict, `errors.wallet.${name}`), name).not.toBe(`errors.wallet.${name}`);
      }
    }
  });
});
