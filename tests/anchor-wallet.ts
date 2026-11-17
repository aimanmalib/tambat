/**
 * A stand-in for the wallet side of wc2-bch-bcr signing, done the way Paytaca signs a P2PKH input: Schnorr over the
 * BCH signing serialization with SIGHASH_ALL | SIGHASH_UTXOS | SIGHASH_FORKID (0x61). Used by tests and e2e only.
 */
import {
  binToHex,
  encodeDataPush,
  encodeTransaction,
  generateSigningSerializationBCH,
  hash256,
  secp256k1,
  type CompilationContextBCH,
  type Input,
  type Output,
  type TransactionCommon,
} from '@bitauth/libauth';

const HASH_TYPE = 0x61;

export function signP2pkh(transaction: TransactionCommon, sourceOutputs: (Input & Output)[], privateKey: Uint8Array): Uint8Array {
  const publicKey = secp256k1.derivePublicKeyCompressed(privateKey);
  if (typeof publicKey === 'string') throw new Error(publicKey);
  const inputs = transaction.inputs.map((input, inputIndex) => {
    const context = { inputIndex, sourceOutputs, transaction } as unknown as CompilationContextBCH;
    const preimage = generateSigningSerializationBCH(context, {
      coveredBytecode: sourceOutputs[inputIndex]!.lockingBytecode,
      signingSerializationType: Uint8Array.of(HASH_TYPE),
    });
    const signature = secp256k1.signMessageHashSchnorr(privateKey, hash256(preimage));
    if (typeof signature === 'string') throw new Error(signature);
    return { ...input, unlockingBytecode: Uint8Array.from([...encodeDataPush(Uint8Array.from([...signature, HASH_TYPE])), ...encodeDataPush(publicKey)]) };
  });
  return encodeTransaction({ ...transaction, inputs });
}

export const hexOf = (bytes: Uint8Array): string => binToHex(bytes);
