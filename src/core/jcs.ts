/**
 * JSON Canonicalization Scheme (RFC 8785): one byte-exact text for a JSON value. Object members are sorted by their
 * names as UTF-16 code units, numbers use the ECMAScript number-to-string rules and strings the JSON.stringify
 * escapes, which is what the RFC specifies. Used to compare a credential with the one its proof implies.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('JCS: numbers must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    // Default sort compares UTF-16 code units, as RFC 8785 section 3.2.3 requires.
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  }
  throw new Error(`JCS: cannot serialize a ${typeof value}`);
}
