/**
 * Asking the connected wallet to make the optional BCH anchor (docs/SPEC.md "Optional BCH anchor"). The page builds
 * the transaction without signatures from the address's coins, shows the outputs and the fee, and the wallet signs and
 * sends it (wc2-bch-bcr `bch_signTransaction` with `broadcast: true`). Nothing here holds a key or sends a transaction.
 */
import { hexToBin, stringify } from '@bitauth/libauth';
import {
  anchorFromCoins,
  commitmentFromTransaction,
  txidOf,
  type AnchorPayload,
  type AnchorRefusal,
  type PreparedAnchor,
  type UnsignedAnchor,
} from '../../src/core/anchor';
import { electrumChain, scripthashOf, type OpenChain } from '../../src/core/anchor-chain';
import { config } from '../../src/config';
import { TextError } from '../../src/errors';
import type { BchSigner } from './bch';

export const SIGN_METHOD = 'bch_signTransaction';

/** True when the signer is a wallet session that allows the signing method. */
export const canAnchor = (signer: BchSigner | null): signer is BchSigner & Required<Pick<BchSigner, 'request'>> =>
  signer?.kind === 'walletconnect' && typeof signer.request === 'function' && config.walletConnect.methods.includes(SIGN_METHOD);

/** Text keys for the reasons no anchor can be built from the coins. */
const REFUSAL: Record<AnchorRefusal, string> = {
  no_coins: 'anchor.noCoins',
  unconfirmed: 'anchor.unconfirmed',
  too_little: 'anchor.tooLittle',
  fee_high: 'anchor.feeHigh',
};

/**
 * Builds the commitment from the address's coins, read from the chain, before the wallet is asked. Coins not yet in a
 * block are left out (config anchor.confirmedCoinsOnly). Throws a TextError the page can show.
 */
export async function prepareAnchor(address: string, payload: AnchorPayload, open: OpenChain = electrumChain()): Promise<PreparedAnchor> {
  let chain;
  try {
    chain = await open();
  } catch {
    throw new TextError('anchor.unreachable');
  }
  try {
    const utxos = await chain.unspent(scripthashOf(address)).catch(() => {
      throw new TextError('anchor.unreachable');
    });
    let prepared: PreparedAnchor | AnchorRefusal;
    try {
      prepared = anchorFromCoins(address, utxos, payload);
    } catch {
      prepared = 'too_little';
    }
    if (typeof prepared === 'string') throw new TextError(REFUSAL[prepared], { address, max: config.anchor.maxFeeSats });
    return prepared;
  } finally {
    await chain.close();
  }
}

/**
 * Sends the request to the wallet and checks its answer: the signed transaction must be the same commitment, from the
 * same address. Returns the transaction id.
 */
export async function requestAnchor(signer: BchSigner, unsigned: UnsignedAnchor, payload: AnchorPayload, prompt: string): Promise<string> {
  if (!canAnchor(signer)) throw new TextError('anchor.needWallet');
  // wc2-bch-bcr carries Uint8Array and bigint as "<Uint8Array: 0x..>" and "<bigint: ..n>" strings (libauth stringify).
  const params = JSON.parse(
    stringify({ transaction: unsigned.transaction, sourceOutputs: unsigned.sourceOutputs, broadcast: true, userPrompt: prompt }),
  ) as unknown;
  const reply = (await signer.request(SIGN_METHOD, params)) as { signedTransaction?: unknown } | null;
  const hex = typeof reply?.signedTransaction === 'string' ? reply.signedTransaction : '';
  if (!/^[0-9a-f]+$/i.test(hex)) throw new TextError('anchor.badReply');
  const bytes = hexToBin(hex);
  const found = commitmentFromTransaction(bytes, signer.address);
  const same = typeof found !== 'string' && found.pubkey === payload.pubkey && found.eventId === payload.eventId && found.action === payload.action;
  if (!same) throw new TextError('anchor.badReply');
  return txidOf(bytes);
}
