import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { config, cspHeader, NIP32_LABEL_KIND, isRootMargin, parseConfig } from '../src/config.js';

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

  it('rejects a selective disclosure proof kind, namespace, field list or salt the format does not allow', () => {
    const cases: [(c: ReturnType<typeof fresh>) => void, RegExp][] = [
      [(c) => (c.sd.kind = 30078), /sd\.kind/],
      [(c) => (c.sd.namespace = c.attest.namespace), /sd\.namespace/],
      [(c) => (c.sd.fields = ['network', 'bindingEvent', 'boundAt']), /sd\.fields/],
      [(c) => (c.sd.fields = ['bchAddress', 'network']), /sd\.fields/],
      [(c) => (c.sd.fields = ['bchAddress', 'network', 'network']), /sd\.fields/],
      [(c) => (c.sd.fields = ['bchAddress', 'network', 'nickname']), /sd\.fields/],
      [(c) => (c.sd.saltBytes = 8), /sd\.saltBytes/],
      [(c) => (c.sd.credentialType = 'selective'), /sd\.credentialType/],
    ];
    for (const [change, err] of cases) {
      const c = fresh();
      change(c);
      expect(() => parseConfig(c)).toThrow(err);
    }
    expect(config.sd.kind).toBe(NIP32_LABEL_KIND);
  });

  it('rejects wallet error codes that are not integers, are empty, or repeat across names', () => {
    for (const codes of [{ rejected: ['5000'] }, { rejected: [] }, { rejected: [5000], other: [5000] }, [5000]]) {
      const c = fresh();
      c.walletConnect.errorCodes = codes;
      expect(() => parseConfig(c)).toThrow(/walletConnect.errorCodes/);
    }
    const c = fresh();
    c.walletConnect.errorDetailMaxChars = 0;
    expect(() => parseConfig(c)).toThrow(/walletConnect.errorDetailMaxChars/);
  });

  it('spends only confirmed coins for the anchor by default and rejects a value that is not a boolean', () => {
    expect(config.anchor.confirmedCoinsOnly).toBe(true);
    for (const value of ['true', 1, undefined]) {
      const c = fresh();
      c.anchor.confirmedCoinsOnly = value;
      expect(() => parseConfig(c)).toThrow(/anchor.confirmedCoinsOnly/);
    }
  });

  it('rejects a wall page size, page count or chain concurrency that is not a positive integer', () => {
    for (const [key, value] of [['pageSize', 0], ['pageSize', 2.5], ['maxPages', 0], ['maxPages', '5'], ['chainConcurrency', 0], ['chainConcurrency', 1.5], ['chainConcurrency', undefined]] as const) {
      const c = fresh();
      c.wall[key] = value;
      expect(() => parseConfig(c)).toThrow(new RegExp(`wall.${key}`));
    }
  });

  it('keeps the wall refresh between 5 and 120 whole seconds', () => {
    for (const value of [4, 121, 30.5, '30', undefined]) {
      const c = fresh();
      (c.wall as Record<string, unknown>).refreshSeconds = value;
      expect(() => parseConfig(c)).toThrow(/wall\.refreshSeconds/);
    }
    for (const value of [5, 120]) {
      const c = fresh();
      c.wall.refreshSeconds = value;
      expect(parseConfig(c).wall.refreshSeconds).toBe(value);
    }
  });

  it('takes a wall badge margin only in the form IntersectionObserver accepts', () => {
    expect(config.wall.sinceRootMargin).toBe('0px 0px 100% 0px');
    for (const ok of ['0px', '10% 0px', '-5px 0px 50% 0px']) expect(isRootMargin(ok)).toBe(true);
    for (const value of ['', '100', '0px 0px 100% 0px 0px', '1em', '0px,0px', 100, undefined]) {
      const c = fresh();
      c.wall.sinceRootMargin = value;
      expect(() => parseConfig(c)).toThrow(/wall.sinceRootMargin/);
    }
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
