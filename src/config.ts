/** Typed access to config/tambat.json. Every value that may change lives in that file; code reads it. */
import raw from '../config/tambat.json' with { type: 'json' };

export type Network = 'bitcoincash' | 'bchtest';

export interface TambatConfig {
  network: Network;
  nostr: {
    bindingKind: number;
    authKind: number;
    platform: string;
    /**
     * How a new claim names its address. `bare` writes `bch:q…` (the CashAddr without its prefix) on mainnet, the form other
     * NIP-39 verifiers read; `prefixed` writes `bch:bitcoincash:q…`. A test network keeps its prefix either way.
     */
    claimForm: 'bare' | 'prefixed';
    /** Other platform names read as a BCH claim (`["i", "bitcoincash:q…", …]`). Never written. */
    platformAliases: string[];
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
    /** Wallet error codes by name; `errors.wallet.<name>` in lang/ is the text shown for any code in the list. */
    errorCodes: Record<string, number[]>;
    /** The longest raw detail of an unknown wallet error shown inside the generic error sentence. */
    errorDetailMaxChars: number;
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
    /** Full SHA of the repository's root commit; with note on, the banner links <repoUrl>/commit/<firstCommit>. */
    firstCommit: string;
    /** Show the "new project" note with the first commit link (app only; the library never reads it). */
    note: boolean;
  };
  /**
   * The demo video hosted with the site: paths under the site root and its length, shown next to the links to it. `?v=`
   * is the first 8 hex digits of the file's SHA-256, so a CDN never serves an older copy under the same URL.
   */
  video: {
    url: string;
    posterUrl: string;
    seconds: number;
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
    /** How many verified BCH bindings the wall shows at most. */
    limit: number;
    /** Identity events asked of each relay per page; the wall pages back with `until` until it finds `limit`. */
    pageSize: number;
    /** Pages asked of each relay at most, so a relay full of other platforms cannot keep the wall loading. */
    maxPages: number;
    /** Chain reads for "anchored since" badges running at once; only entries on screen are read. */
    chainConcurrency: number;
    /**
     * Seconds between checks of the wall while the page is visible (5 to 120). Read by the web page only, so the packed
     * library does not carry it.
     */
    refreshSeconds: number;
    /**
     * How far beyond the screen an entry counts as on screen for its chain read (IntersectionObserver `rootMargin`), so
     * entries just below the fold already carry their badge when scrolled to. Pixels or percent of the screen, 1 to 4 values.
     */
    sinceRootMargin: string;
  };
  /** Optional BCH anchor (docs/SPEC.md "Optional BCH anchor"). The server never signs or sends a transaction. */
  anchor: {
    /** Four ASCII bytes that start the OP_RETURN payload. */
    prefix: string;
    /** Type byte of a commitment (bind). */
    version: number;
    /** Type byte of a revocation: the address withdraws the key it names (docs/decisions/0013-revoke-by-transaction.md). */
    revokeVersion: number;
    /** The web app refuses to ask a wallet to sign a commitment whose fee is above this. */
    maxFeeSats: number;
    feePerByte: number;
    /** The change output must keep at least this much, or the transaction is refused. */
    dustSats: number;
    /** Fulcrum servers, read only. Commitments are read from all of them; other reads use the first that answers. */
    electrum: string[];
    /** How many servers must answer alike before a commitment read counts; any server that answers differently makes it unknown. */
    quorum: number;
    timeoutMs: number;
    /** How many transactions of an address are read when looking for commitments. */
    historyLimit: number;
    /** Spend only coins already in a block; when only unconfirmed coins would pay, the page says to wait. */
    confirmedCoinsOnly: boolean;
    /**
     * Spending limit of the project's own demo key (scripts/anchor-demo.ts): at most this many commitments and this many
     * sat in fees over the project, recorded in `ledger` (never tracked) before each one is sent.
     */
    demoBudget: { maxTransactions: number; maxTotalFeeSats: number; ledger: string };
    /** Block explorer page of a transaction; `{txid}` is replaced with the full transaction id. */
    explorerTx: string;
  };
  /**
   * Payment receipts (docs/SPEC.md "Payment receipts"): a NIP-32 label event naming the paid key and, as a NIP-73
   * `i` tag, the BCH transaction. Read and checked against the chain; the server never touches them.
   */
  receipt: {
    kind: number;
    /** NIP-32 namespace (`L` tag) and label value (`l` tag) of a receipt. */
    namespace: string;
    label: string;
    /** A transaction with more inputs than this is not read input by input; its payer stays not proven. */
    inputLimit: number;
  };
  /**
   * Attestations (docs/SPEC.md "Attestations"): a NIP-32 label event by which one key vouches for another key's
   * binding, pinned by event id. It drops as soon as that binding is replaced.
   */
  attest: {
    kind: number;
    /** NIP-32 namespace (`L` tag) and label value (`l` tag) of an attestation. */
    namespace: string;
    label: string;
  };
  /**
   * Attestations exported as W3C Verifiable Credentials 2.0 (ADR 0017): the credential type after
   * "VerifiableCredential", the proof type that embeds the signed Nostr events, and the download file name prefix.
   */
  vc: {
    type: string;
    proofType: string;
    filePrefix: string;
    /** The presentation type after "VerifiablePresentation" of a portable reputation summary (docs/SPEC.md). */
    presentationType: string;
    /** Download file name prefix of a reputation summary. */
    reputationFilePrefix: string;
  };
  /**
   * Selective disclosure (ADR 0019): a self-issued credential whose fields are salted digests. The proof is an
   * unpublished NIP-32 label event (`kind`, `namespace`, `label`) signed by the holder. `fields` are the binding facts
   * it carries, in order; `saltBytes` is the random salt length of each disclosure.
   */
  sd: {
    kind: number;
    namespace: string;
    label: string;
    credentialType: string;
    presentationType: string;
    fields: string[];
    saltBytes: number;
    filePrefix: string;
  };
  /** The one-screen page for judges at /judges. Event ids and keys come from docs/MEASURED.md. */
  judges: {
    repoUrl: string;
    /** The demo identity the page looks up on the relays when it opens. */
    sample: { name: string; npub: string; address: string };
    /** A binding whose BCH signature came from a Paytaca wallet over WalletConnect. */
    paytaca: { eventId: string; npub: string };
    /** The Paytaca binding's BCH commitment, copied from `tambat anchor-lookup` and docs/MEASURED.md "## Anchor". */
    anchor: { address: string; txid: string; block: number; eventId: string };
    /** The event that revoked the second demo identity's link. */
    revocation: { eventId: string; npub: string };
    /** CSS width from which the requirement and criteria lists start open; below it they start closed. */
    openFromWidth: string;
    /**
     * Interoperability counts written by the measuring tool, never by hand (docs/MEASURED.md "## Interoperability"): how
     * many of the independent NIP-39 verifiers checked verify a binding written by Tambat, and how many third-party
     * bindings on the relays Tambat verifies.
     */
    interop: { verifiedBy: number; verifiers: number; verifiesTheirs: number; theirs: number; measuredAt: string };
  };
  /**
   * The first card of the home page: a real binding, fetched from the relays and checked in the browser step by step.
   * `candidates` in order of preference (src/core/hero-check.ts pickHeroCandidate); `signer` is a key of the lang text
   * hero.signedBy. `timeoutMs` bounds each step that waits on the network (relays, chain servers).
   */
  hero: { candidates: { npub: string; signer: string }[]; timeoutMs: number };
  /**
   * The second wallet option on Link (docs/decisions/0023-wizardconnect-transaction-proof.md): the wallet signs a small
   * transaction whose OP_RETURN is the NIP-39 text. `relay` carries the encrypted session messages. `scan` walks each key
   * path of the wallet until `gapLimit` unused addresses in a row (BIP44 practice), looking at no more than
   * `maxAddresses` on one path (web/keys/wallet-scan.ts). `acceptUnconfirmed` lets the proof spend coins not yet in a
   * block (the demo key's own anchor keeps anchor.confirmedCoinsOnly). `livenessSeconds` is how long the page waits for
   * the wallet once the library reports its relay link as reconnecting (the library says "disconnect" only when the
   * wallet sends one; a wallet that goes silent is reported as reconnecting) before it ends the session
   * (web/keys/wizard-liveness.ts). The library's source and licence are linked.
   */
  wizardConnect: {
    enabled: boolean;
    relay: string;
    scan: { gapLimit: number; maxAddresses: number };
    acceptUnconfirmed: boolean;
    livenessSeconds: number;
    sourceUrl: string;
    licenseUrl: string;
  };
}

