/**
 * The on-chain binding proof made through a WizardConnect wallet (docs/decisions/0023-wizardconnect-transaction-proof.md).
 * WizardConnect wallets sign transactions, not messages, so the proof is a small transaction from the bound address
 * whose OP_RETURN is the NIP-39 text (the `tx:<txid>` form of src/core/tx-proof.ts). The page finds a coin among the
 * wallet's addresses, builds the transaction without signatures, the wallet signs it, the page checks the signed
 * transaction with the same code every verifier runs, and only then sends it. No key is held here.
 */
import { binToHex, decodeTransaction, hexToBin, stringify, type Input, type Output, type TransactionCommon } from '@bitauth/libauth';
import { config } from '../../src/config.js';
import { opReturnFromCoins, txidOf, type AnchorRefusal, type PreparedAnchor, type Utxo } from '../../src/core/anchor.js';
import { electrumChain, scripthashOf, type ChainSource, type OpenChain } from '../../src/core/anchor-chain.js';
import type { BchClaim } from '../../src/core/binding.js';
import { addressFromPublicKey, parseP2pkhAddress } from '../../src/core/cashaddr.js';
import { checkTxProof, proofOutput, TX_PROOF_PREFIX, type TxEvidence, type TxLookup } from '../../src/core/tx-proof.js';
import { TextError } from '../../src/errors.js';

export type WalletPath = 'receive' | 'change';

/**
 * The sign request in the form the WizardConnect relay can send. The relay calls JSON.stringify, which throws on the
 * bigint values (`valueSatoshis`) and garbles the byte arrays of a libauth transaction. BCH wallet requests carry those
 * in libauth's extended JSON (`<bigint: 1n>`, `<Uint8Array: 0x..>`), which wallets read back (the same form tuai sends).
 */
export const wireSignRequest = (request: unknown): unknown => JSON.parse(stringify(request)) as unknown;

/** What the page needs from a WizardConnect session (wizardconnect.ts adapts the library to this). */
export interface ProofWallet {
  /** The public key of address `index` on `path`, or undefined when the wallet did not share that path. */
  publicKey(path: WalletPath, index: number): Uint8Array | undefined;
  /** Asks the wallet to sign every input; resolves with the signed transaction as hex. The wallet does not send it. */
  sign(
    request: { transaction: TransactionCommon; sourceOutputs: (Input & Output)[]; userPrompt: string },
    inputPaths: [number, WalletPath, number][],
  ): Promise<string>;
}

/** A proof transaction ready for the wallet: the coins of one address and the transactions those coins come from. */
export interface ProofPlan extends PreparedAnchor {
  address: string;
  path: WalletPath;
  index: number;
  sources: Record<string, string>;
}

/** Which refusal to report when no address could pay: the one closest to working. */
const RANK: AnchorRefusal[] = ['unconfirmed', 'fee_high', 'too_little', 'no_coins'];
const REFUSAL: Record<AnchorRefusal, string> = {
  unconfirmed: 'wizard.unconfirmed',
  fee_high: 'wizard.feeHigh',
  too_little: 'wizard.tooLittle',
  no_coins: 'wizard.noCoins',
};

/** The wallet's addresses to search, receive first, up to the counts in config wizardConnect.scan. */
export function walletAddresses(wallet: ProofWallet, scan = config.wizardConnect.scan): { path: WalletPath; index: number; address: string }[] {
  const out: { path: WalletPath; index: number; address: string }[] = [];
  for (const path of ['receive', 'change'] as const) {
    for (let index = 0; index < scan[path]; index++) {
      const key = wallet.publicKey(path, index);
      if (key) out.push({ path, index, address: addressFromPublicKey(key, config.network) });
    }
  }
  return out;
}

async function openOrThrow(open: OpenChain): Promise<ChainSource> {
  try {
    return await open();
  } catch {
    throw new TextError('wizard.unreachable');
  }
}

/**
 * Finds the first address of the wallet whose coins pay for the proof, and builds the transaction: those coins in, the
 * NIP-39 text for `npub` as OP_RETURN, the change back to the same address. Throws a TextError when none can.
 */
