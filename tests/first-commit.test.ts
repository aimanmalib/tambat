/** The "new project" note links the repository's first commit, built from config, and the README links the same commit. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { firstCommitHref } from '../web/ui/first-commit.js';
import en from '../lang/en.json' with { type: 'json' };
import ms from '../lang/ms.json' with { type: 'json' };

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const sha = 'a'.repeat(40);

describe('first commit note', () => {
  it('builds <repoUrl>/commit/<sha> from config', () => {
    expect(firstCommitHref({ repoUrl: 'https://example.org/r', firstCommit: sha, note: true })).toBe(`https://example.org/r/commit/${sha}`);
    expect(firstCommitHref({ repoUrl: 'https://example.org/r/', firstCommit: sha, note: true })).toBe(`https://example.org/r/commit/${sha}`);
    expect(firstCommitHref(config.banner)).toBe(`${config.banner.repoUrl}/commit/${config.banner.firstCommit}`);
  });

  it('shows nothing when the note is off, the SHA is not whole or there is no repository', () => {
    expect(firstCommitHref({ repoUrl: 'https://example.org/r', firstCommit: sha, note: false })).toBeNull();
    expect(firstCommitHref({ repoUrl: 'https://example.org/r', firstCommit: sha.slice(0, 7), note: true })).toBeNull();
    expect(firstCommitHref({ repoUrl: '', firstCommit: sha, note: true })).toBeNull();
  });

  it('has the note in both languages and the README links the same commit with the same sentence', () => {
    expect(en.banner.note).toContain('14 November');
    expect(ms.banner.note).toContain('14 November');
    expect(readme).toContain(en.banner.note);
    expect(readme).toContain(firstCommitHref(config.banner));
  });
});
