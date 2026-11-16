/** Pay to an identity: a BIP21 payment URI for a verified address. The user's own wallet builds and sends the transaction. */
import { parseP2pkhAddress } from './cashaddr.js';

export interface PaymentRequest {
  address: string;
  /** Amount in BCH as typed by the user; empty means the wallet asks. */
  amount?: string;
  label?: string;
  message?: string;
}

const AMOUNT = /^(?:0|[1-9]\d{0,7})(?:\.\d{1,8})?$/;

/** Why an amount is not valid: `format` (not a BCH number with at most 8 decimals) or `zero` (not positive). */
export type AmountProblem = 'format' | 'zero';

const AMOUNT_TEXT: Record<AmountProblem, string> = {
  format: 'amount must be a number in BCH with at most 8 decimals',
  zero: 'amount must be more than zero',
};

/** Checks an amount in BCH (up to 8 decimals, positive). Empty is valid: the wallet asks. */
export function amountProblem(amount: string): AmountProblem | null {
  const value = amount.trim();
  if (value === '') return null;
  if (!AMOUNT.test(value)) return 'format';
  if (Number(value) <= 0) return 'zero';
  return null;
}

/** The English reason an amount is not valid, or null. */
export function amountError(amount: string): string | null {
  const problem = amountProblem(amount);
  return problem ? AMOUNT_TEXT[problem] : null;
}

/** Builds `bitcoincash:<address>?amount=..&label=..&message=..`. Throws on an invalid address or amount. */
export function paymentUri(request: PaymentRequest): string {
  const parsed = parseP2pkhAddress(request.address);
  if (typeof parsed === 'string') throw new Error(parsed);
  const amount = request.amount?.trim() ?? '';
  const bad = amountError(amount);
  if (bad) throw new Error(bad);
  const params: string[] = [];
  if (amount !== '') params.push(`amount=${amount}`);
  if (request.label) params.push(`label=${encodeURIComponent(request.label)}`);
  if (request.message) params.push(`message=${encodeURIComponent(request.message)}`);
  return params.length ? `${parsed.address}?${params.join('&')}` : parsed.address;
}
