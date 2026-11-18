/** Typed access to config/tambat.json. Every value that may change lives in that file; code reads it. */
import raw from '../config/tambat.json' with { type: 'json' };

export type Network = 'bitcoincash' | 'bchtest';

export interface TambatConfig {
  network: Network;
  nostr: {
    bindingKind: number;
    authKind: number;
    platform: string;
    /** Tag name of a recovery claim in a binding event (docs/SPEC.md "Recovery"). */
    recoveryTag: string;
    /** Text the bound BCH key signs to hand its binding to a new Nostr key; `{npub}` is the old key. */
    recoveryText: string;
    relays: string[];
    queryTimeoutMs: number;
    publishTimeoutMs: number;
  };
  cli: {
    /** Phrase file the revoke and rotate commands sign with (JSON `{ "phrase": ... }`, mode 0600, never tracked). */
    keysFile: string;
    /** How many receiving addresses of the phrase `rotate` searches for the new address. */
    addressSearchLimit: number;
  };
  nip05: {
    /** How long a name lookup waits for the domain's /.well-known/nostr.json. */
    timeoutMs: number;
    /** The names this site answers for at /.well-known/nostr.json: name to hex public key. Only the demo identity. */
    names: Record<string, string>;
  };
  auth: {
    challengeTtlSeconds: number;
    sessionTtlSeconds: number;
    /** How far a sign-in event's created_at may differ from server time. */
    clockSkewSeconds: number;
    maxPendingChallenges: number;
    maxSessions: number;
    cookieName: string;
    allowedOrigins: string[];
  };
  did: {
    /** CAIP-2 chain id per network, used in blockchainAccountId of the DID document. */
    chains: Record<Network, string>;
  };
  server: {
    host: string;
    port: number;
    bodyLimitBytes: number;
    /** Built web app served as static files, relative to the repository root. */
    staticDir: string;
    /** Built one-file verifier served at /verify/, relative to the repository root. */
    verifierFile: string;
    /**
     * Content-Security-Policy sent with the web app, one list of sources per directive. connect-src stays open to any
     * wss: and https: host because NIP-46 signers and NIP-05 names point at relays and domains the user chooses.
     */
    contentSecurityPolicy: Record<string, string[]>;
  };
  walletConnect: {
    projectId: string;
    chains: Record<Network, string>;
    methods: string[];
  };
  site: {
    publicUrl: string;
    defaultLanguage: string;
    languages: string[];
  };
  banner: {
    deckUrl: string;
    repoUrl: string;
    contactAddress: string;
  };
  embed: {
    /** The badge page inside the built web app (staticDir), served at /embed/<npub or address>. */
    page: string;
    /** Size of the iframe /embed.js inserts, in CSS pixels. */
    width: number;
    height: number;
    /** frame-ancestors for /embed/ only; every other page keeps the server policy (frame-ancestors 'none'). */
    frameAncestors: string[];
  };
  wall: {
    /** How many of the newest binding events the wall asks each relay for and shows at most. */
    limit: number;
  };
  /** Optional BCH anchor (docs/SPEC.md "Optional BCH anchor"). The server never signs or sends a transaction. */
  anchor: {
    /** Four ASCII bytes that start the OP_RETURN payload. */
    prefix: string;
    version: number;
    /** The web app refuses to ask a wallet to sign a commitment whose fee is above this. */
    maxFeeSats: number;
    feePerByte: number;
    /** The change output must keep at least this much, or the transaction is refused. */
    dustSats: number;
    /** Fulcrum servers, read only, tried in order. */
    electrum: string[];
    timeoutMs: number;
    /** How many transactions of an address are read when looking for commitments. */
    historyLimit: number;
  };
  /** The one-screen page for judges at /judges. Event ids and keys come from docs/MEASURED.md. */
  judges: {
    repoUrl: string;
    /** The demo identity the page looks up on the relays when it opens. */
    sample: { name: string; npub: string; address: string };
    /** A binding whose BCH signature came from a Paytaca wallet over WalletConnect. */
    paytaca: { eventId: string; npub: string };
    /** The event that revoked the second demo identity's link. */
    revocation: { eventId: string; npub: string };
    /** CSS width from which the requirement and criteria lists start open; below it they start closed. */
    openFromWidth: string;
  };
}

const NETWORKS: readonly Network[] = ['bitcoincash', 'bchtest'];

function fail(path: string, why: string): never {
  throw new Error(`config ${path}: ${why}`);
}

