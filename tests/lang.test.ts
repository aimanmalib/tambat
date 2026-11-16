import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { leafKeys, translate, type Dictionary } from '../src/i18n.js';

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../lang/${name}.json`, import.meta.url), 'utf8')) as Dictionary;

describe('lang files', () => {
  const en = load('en');
  const ms = load('ms');

  it('have the same keys', () => {
    expect(leafKeys(ms)).toEqual(leafKeys(en));
  });

  it('have no empty strings', () => {
    for (const dict of [en, ms]) {
      for (const key of leafKeys(dict)) expect(translate(dict, key).trim(), key).not.toBe('');
    }
  });
});

describe('translate', () => {
  const dict: Dictionary = { a: { b: 'text' } };

  it('reads a nested key', () => {
    expect(translate(dict, 'a.b')).toBe('text');
  });

  it('returns the key when it is missing', () => {
    expect(translate(dict, 'a.c')).toBe('a.c');
    expect(translate(dict, 'a.b.c')).toBe('a.b.c');
  });
});