const NETWORKS: readonly Network[] = ['bitcoincash', 'bchtest'];

function fail(path: string, why: string): never {
  throw new Error(`config ${path}: ${why}`);
}

/** An IntersectionObserver `rootMargin`: 1 to 4 lengths, each in px or %. Browsers throw on anything else. */
export function isRootMargin(value: unknown): value is string {
  return typeof value === 'string' && /^-?\d+(\.\d+)?(px|%)( -?\d+(\.\d+)?(px|%)){0,3}$/.test(value);
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
  positiveInt(a.revokeVersion, 'anchor.revokeVersion');
  if (a.revokeVersion > 255 || a.revokeVersion === a.version) fail('anchor.revokeVersion', 'must fit in one byte and differ from anchor.version');
  positiveInt(a.maxFeeSats, 'anchor.maxFeeSats');
  positiveInt(a.feePerByte, 'anchor.feePerByte');
  positiveInt(a.dustSats, 'anchor.dustSats');
  nonEmptyStrings(a.electrum, 'anchor.electrum', (s) => /^wss?:\/\/[^\s/:]+(:\d+)?\/?$/.test(s));
  positiveInt(a.quorum, 'anchor.quorum');
  if (a.quorum > a.electrum.length) fail('anchor.quorum', 'cannot be more than the number of anchor.electrum servers');
  positiveInt(a.timeoutMs, 'anchor.timeoutMs');
  positiveInt(a.historyLimit, 'anchor.historyLimit');
  if (typeof a.confirmedCoinsOnly !== 'boolean') fail('anchor.confirmedCoinsOnly', 'must be true or false');
  if (!/^https:\/\/[^\s{}]+\{txid\}[^\s{}]*$/.test(a.explorerTx ?? '')) fail('anchor.explorerTx', 'must be an https URL with one {txid}');
}

