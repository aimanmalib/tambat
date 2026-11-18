/**
 * Signing a commitment with a key the caller holds, the way a phrase wallet such as Paytaca signs a P2PKH input:
 * Schnorr over the BCH signing serialization with SIGHASH_ALL | SIGHASH_UTXOS | SIGHASH_FORKID (0x61).
 * Used by the project's demo key script (scripts/anchor-demo.ts) and by tests that stand in for a wallet. The web app
 * never signs: the connected wallet does.
 */
import {
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

/** Signs every input as a P2PKH spend of `privateKey` and returns the encoded transaction. */
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
