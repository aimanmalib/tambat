/**
 * deploy/deploy.sh moves into deploy/ and later calls itself to roll back. Called as `bash deploy/deploy.sh` from the repo
 * root, a relative "$0" no longer exists after the move, so the rollback after a failed browser check never ran.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const lines = readFileSync(new URL('../deploy/deploy.sh', import.meta.url), 'utf8').split('\n');
const cdAt = lines.findIndex((l) => /^cd /.test(l));

describe('deploy script', () => {
  it('resolves its own path before changing directory', () => {
    expect(cdAt).toBeGreaterThan(0);
    const self = lines.findIndex((l) => /^SELF="\$\(realpath "\$0"\)"$/.test(l));
    expect(self).toBeGreaterThanOrEqual(0);
    expect(self).toBeLessThan(cdAt);
  });

  it('never runs a relative "$0" after changing directory', () => {
    const after = lines.slice(cdAt + 1).filter((l) => !l.trimStart().startsWith('#'));
    expect(after.filter((l) => l.includes('"$0"'))).toEqual([]);
    expect(after.some((l) => l.includes('exec "$SELF" --rollback'))).toBe(true);
  });
});
