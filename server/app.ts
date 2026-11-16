/**
 * The relying app server: issues sign-in challenges, verifies answers locally, looks up the user's binding on
 * relays itself (never trusting the browser for it), and serves DID documents and the built web app.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { config, cspHeader } from '../src/config.js';
import { bchAnswerValid, ChallengeStore, LOGIN_METHOD, LOGIN_PATH, bchChallengeText, loginUrl, nowSeconds, verifyLogin } from '../src/core/auth.js';
import { didDocument } from '../src/core/did.js';
import { lookupByPubkey, type QueryFn } from '../src/core/discover.js';
import { parsePubkey, toNpub } from '../src/core/nostr.js';
import { nodeRelayQuery } from '../src/node/relay.js';
import { SessionStore, type Session } from './sessions.js';

export interface AppOptions {
  /** Relay query; defaults to the Node relay query (the `ws` package). Tests pass an in-process fake. */
  query?: QueryFn;
  relays?: string[];
  /** Relay query timeout; defaults to config nostr.queryTimeoutMs. */
  timeoutMs?: number;
  now?: () => number;
  allowedOrigins?: string[];
  /** Directory with the built web app; skipped when it does not exist. */
  staticDir?: string;
  logger?: boolean;
}

interface LoginBody {
  event?: unknown;
  bchSignature?: unknown;
}

export function buildApp(options: AppOptions = {}): FastifyInstance {
  const now = options.now ?? nowSeconds;
  const allowed = options.allowedOrigins ?? config.auth.allowedOrigins;
  const challenges = new ChallengeStore();
  const sessions = new SessionStore();
  const lookupOptions = {
    query: options.query ?? nodeRelayQuery,
    ...(options.relays ? { relays: options.relays } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  };
  const csp = cspHeader();
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: config.server.bodyLimitBytes });
  void app.register(cookie);

  app.addHook('onSend', async (req, reply, payload) => {
    const type = String(reply.getHeader('content-type') ?? '');
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
    else if (type.startsWith('text/html')) {
      reply.header('cache-control', 'no-cache, no-transform');
      reply.header('content-security-policy', csp);
    }
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'strict-origin-when-cross-origin');
    return payload;
  });

  /** Origin of a state-changing request, or null after replying 403. */
  function allowedOrigin(req: FastifyRequest, reply: FastifyReply): string | null {
    const origin = req.headers.origin;
    if (typeof origin === 'string' && allowed.includes(origin)) return origin;
    void reply.code(403).send({ error: 'origin', reason: 'request origin is not allowed' });
    return null;
  }

  const sessionView = (s: Session) => ({ pubkey: s.pubkey, npub: s.npub, address: s.address, bchSigned: s.bchSigned, expiresAt: s.expiresAt });

  app.get('/healthz', async () => ({ ok: true }));

  app.post('/api/rp/challenge', async (req, reply) => {
    const origin = allowedOrigin(req, reply);
    if (!origin) return reply;
    const c = challenges.issue(origin, now());
    return { nonce: c.nonce, expiresAt: c.expiresAt, url: loginUrl(origin), method: LOGIN_METHOD, bchText: bchChallengeText(c) };
  });

  app.post<{ Body: LoginBody }>(LOGIN_PATH, async (req, reply) => {
    const origin = allowedOrigin(req, reply);
    if (!origin) return reply;
    const check = verifyLogin(req.body?.event, { origin, store: challenges, now: now() });
    if (!check.ok) return reply.code(401).send({ error: check.error, reason: check.reason });
    const binding = await lookupByPubkey(check.pubkey, lookupOptions);
    const address = binding?.ok ? (binding.claims.find((c) => c.ok)?.address ?? null) : null;
    const signature = req.body?.bchSignature;
    let bchSigned = false;
    if (typeof signature === 'string' && signature !== '') {
      const answer = address ? bchAnswerValid(check.challenge, signature, address) : 'no verified BCH address to check against';
      if (answer !== true) return reply.code(401).send({ error: 'bch_sig', reason: answer });
      bchSigned = true;
    }
    const npub = toNpub(check.pubkey);
    const { id, session } = sessions.create({ pubkey: check.pubkey, npub, address, bchSigned }, now());
    void reply.setCookie(config.auth.cookieName, id, {
      httpOnly: true,
      sameSite: 'strict',
      secure: origin.startsWith('https://'),
      path: '/api/rp',
      maxAge: config.auth.sessionTtlSeconds,
    });
    return { session: sessionView(session), binding };
  });

  app.get('/api/rp/session', async (req, reply) => {
    const s = sessions.get(req.cookies[config.auth.cookieName], now());
    if (!s) return reply.code(401).send({ error: 'no_session', reason: 'not signed in' });
    return { session: sessionView(s) };
  });

  app.post('/api/rp/logout', async (req, reply) => {
    if (!allowedOrigin(req, reply)) return reply;
    sessions.delete(req.cookies[config.auth.cookieName]);
    void reply.clearCookie(config.auth.cookieName, { path: '/api/rp' });
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>('/api/did/:id', async (req, reply) => {
    const key = parsePubkey(req.params.id.replace(/^did:nostr:/, ''));
    if ('error' in key) return reply.code(400).send({ error: 'pubkey', reason: key.error });
    const binding = await lookupByPubkey(key.hex, lookupOptions);
    return reply.type('application/did+json').send(didDocument(key.hex, binding, options.relays ? { relays: options.relays } : {}));
  });

  const root = resolve(options.staticDir ?? config.server.staticDir);
  if (existsSync(root)) {
    void app.register(fastifyStatic, { root, index: ['index.html'] });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not_found' });
    });
  }
  return app;
}
