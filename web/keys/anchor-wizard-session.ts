/**
 * A WizardConnect session for the on-chain binding proof (anchor-wizard.ts). The WizardConnect libraries
 * (LGPL-3.0-or-later) are loaded unmodified, on demand, as their own script file (vite.config.ts), so the rest of the
 * app does not include them (docs/decisions/0023-wizardconnect-transaction-proof.md). The session is not stored: no
 * key of any kind is written to the browser's storage.
 */
import { config } from '../../src/config';
import { TextError } from '../../src/errors';
import type { ProofWallet, WalletPath } from './anchor-wizard';

export interface WizardSession {
  /** The `wiz://` link for the QR code and for copying into a wallet on the same phone. */
  uri: string;
  /** Resolves when the wallet has connected and shared its public keys. */
  ready: Promise<{ wallet: ProofWallet; name: string }>;
  close(): void;
}

/** Child numbers of the well-known paths (hdwalletv1: receive 0, change 1). */
const CHILD: Record<WalletPath, number> = { receive: 0, change: 1 };

export async function openWizardSession(dappName: string): Promise<WizardSession> {
  const [core, dapp] = await Promise.all([import('@wizardconnect/core'), import('@wizardconnect/dapp')]);
  const manager = new dapp.DappConnectionManager(dappName, undefined, { session: false });
  const relay = core.initiateDappRelay((p) => manager.updateConnection(p.client, p.status), {
    explicitRelayUrls: [config.wizardConnect.relay],
  });
  manager.attachRelay(relay);

  const wallet: ProofWallet = {
    publicKey: (path, index) => manager.getPubkey(CHILD[path], BigInt(index)),
    sign: async (request, inputPaths) => {
      // The library's types come from a newer libauth; the values are the same plain objects.
      const transaction = { ...request, broadcast: false } as unknown as Parameters<typeof manager.signTransaction>[0]['transaction'];
      const reply = await manager.signTransaction({ transaction, inputPaths });
      return reply.signedTransaction;
    },
  };

  const ready = new Promise<{ wallet: ProofWallet; name: string }>((resolve, reject) => {
    manager.on('walletready', () => resolve({ wallet, name: manager.walletName ?? '' }));
    manager.on('disconnect', () => reject(new TextError('wizard.disconnected')));
  });
  // A rejection nobody waits for (the page closed the session first) is not an error.
  ready.catch(() => undefined);

  return {
    uri: relay.uri,
    ready,
    close: () => {
      void manager.destroy().finally(() => relay.cleanup());
    },
  };
}
