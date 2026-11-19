import type { Tally } from '../../src/core/chain-quorum';
import type { Translate } from '../i18n';

const names = (list: string[]) => list.join(', ');

/** Why the chain servers gave no answer: who answered differently, who did not answer, or too few alike. */
export function tallyDetail(tally: Tally, t: Translate): string {
  const parts: string[] = [];
  if (tally.differing.length > 0) parts.push(t('chain.differing', { names: names(tally.differing) }));
  if (tally.unreachable.length > 0) parts.push(t('chain.missing', { names: names(tally.unreachable) }));
  if (tally.differing.length === 0 && tally.agreed.length < tally.quorum) parts.push(t('chain.tooFew', { count: tally.agreed.length, quorum: tally.quorum }));
  return parts.join('; ');
}

/** One line saying how many servers agreed, for an answer that met the quorum. */
export function tallyAgreed(tally: Tally, t: Translate): string {
  return t('chain.agreed', { agreed: tally.agreed.length, total: tally.total, names: names(tally.agreed) });
}