export async function planProof(wallet: ProofWallet, npub: string, open: OpenChain = electrumChain()): Promise<ProofPlan> {
  const addresses = walletAddresses(wallet);
  if (addresses.length === 0) throw new TextError('wizard.noAddresses');
  const chain = await openOrThrow(open);
  try {
    const coins = await Promise.all(addresses.map((a) => chain.unspent(scripthashOf(a.address)))).catch(() => {
      throw new TextError('wizard.unreachable');
    });
    const script = proofOutput(npub);
    let refusal: AnchorRefusal = 'no_coins';
    for (const [i, a] of addresses.entries()) {
      const built = opReturnFromCoins(a.address, coins[i] as Utxo[], script);
      if (typeof built === 'string') {
        if (RANK.indexOf(built) < RANK.indexOf(refusal)) refusal = built;
        continue;
      }
      const sources: Record<string, string> = {};
      for (const input of built.sourceOutputs) {
        const id = binToHex(input.outpointTransactionHash);
        sources[id] ??= await chain.transaction(id).catch(() => {
          throw new TextError('wizard.unreachable');
        });
      }
      return { ...built, ...a, sources };
    }
    throw new TextError(REFUSAL[refusal], { max: config.anchor.maxFeeSats });
  } finally {
    await chain.close();
  }
}

/** True when the signed transaction spends exactly the planned coins and pays exactly the planned outputs. */
function sameAsPlanned(signed: TransactionCommon, plan: TransactionCommon): boolean {
  const outpoints = (t: TransactionCommon) => t.inputs.map((i) => `${binToHex(i.outpointTransactionHash)}:${i.outpointIndex}`).join(',');
  const outputs = (t: TransactionCommon) => t.outputs.map((o) => `${binToHex(o.lockingBytecode)}=${o.valueSatoshis}`).join(',');
  return outpoints(signed) === outpoints(plan) && outputs(signed) === outputs(plan);
}

/** Errors a chain server gives when the transaction is already known to it, for example sent by the wallet itself. */
const ALREADY_SENT = /already (known|in (the )?(block ?chain|mempool))|txn-already/i;

/**
 * Asks the wallet to sign the planned proof, checks the answer with `checkTxProof` (the verifier's own check) and that
 * it is the planned transaction, then sends it. Returns the claim to publish and the chain evidence for the Link step.
 */
export async function signProof(
  wallet: ProofWallet,
  plan: ProofPlan,
  npub: string,
  prompt: string,
  open: OpenChain = electrumChain(),
): Promise<{ claim: BchClaim; txLookups: Record<string, TxLookup> }> {
  const inputPaths = plan.transaction.inputs.map((_, i): [number, WalletPath, number] => [i, plan.path, plan.index]);
  const reply = await wallet.sign({ transaction: plan.transaction, sourceOutputs: plan.sourceOutputs, userPrompt: prompt }, inputPaths);
  const raw = typeof reply === 'string' ? reply.trim().toLowerCase() : '';
  const decoded = /^([0-9a-f]{2})+$/.test(raw) ? decodeTransaction(hexToBin(raw)) : 'not hex';
  if (typeof decoded === 'string' || !sameAsPlanned(decoded, plan.transaction)) throw new TextError('wizard.badReply');
  const txid = txidOf(hexToBin(raw));
  const evidence: TxEvidence = { raw, sources: plan.sources };
  const address = parseP2pkhAddress(plan.address);
  if (typeof address === 'string' || !checkTxProof(txid, address, npub, evidence).ok) throw new TextError('wizard.badReply');

  const chain = await openOrThrow(open);
  try {
    if (!chain.send) throw new TextError('wizard.unreachable');
    const sent = await chain.send(raw).catch((e: unknown) => {
      if (ALREADY_SENT.test(String(e))) return txid;
      throw new TextError('wizard.sendFailed', { detail: String(e).slice(0, config.walletConnect.errorDetailMaxChars) });
    });
    if (sent !== txid) throw new TextError('wizard.sendFailed', { detail: String(sent) });
  } finally {
    await chain.close();
  }
  return {
    claim: { address: plan.address, signature: `${TX_PROOF_PREFIX}${txid}` },
    txLookups: { [txid]: { kind: 'found', evidence } },
  };
}
