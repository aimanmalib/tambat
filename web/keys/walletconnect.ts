/**
 * WalletConnect v2 with the BCH namespace (wc2-bch-bcr) as Paytaca implements it: the session account is
 * `bch:<cashaddr>` and `bch_signMessage` takes `{ message }` and returns a base64 signed message. The client
 * library loads only when the user picks this option.
 */
import { config } from '../../src/config.js';
import { TextError } from '../../src/errors.js';
import type { BchSigner } from './bch.js';

export const walletConnectAvailable = (): boolean => config.walletConnect.projectId.trim() !== '';

export interface PendingConnection {
  uri: string;
  approved: Promise<BchSigner>;
}

type SignClientClass = (typeof import('@walletconnect/sign-client'))['SignClient'];

/**
 * The WalletConnect client class. End-to-end tests replace it at this library boundary with a fake wallet that
 * answers exactly as Paytaca does (`window.__tambatSignClient`), because the WalletConnect relay network is not
 * reachable from a test run; everything after this point is the same code the real wallet talks to.
 */
async function loadSignClient(): Promise<SignClientClass> {
  const replacement = (window as { __tambatSignClient?: SignClientClass }).__tambatSignClient;
  return replacement ?? (await import('@walletconnect/sign-client')).SignClient;
}

/** The session events of the client this file uses (the SignClient is an EventEmitter of these). */
interface SessionEvents {
  on(event: 'session_delete' | 'session_expire', listener: (e: { topic: string }) => void): unknown;
}

/**
 * The end of one approved session: the wallet deletes it (Disconnect in the wallet) or it expires. Listeners are
 * called once; a request still waiting rejects with `bch.wcEnded` instead of leaving the page waiting.
 */
export function sessionEnd(client: SessionEvents, topic: string) {
  const listeners: (() => void)[] = [];
  const waiting = new Set<(e: Error) => void>();
  let ended = false;
  const end = (e: { topic: string }) => {
    if (ended || e.topic !== topic) return;
    ended = true;
    for (const reject of waiting) reject(new TextError('bch.wcEnded'));
    waiting.clear();
    for (const l of listeners) l();
  };
  client.on('session_delete', end);
  client.on('session_expire', end);
  return {
    onEnd: (listener: () => void) => void listeners.push(listener),
    guard<T>(work: Promise<T>): Promise<T> {
      if (ended) return Promise.reject(new TextError('bch.wcEnded'));
      return new Promise<T>((resolve, reject) => {
        waiting.add(reject);
        work.then(resolve, reject).finally(() => waiting.delete(reject));
      });
    },
  };
}

/** The rejection of a request whose session the wallet ended (the page shows `bch.wcEnded` once, from KeysContext). */
export const isSessionEnd = (e: unknown): boolean => e instanceof TextError && e.key === 'bch.wcEnded';

export async function connectWallet(appName: string, description: string): Promise<PendingConnection> {
  const SignClient = await loadSignClient();
  const client = await SignClient.init({
    projectId: config.walletConnect.projectId,
    metadata: { name: appName, description, url: window.location.origin, icons: [] },
  });
  const chain = config.walletConnect.chains[config.network];
  const { uri, approval } = await client.connect({
    requiredNamespaces: { bch: { chains: [chain], methods: config.walletConnect.methods, events: [] } },
  });
  if (!uri) throw new TextError('errors.noPairing');
  const approved = approval().then((session): BchSigner => {
    const account = session.namespaces.bch?.accounts[0] ?? '';
    const address = account.replace(/^bch:/, '');
    if (!account) throw new TextError('errors.noAccount');
    if (!address.startsWith(`${config.network}:`)) throw new TextError('errors.wrongNetwork', { account });
    const ended = sessionEnd(client, session.topic);
    const request = (method: string, params: unknown): Promise<unknown> =>
      ended.guard(client.request({ topic: session.topic, chainId: chain, request: { method, params } }));
    return {
      kind: 'walletconnect',
      address,
      request,
      onEnd: ended.onEnd,
      signMessage: async (message) => {
        const result = await request('bch_signMessage', { message });
        if (typeof result !== 'string') throw new TextError('errors.noSignature');
        return result;
      },
    };
  });
  return { uri, approved };
}
