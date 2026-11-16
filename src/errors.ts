/**
 * Errors and reasons shown to people, in the chosen language. The core keeps English reasons for the CLI and
 * the JSON API and adds a stable code; this module turns codes into text through the language files. Text that comes
 * from outside (a relay, a wallet library, the network) is shown inside a translated sentence, never on its own.
 */
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

export function errorText(e: unknown, t: Translate): string {
  if (e instanceof TextError) return t(e.key, e.vars);
  if (e instanceof ApiError) {
    const known = translated(t, `errors.api.${e.code}`);
    if (known) return known;
  }
  return t('errors.unexpected', { reason: e instanceof Error ? e.message : String(e) });
}

/** The reason a verification step failed or was skipped, in the chosen language. */
export function stepReason(step: Step, t: Translate): string | null {
  if (!step.reason) return null;
  return (step.code && translated(t, `steps.reasons.${step.code}`, step.vars)) || t('errors.unexpected', { reason: step.reason });
}