/** NIP-32 label event kind. Receipts and attestations reuse it; Tambat defines no new kinds. */
export const NIP32_LABEL_KIND = 1985;

function labelKind(kind: number, path: string): void {
  if (kind !== NIP32_LABEL_KIND) fail(path, `must be ${NIP32_LABEL_KIND} (NIP-32 label)`);
}

function parseReceipt(r: TambatConfig['receipt']): void {
  positiveInt(r?.kind, 'receipt.kind');
  labelKind(r.kind, 'receipt.kind');
  if (typeof r.namespace !== 'string' || !/^[a-z0-9.-]+$/.test(r.namespace)) fail('receipt.namespace', 'must use a-z, 0-9 and .- only');
  if (typeof r.label !== 'string' || !/^[a-z0-9_-]+$/.test(r.label)) fail('receipt.label', 'must use a-z, 0-9 and _- only');
  positiveInt(r.inputLimit, 'receipt.inputLimit');
}

function parseAttest(a: TambatConfig['attest'], receipt: TambatConfig['receipt']): void {
  positiveInt(a?.kind, 'attest.kind');
  labelKind(a.kind, 'attest.kind');
  if (typeof a.namespace !== 'string' || !/^[a-z0-9.-]+$/.test(a.namespace)) fail('attest.namespace', 'must use a-z, 0-9 and .- only');
  if (a.namespace === receipt.namespace) fail('attest.namespace', 'must differ from receipt.namespace');
  if (typeof a.label !== 'string' || !/^[a-z0-9_-]+$/.test(a.label)) fail('attest.label', 'must use a-z, 0-9 and _- only');
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
  if (!/^bitcoincash:[qp][02-9ac-hj-np-z]{41}$/.test(j.anchor?.address ?? '')) fail('judges.anchor.address', 'must be a CashAddr');
  if (!EVENT_ID.test(j.anchor.txid ?? '')) fail('judges.anchor.txid', 'must be a 64-character hex transaction id');
  positiveInt(j.anchor.block, 'judges.anchor.block');
  if (!EVENT_ID.test(j.anchor.eventId ?? '')) fail('judges.anchor.eventId', 'must be a 64-character hex event id');
  if (!/^\d+(\.\d+)?(rem|px|em)$/.test(j.openFromWidth ?? '')) fail('judges.openFromWidth', 'must be a CSS length');
  const i = j.interop;
  for (const k of ['verifiedBy', 'verifiers', 'verifiesTheirs', 'theirs'] as const) {
    if (!Number.isInteger(i?.[k]) || i[k] < 0) fail(`judges.interop.${k}`, 'must be a whole number, 0 or more');
  }
  if (i.verifiedBy > i.verifiers) fail('judges.interop.verifiedBy', 'must not exceed verifiers');
  if (i.verifiesTheirs > i.theirs) fail('judges.interop.verifiesTheirs', 'must not exceed theirs');
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(i.measuredAt ?? '')) fail('judges.interop.measuredAt', 'must be a UTC time like 2026-11-20T15:00:00Z');
}

