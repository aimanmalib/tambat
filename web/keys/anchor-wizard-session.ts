/**
 * A WizardConnect session for the on-chain binding proof (anchor-wizard.ts). The WizardConnect libraries
 * (LGPL-3.0-or-later) are loaded unmodified, on demand, as their own script file (vite.config.ts), so the rest of the
 * app does not include them (docs/decisions/0023-wizardconnect-transaction-proof.md). The session is not stored: no
 * key of any kind is written to the browser's storage.
 */
import { config } from '../../src/config';
import { TextError } from '../../src/errors';
import { wireSignRequest, type ProofWallet, type WalletPath } from './anchor-wizard';
import { watchSession, type SessionEvents } from './wizard-liveness';

export interface WizardSession {
  /** The `wiz://` link for the QR code and for copying into a wallet on the same phone. */
  uri: string;
  /** Resolves when the wallet has connected and shared its public keys. */
  ready: Promise<{ wallet: ProofWallet; name: string }>;
  /**
   * Called once when the wallet ends the session, at any step after pairing, or stays silent past
   * `config.wizardConnect.livenessSeconds` (wizard-liveness.ts). Not called when the page closes the session itself.
   */
  onClose(listener: () => void): void;
  close(): void;
}

/** Child numbers of the well-known paths (hdwalletv1: receive 0, change 1). */
const CHILD: Record<WalletPath, number> = { receive: 0, change: 1 };

/**
 * End-to-end tests replace the session at this library boundary with a fake wallet (`window.__tambatWizardSession`),
 * as walletconnect.ts does, because no wallet answers on a test relay; everything after it is the code a real wallet
 * talks to: the address scan, the plan, the checks of the signed transaction.
 */
export async function openWizardSession(dappName: string): Promise<WizardSession> {
  const replacement = (window as { __tambatWizardSession?: typeof openWizardSession }).__tambatWizardSession;
  if (replacement) return replacement(dappName);
  const [core, dapp] = await Promise.all([import('@wizardconnect/core'), import('@wizardconnect/dapp')]);
  const manager = new dapp.DappConnectionManager(dappName, undefined, { session: false });
  const relay = core.initiateDappRelay((p) => manager.updateConnection(p.client, p.status), {
    explicitRelayUrls: [config.wizardConnect.relay],
  });
  manager.attachRelay(relay);
  const watch = watchSession(manager as unknown as SessionEvents, { graceMs: config.wizardConnect.livenessSeconds * 1000 });

  const wallet: ProofWallet = {
    publicKey: (path, index) => manager.getPubkey(CHILD[path], BigInt(index)),
    sign: async (request, inputPaths) => {
      // The relay JSON-encodes the request: bigint and bytes go as libauth extended JSON (anchor-wizard.ts).
      const transaction = wireSignRequest({ ...request, broadcast: false }) as Parameters<typeof manager.signTransaction>[0]['transaction'];
      // A wallet that leaves while the request waits rejects it at once instead of leaving the page waiting.
      const reply = await watch.guard(manager.signTransaction({ transaction, inputPaths }));
      // Signed: the page needs nothing more from the wallet, so a wallet that leaves now does not undo the proof.
      watch.stop();
      return reply.signedTransaction;
    },
  };

  const ready = new Promise<{ wallet: ProofWallet; name: string }>((resolve, reject) => {
    manager.on('walletready', () => resolve({ wallet, name: manager.walletName ?? '' }));
    watch.onClose(() => reject(new TextError('wizard.disconnected')));
  });
  // A rejection nobody waits for (the page closed the session first) is not an error.
  ready.catch(() => undefined);

  return {
    uri: relay.uri,
    ready,
    onClose: (listener) => watch.onClose(listener),
    close: () => {
      watch.stop();
      void manager.destroy().finally(() => relay.cleanup());
    },
  };
}
