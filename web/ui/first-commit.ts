/** The "new project" note: a link to the repository's first commit, built from config.banner, or nothing when the note is off. */
export interface FirstCommitBanner {
  repoUrl: string;
  firstCommit: string;
  note: boolean;
}

export function firstCommitHref(b: FirstCommitBanner): string | null {
  if (!b.note || !b.repoUrl || !/^[0-9a-f]{40}$/.test(b.firstCommit)) return null;
  return `${b.repoUrl.replace(/\/+$/, '')}/commit/${b.firstCommit}`;
}
