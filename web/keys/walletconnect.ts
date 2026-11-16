/**
 * WalletConnect v2 with the BCH namespace (wc2-bch-bcr) as Paytaca implements it: the session account is
 * `bch:<cashaddr>` and `bch_signMessage` takes `{ message }` and returns a base64 signed message. The client
 * library loads only when the user picks this option.
 */
import { config } from '../../src/config';
import type { BchSigner } from './bch';

export const walletConnectAvailable = (): boolean => config.walletConnect.projectId.trim() !== '';

export interface PendingConnection {
  uri: string;
  approved: Promise<BchSigner>;
}

export async function connectWallet(appName: string, description: string): Promise<PendingConnection> {
  const { SignClient } = await import('@walletconnect/sign-client');
  const client = await SignClient.init({
    projectId: config.walletConnect.projectId,
    metadata: { name: appName, description, url: window.location.origin, icons: [] },
  });
  const chain = config.walletConnect.chains[config.network];
  const { uri, approval } = await client.connect({
    requiredNamespaces: { bch: { chains: [chain], methods: config.walletConnect.methods, events: [] } },
  });
  if (!uri) throw new Error('WalletConnect gave no pairing link');
  const approved = approval().then((session): BchSigner => {
    const account = session.namespaces.bch?.accounts[0] ?? '';
    const address = account.replace(/^bch:/, '');
    if (!address.startsWith(`${config.network}:`)) throw new Error(`wallet offered ${account || 'no account'} on another network`);
    return {
      kind: 'walletconnect',
      address,
      signMessage: async (message) => {
        const result: unknown = await client.request({
          topic: session.topic,
          chainId: chain,
          request: { method: 'bch_signMessage', params: { message } },
        });
        if (typeof result !== 'string') throw new Error('wallet returned no signature');
        return result;
      },
    };
  });
  return { uri, approved };
}
