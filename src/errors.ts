/**
 * Errors and reasons shown to people, in the chosen language. The core keeps English reasons for the CLI and
 * the JSON API and adds a stable code; this module turns codes into text through the language files. Text that comes
 * from outside (a relay, a wallet library, the network) is shown inside a translated sentence, never on its own.
 */
import { config } from './config.js';
import type { Step } from './core/verify.js';
import type { Translate } from './i18n.js';

/** An error whose message is a language key. */
export class TextError extends Error {
  constructor(
    readonly key: string,
    readonly vars?: Record<string, string | number>,
  ) {
    super(key);
  }
}

/** An error answer from the demo app server; `code` is the `error` field of the JSON body. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const translated = (t: Translate, key: string, vars?: Record<string, string | number>): string | null => {
  const text = t(key, vars);
  return text === key ? null : text;
};

/** The numeric code of a wallet error: WalletConnect and wallets answer with `{ code, message }`, sometimes as text. */
function codeOf(e: object): number | null {
  const code = (e as { code?: unknown }).code;
  if (typeof code === 'number' && Number.isInteger(code)) return code;
  if (typeof code === 'string' && /^-?\d+$/.test(code)) return Number(code);
  return null;
}

function messageOf(e: object): string | null {
  const message = (e as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message.trim() : null;
}

/** A short readable form of a value with no message, so the page never shows "[object Object]". */
function detail(e: unknown): string {
  let text: string | undefined;
  try {
    text = typeof e === 'string' ? e : JSON.stringify(e);
  } catch {
    text = undefined;
  }
  if (text === undefined) text = e && typeof e === 'object' ? `{${Object.keys(e).join(', ')}}` : typeof e;
  const max = config.walletConnect.errorDetailMaxChars;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Text for an error answer from a wallet, by its code (config walletConnect.errorCodes), or null when it has no code. */
function walletText(e: object, t: Translate): string | null {
  const code = codeOf(e);
  if (code === null) return null;
  const name = Object.entries(config.walletConnect.errorCodes).find(([, codes]) => codes.includes(code))?.[0];
  const named = name && translated(t, `errors.wallet.${name}`, { code });
  if (named) return named;
  if (e instanceof Error) return null;
  const message = messageOf(e);
  return message ? t('errors.wallet.other', { message, code }) : t('errors.wallet.otherCode', { code });
}

export function errorText(e: unknown, t: Translate): string {
  if (e instanceof TextError) return t(e.key, e.vars);
  if (e instanceof ApiError) {
    const known = translated(t, `errors.api.${e.code}`);
    if (known) return known;
  }
  if (e && typeof e === 'object') {
    const wallet = walletText(e, t);
    if (wallet) return wallet;
  }
  const message = e instanceof Error ? e.message || e.name : e && typeof e === 'object' ? messageOf(e) : null;
  return t('errors.unexpected', { reason: message ?? detail(e) });
}

/** The reason a verification step failed or was skipped, in the chosen language. */
export function stepReason(step: Step, t: Translate): string | null {
  if (!step.reason) return null;
  return (step.code && translated(t, `steps.reasons.${step.code}`, step.vars)) || t('errors.unexpected', { reason: step.reason });
}