function positiveInt(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) fail(path, 'must be a positive integer');
  return value;
}

function nonEmptyStrings(value: unknown, path: string, test?: (s: string) => boolean): string[] {
  if (!Array.isArray(value) || value.length === 0) fail(path, 'must be a non-empty list');
  for (const item of value) {
    if (typeof item !== 'string' || item === '' || (test && !test(item))) fail(path, `invalid entry ${JSON.stringify(item)}`);
  }
  return value as string[];
}

const NPUB = /^npub1[02-9ac-hj-np-z]{58}$/;
const EVENT_ID = /^[0-9a-f]{64}$/;

function parseAnchor(a: TambatConfig['anchor']): void {
  if (typeof a?.prefix !== 'string' || !/^[\x21-\x7e]{4}$/.test(a.prefix)) fail('anchor.prefix', 'must be 4 printable ASCII characters');
  positiveInt(a.version, 'anchor.version');
  if (a.version > 255) fail('anchor.version', 'must fit in one byte');
  positiveInt(a.maxFeeSats, 'anchor.maxFeeSats');
  positiveInt(a.feePerByte, 'anchor.feePerByte');
  positiveInt(a.dustSats, 'anchor.dustSats');
  nonEmptyStrings(a.electrum, 'anchor.electrum', (s) => /^wss?:\/\/[^\s/:]+(:\d+)?\/?$/.test(s));
  positiveInt(a.timeoutMs, 'anchor.timeoutMs');
  positiveInt(a.historyLimit, 'anchor.historyLimit');
}

function parseJudges(j: TambatConfig['judges']): void {
  if (!/^https:\/\/\S+$/.test(j?.repoUrl ?? '')) fail('judges.repoUrl', 'must be an https URL');
  if (!/^[a-z0-9._-]+@[a-z0-9.-]+$/.test(j.sample?.name ?? '')) fail('judges.sample.name', 'must be a NIP-05 name');
  if (!/^bitcoincash:q[02-9ac-hj-np-z]{41}$/.test(j.sample.address ?? '')) fail('judges.sample.address', 'must be a P2PKH CashAddr');
  for (const [path, value] of [['sample.npub', j.sample.npub], ['paytaca.npub', j.paytaca?.npub], ['revocation.npub', j.revocation?.npub]]) {
    if (!NPUB.test(value ?? '')) fail(`judges.${path}`, 'must be an npub');
  }
  if (!EVENT_ID.test(j.paytaca.eventId ?? '')) fail('judges.paytaca.eventId', 'must be a 64-character hex event id');
  if (!EVENT_ID.test(j.revocation.eventId ?? '')) fail('judges.revocation.eventId', 'must be a 64-character hex event id');
  if (!/^\d+(\.\d+)?(rem|px|em)$/.test(j.openFromWidth ?? '')) fail('judges.openFromWidth', 'must be a CSS length');
}