function parseHero(h: TambatConfig['hero']): void {
  if (!Array.isArray(h?.candidates) || h.candidates.length === 0) fail('hero.candidates', 'must be a non-empty list');
  h.candidates.forEach((c, n) => {
    if (!NPUB.test(c?.npub ?? '')) fail(`hero.candidates.${n}.npub`, 'must be an npub');
    if (!/^[a-z][a-zA-Z]*$/.test(c.signer ?? '')) fail(`hero.candidates.${n}.signer`, 'must be a lang key under hero.signedBy');
  });
  if (new Set(h.candidates.map((c) => c.npub)).size !== h.candidates.length) fail('hero.candidates', 'must not repeat an npub');
  positiveInt(h.timeoutMs, 'hero.timeoutMs');
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
  if (c.nostr.claimForm !== 'bare' && c.nostr.claimForm !== 'prefixed') fail('nostr.claimForm', 'must be "bare" or "prefixed"');
  const aliases: unknown = c.nostr.platformAliases;
  if (!Array.isArray(aliases) || aliases.some((a) => typeof a !== 'string' || !/^[a-z0-9._/-]+$/.test(a) || a === c.nostr.platform)) {
    fail('nostr.platformAliases', 'must be a list of NIP-39 platform names other than nostr.platform');
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
  parseWalletErrorCodes(c.walletConnect.errorCodes);
  positiveInt(c.walletConnect.errorDetailMaxChars, 'walletConnect.errorDetailMaxChars');
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
  if (typeof c.banner.note !== 'boolean') fail('banner.note', 'must be true or false');
  if (c.banner.note && !/^[0-9a-f]{40}$/.test(c.banner.firstCommit ?? '')) fail('banner.firstCommit', 'must be a full 40 character commit SHA when banner.note is on');
  if (typeof c.video?.url !== 'string' || !/^\/[\w/.-]+\.mp4(\?v=[0-9a-f]{8})?$/.test(c.video.url)) fail('video.url', 'must be a site path ending in .mp4, with an optional ?v=<8 hex> version');
  if (typeof c.video.posterUrl !== 'string' || !/^\/[\w/.-]+\.(jpg|png)(\?v=[0-9a-f]{8})?$/.test(c.video.posterUrl)) fail('video.posterUrl', 'must be a site path ending in .jpg or .png, with an optional ?v=<8 hex> version');
  positiveInt(c.video.seconds, 'video.seconds');
  if (typeof c.embed?.page !== 'string' || !c.embed.page.endsWith('.html')) fail('embed.page', 'must be the path of an .html file');
  positiveInt(c.embed.width, 'embed.width');
  positiveInt(c.embed.height, 'embed.height');
  nonEmptyStrings(c.embed.frameAncestors, 'embed.frameAncestors', (s) => !/[\s;,]/.test(s) && s !== "'none'");
  positiveInt(c.wall?.limit, 'wall.limit');
  positiveInt(c.wall.pageSize, 'wall.pageSize');
  positiveInt(c.wall.maxPages, 'wall.maxPages');
  positiveInt(c.wall.chainConcurrency, 'wall.chainConcurrency');
  const refresh = c.wall.refreshSeconds;
  if (!Number.isInteger(refresh) || (refresh as number) < 5 || (refresh as number) > 120) fail('wall.refreshSeconds', 'must be a whole number of seconds from 5 to 120');
  if (!isRootMargin(c.wall.sinceRootMargin)) fail('wall.sinceRootMargin', 'must be 1 to 4 lengths in px or %, like "0px 0px 100% 0px"');
  if (typeof c.nostr?.recoveryTag !== 'string' || !/^[a-z_]{2,}$/.test(c.nostr.recoveryTag)) fail('nostr.recoveryTag', 'must be a lower-case tag name of two or more letters');
  if (typeof c.nostr.recoveryText !== 'string' || !c.nostr.recoveryText.includes('{npub}')) fail('nostr.recoveryText', 'must contain {npub}');
  parseAnchor(c.anchor);
  parseReceipt(c.receipt);
  parseAttest(c.attest, c.receipt);
  for (const k of ['type', 'proofType', 'presentationType'] as const) {
    if (typeof c.vc?.[k] !== 'string' || !/^[A-Z][A-Za-z0-9]+$/.test(c.vc[k])) fail(`vc.${k}`, 'must be a PascalCase term');
  }
  for (const k of ['filePrefix', 'reputationFilePrefix'] as const) {
    if (typeof c.vc[k] !== 'string' || !/^[a-z0-9-]+$/.test(c.vc[k])) fail(`vc.${k}`, 'must use a-z, 0-9 and - only');
  }
  parseSd(c.sd, [c.attest.namespace, c.receipt.namespace]);
  parseJudges(c.judges);
  parseHero(c.hero);
  parseWizardConnect(c.wizardConnect);
  return c;
}

function parseWizardConnect(w: TambatConfig['wizardConnect']): void {
  if (typeof w?.enabled !== 'boolean') fail('wizardConnect.enabled', 'must be true or false');
  if (typeof w.relay !== 'string' || !/^wss:\/\/[a-z0-9.-]+(:\d+)?\/?$/.test(w.relay)) fail('wizardConnect.relay', 'must be one wss:// relay URL');
  const scan = w.scan as Record<string, unknown> | undefined;
  for (const k of ['receive', 'change']) {
    if (scan && k in scan) fail(`wizardConnect.scan.${k}`, 'is the old fixed count; use gapLimit and maxAddresses');
  }
  const gap = scan?.gapLimit;
  if (!Number.isInteger(gap) || (gap as number) < 1 || (gap as number) > 100) fail('wizardConnect.scan.gapLimit', 'must be an integer from 1 to 100');
  const max = scan?.maxAddresses;
  if (!Number.isInteger(max) || (max as number) < (gap as number) || (max as number) > 1000) {
    fail('wizardConnect.scan.maxAddresses', 'must be an integer from gapLimit to 1000');
  }
  if (typeof w.acceptUnconfirmed !== 'boolean') fail('wizardConnect.acceptUnconfirmed', 'must be true or false');
  const live = w.livenessSeconds;
  if (!Number.isInteger(live) || live < 5 || live > 600) fail('wizardConnect.livenessSeconds', 'must be an integer from 5 to 600');
  for (const k of ['sourceUrl', 'licenseUrl'] as const) {
    if (typeof w[k] !== 'string' || !w[k].startsWith('https://')) fail(`wizardConnect.${k}`, 'must be an https:// URL');
  }
}

const SD_FIELDS = ['bchAddress', 'network', 'bindingEvent', 'boundAt'];

function parseSd(sd: TambatConfig['sd'], taken: string[]): void {
  positiveInt(sd?.kind, 'sd.kind');
  labelKind(sd.kind, 'sd.kind');
  if (typeof sd.namespace !== 'string' || !/^[a-z0-9.-]+$/.test(sd.namespace)) fail('sd.namespace', 'must use a-z, 0-9 and .- only');
  if (taken.includes(sd.namespace)) fail('sd.namespace', 'must differ from attest.namespace and receipt.namespace');
  if (typeof sd.label !== 'string' || !/^[a-z0-9_-]+$/.test(sd.label)) fail('sd.label', 'must use a-z, 0-9 and _- only');
  for (const k of ['credentialType', 'presentationType'] as const) {
    if (typeof sd[k] !== 'string' || !/^[A-Z][A-Za-z0-9]+$/.test(sd[k])) fail(`sd.${k}`, 'must be a PascalCase term');
  }
  const f = sd.fields;
  if (!Array.isArray(f) || f.length < 3 || new Set(f).size !== f.length || !f.every((x) => SD_FIELDS.includes(x)) || !f.includes('bchAddress')) {
    fail('sd.fields', `must list three or more of ${SD_FIELDS.join(', ')} once each, including bchAddress`);
  }
  positiveInt(sd.saltBytes, 'sd.saltBytes');
  if (sd.saltBytes < 16) fail('sd.saltBytes', 'must be 16 or more (128 bits)');
  if (typeof sd.filePrefix !== 'string' || !/^[a-z0-9-]+$/.test(sd.filePrefix)) fail('sd.filePrefix', 'must use a-z, 0-9 and - only');
}

/** Each name maps to a non-empty list of integer codes, and no code appears under two names. */
function parseWalletErrorCodes(codes: unknown): void {
  if (!codes || typeof codes !== 'object' || Array.isArray(codes)) fail('walletConnect.errorCodes', 'must be an object of name to codes');
  const seen = new Set<number>();
  for (const [name, list] of Object.entries(codes as Record<string, unknown>)) {
    if (!/^[a-zA-Z]+$/.test(name)) fail(`walletConnect.errorCodes.${name}`, 'name must use letters only');
    if (!Array.isArray(list) || list.length === 0) fail(`walletConnect.errorCodes.${name}`, 'must be a non-empty list of integers');
    for (const code of list as unknown[]) {
      if (!Number.isInteger(code)) fail(`walletConnect.errorCodes.${name}`, 'must hold integers only');
      if (seen.has(code as number)) fail(`walletConnect.errorCodes.${name}`, `code ${String(code)} is listed twice`);
      seen.add(code as number);
    }
  }
}

export const config: TambatConfig = parseConfig(raw);

/** A partial config: objects merge key by key, arrays and scalars replace. */
export type ConfigOverrides = { [K in keyof TambatConfig]?: TambatConfig[K] extends unknown[] ? TambatConfig[K] : Partial<TambatConfig[K]> | TambatConfig[K] };

function merge(base: unknown, over: unknown): unknown {
  if (over === undefined) return base;
  const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(base) || !isObject(over)) return structuredClone(over);
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
}

/**
 * Replaces config values for every module that reads `config` (relays, network, kinds, timeouts). The library
 * package starts from the values frozen at build time; a caller passes only what differs. The result is checked
 * by `parseConfig` before anything changes, so a bad override throws and leaves the current config in place.
 */
export function configure(overrides: ConfigOverrides): TambatConfig {
  const next = parseConfig(merge(structuredClone(config), overrides));
  Object.assign(config, next);
  return config;
}

/** The Content-Security-Policy header value built from a directive map. */
export function cspHeader(directives: Record<string, string[]> = config.server.contentSecurityPolicy): string {
  return Object.entries(directives).map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; ');
}
