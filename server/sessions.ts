/** In-memory sessions for the demo relying app. A restart signs everyone out, which is fine for a demo. */
import { config } from '../src/config.js';
import { nowSeconds, randomToken } from '../src/core/auth.js';

export interface Session {
  /** How the user proved control: a Nostr event, or a BCH signature resolved to a Nostr key through a binding. */
  method: 'nostr' | 'bch';
  pubkey: string;
  npub: string;
  /** BCH address from the user's newest binding, verified by this server on relays; null when none verified. */
  address: string | null;
  /** True when the user also signed the challenge with the key of that address. */
  bchSigned: boolean;
  /** Unix seconds. */
  expiresAt: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly ttlSeconds = config.auth.sessionTtlSeconds,
    private readonly max = config.auth.maxSessions,
  ) {}

  create(data: Omit<Session, 'expiresAt'>, now = nowSeconds()): { id: string; session: Session } {
    for (const [id, s] of this.sessions) if (s.expiresAt <= now) this.sessions.delete(id);
    while (this.sessions.size >= this.max) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
    const session = { ...data, expiresAt: now + this.ttlSeconds };
    const id = randomToken();
    this.sessions.set(id, session);
    return { id, session };
  }

  get(id: string | undefined, now = nowSeconds()): Session | undefined {
    if (!id) return undefined;
    const s = this.sessions.get(id);
    if (s && s.expiresAt <= now) {
      this.sessions.delete(id);
      return undefined;
    }
    return s;
  }

  delete(id: string | undefined): void {
    if (id) this.sessions.delete(id);
  }
}
