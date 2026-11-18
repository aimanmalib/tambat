import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { config, cspHeader, NIP32_LABEL_KIND, parseConfig } from '../src/config.js';

const fresh = () => JSON.parse(readFileSync(new URL('../config/tambat.json', import.meta.url), 'utf8'));

describe('config/tambat.json', () => {
  it('passes its own shape check', () => {
    expect(config.nostr.relays.length).toBeGreaterThan(0);
    expect(['bitcoincash', 'bchtest']).toContain(config.network);
  });

  it('uses NIP-39 and NIP-98 event kinds', () => {
    expect(config.nostr.bindingKind).toBe(10011);
    expect(config.nostr.authKind).toBe(27235);
  });

  it('rejects a receipt or attestation kind other than the NIP-32 label kind', () => {
    for (const key of ['receipt', 'attest'] as const) {
      const c = fresh();
      c[key].kind = 30078;
      expect(() => parseConfig(c)).toThrow(new RegExp(`${key}.kind`));
    }
    expect(config.receipt.kind).toBe(NIP32_LABEL_KIND);
    expect(config.attest.kind).toBe(NIP32_LABEL_KIND);
  });

  it('rejects a relay that is not wss', () => {
    const c = fresh();
    c.nostr.relays = ['ws://relay.example'];
    expect(() => parseConfig(c)).toThrow(/nostr.relays/);
  });

  it('rejects an unknown network', () => {
    const c = fresh();
    c.network = 'mainnet';
    expect(() => parseConfig(c)).toThrow(/network/);
  });

  it('rejects a platform name containing a colon', () => {
    const c = fresh();
    c.nostr.platform = 'bch:cash';
    expect(() => parseConfig(c)).toThrow(/platform/);
  });

  it('rejects an origin with a path', () => {
    const c = fresh();
    c.auth.allowedOrigins = ['https://example.com/login'];
    expect(() => parseConfig(c)).toThrow(/allowedOrigins/);
  });

  it('rejects a zero challenge lifetime', () => {
    const c = fresh();
    c.auth.challengeTtlSeconds = 0;
    expect(() => parseConfig(c)).toThrow(/challengeTtlSeconds/);
  });

  it('rejects a DID chain id that is not CAIP-2 bip122', () => {
    const c = fresh();
    c.did.chains.bitcoincash = 'bch:mainnet';
    expect(() => parseConfig(c)).toThrow(/did.chains.bitcoincash/);
  });

  it('rejects a cookie name with a separator', () => {
    const c = fresh();
    c.auth.cookieName = 'a;b';
    expect(() => parseConfig(c)).toThrow(/cookieName/);
  });

  it('rejects a CSP source that would inject another directive', () => {
    const c = fresh();
    c.server.contentSecurityPolicy['script-src'] = ["'self'; script-src *"];
    expect(() => parseConfig(c)).toThrow(/contentSecurityPolicy.script-src/);
  });

  it('builds the CSP header from the directive map', () => {
    expect(cspHeader({ 'default-src': ["'self'"], 'img-src': ["'self'", 'data:'] })).toBe("default-src 'self'; img-src 'self' data:");
    expect(cspHeader()).toMatch(/frame-ancestors 'none'/);
    // libauth verifies signatures with WebAssembly: without this source the browser refuses to compile it.
    expect(config.server.contentSecurityPolicy['script-src']).toContain("'wasm-unsafe-eval'");
  });
});
