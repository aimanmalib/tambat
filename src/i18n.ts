/** Looks up UI text by dotted key. Text lives in lang/*.json; a missing key returns the key so gaps are visible. */
export type Dictionary = { [key: string]: string | Dictionary };

export function translate(dict: Dictionary, key: string): string {
  let node: string | Dictionary | undefined = dict;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return key;
    node = node[part];
  }
  return typeof node === 'string' ? node : key;
}

/** All dotted leaf keys of a dictionary, sorted. Used to keep every language file in step. */
export function leafKeys(dict: Dictionary, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(dict)) {
    const path = prefix + k;
    if (typeof v === 'string') out.push(path);
    else out.push(...leafKeys(v, path + '.'));
  }
  return out.sort();
}