/** Checks the shape of a config object and returns it typed. Throws with the offending path. */
export function parseConfig(input: unknown): TambatConfig {
  const c = input as TambatConfig;
  if (!c || typeof c !== 'object') fail('', 'must be an object');
  if (!NETWORKS.includes(c.network)) fail('network', `must be one of ${NETWORKS.join(', ')}`);
  positiveInt(c.nostr?.bindingKind, 'nostr.bindingKind');
  positiveInt(c.nostr?.authKind, 'nostr.authKind');
  if (typeof c.nostr.platform !== 'string' || !/^[a-z0-9._/-]+$/.test(c.nostr.platform)) {
    fail('nostr.platform', 'must use a-z, 0-9 and ._-/ only (NIP-39)');
  }
  nonEmptyStrings(c.nostr.relays, 'nostr.relays', (s) => /^wss:\/\/[^\s/]+/.test(s));
  positiveInt(c.nostr.queryTimeoutMs, 'nostr.queryTimeoutMs');
  positiveInt(c.nostr.publishTimeoutMs, 'nostr.publishTimeoutMs');
  if (typeof c.cli?.keysFile !== 'string' || c.cli.keysFile === '') fail('cli.keysFile', 'must be a non-empty string');
  positiveInt(c.cli.addressSearchLimit, 'cli.addressSearchLimit');
  positiveInt(c.nip05?.timeoutMs, 'nip05.timeoutMs');
  if (!c.nip05.names || typeof c.nip05.names !== 'object') fail('nip05.names', 'must be an object');
  for (const [name, key] of Object.entries(c.nip05.names)) {
    if (!/^[a-z0-9._-]+$/.test(name)) fail(`nip05.names.${name}`, 'name must use a-z, 0-9 and ._- only (NIP-05)');
    if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) fail(`nip05.names.${name}`, 'must be a 64-character lowercase hex key');
  }
  positiveInt(c.auth?.challengeTtlSeconds, 'auth.challengeTtlSeconds');
  positiveInt(c.auth.sessionTtlSeconds, 'auth.sessionTtlSeconds');
  positiveInt(c.auth.clockSkewSeconds, 'auth.clockSkewSeconds');
  positiveInt(c.auth.maxPendingChallenges, 'auth.maxPendingChallenges');
  positiveInt(c.auth.maxSessions, 'auth.maxSessions');
  if (typeof c.auth.cookieName !== 'string' || !/^[A-Za-z0-9_]+$/.test(c.auth.cookieName)) {
    fail('auth.cookieName', 'must use A-Z, a-z, 0-9 and _ only');
  }
  nonEmptyStrings(c.auth.allowedOrigins, 'auth.allowedOrigins', (s) => /^https?:\/\/[^\s/]+$/.test(s));
  if (typeof c.walletConnect?.projectId !== 'string') fail('walletConnect.projectId', 'must be a string');
  for (const n of NETWORKS) {
    if (typeof c.walletConnect.chains?.[n] !== 'string') fail(`walletConnect.chains.${n}`, 'must be a string');
  }
  nonEmptyStrings(c.walletConnect.methods, 'walletConnect.methods');
  for (const n of NETWORKS) {
    if (!/^bip122:[0-9a-f]{32}$/.test(c.did?.chains?.[n] ?? '')) fail(`did.chains.${n}`, 'must be a CAIP-2 bip122 chain id');
  }
  if (typeof c.server?.host !== 'string' || c.server.host === '') fail('server.host', 'must be a non-empty string');
  positiveInt(c.server.port, 'server.port');
  positiveInt(c.server.bodyLimitBytes, 'server.bodyLimitBytes');
  if (typeof c.server.staticDir !== 'string') fail('server.staticDir', 'must be a string');
  if (typeof c.server.verifierFile !== 'string' || !c.server.verifierFile.endsWith('.html')) {
    fail('server.verifierFile', 'must be the path of an .html file');
  }
  const csp = c.server.contentSecurityPolicy;
  if (!csp || typeof csp !== 'object' || !csp['default-src']) fail('server.contentSecurityPolicy', 'must be an object with default-src');
  for (const [name, sources] of Object.entries(csp)) {
    if (!/^[a-z-]+$/.test(name)) fail(`server.contentSecurityPolicy.${name}`, 'invalid directive name');
    nonEmptyStrings(sources, `server.contentSecurityPolicy.${name}`, (s) => !/[\s;,]/.test(s));
  }
  if (!c.site?.languages?.includes(c.site.defaultLanguage)) fail('site.defaultLanguage', 'must be one of site.languages');
  for (const k of ['deckUrl', 'repoUrl', 'contactAddress'] as const) {
    if (typeof c.banner?.[k] !== 'string') fail(`banner.${k}`, 'must be a string (empty hides it)');
  }
  if (typeof c.embed?.page !== 'string' || !c.embed.page.endsWith('.html')) fail('embed.page', 'must be the path of an .html file');
  positiveInt(c.embed.width, 'embed.width');
  positiveInt(c.embed.height, 'embed.height');
  nonEmptyStrings(c.embed.frameAncestors, 'embed.frameAncestors', (s) => !/[\s;,]/.test(s) && s !== "'none'");
  positiveInt(c.wall?.limit, 'wall.limit');
  if (typeof c.nostr?.recoveryTag !== 'string' || !/^[a-z_]{2,}$/.test(c.nostr.recoveryTag)) fail('nostr.recoveryTag', 'must be a lower-case tag name of two or more letters');
  if (typeof c.nostr.recoveryText !== 'string' || !c.nostr.recoveryText.includes('{npub}')) fail('nostr.recoveryText', 'must contain {npub}');
  parseAnchor(c.anchor);
  parseJudges(c.judges);
  return c;
}

export const config: TambatConfig = parseConfig(raw);

/** The Content-Security-Policy header value built from a directive map. */
export function cspHeader(directives: Record<string, string[]> = config.server.contentSecurityPolicy): string {
  return Object.entries(directives).map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}
