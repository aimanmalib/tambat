# 0018: Ship src/core as an installable tarball

Status: accepted

## Context

Wallets and Nostr clients should be able to use the binding code without copying it. `src/core` reads the site config
(`src/config.ts`, which imports `config/tambat.json`) at module load, so it cannot be dropped into another project as is.
Publishing to a package registry is not part of this work.

## Decision

- `packages/core/` holds only the package manifest template, a tsconfig and a README. `scripts/pack-core.ts` compiles
  `src/core/index.ts` with tsc (no copied source), writes the version from the root `package.json`, takes the
  dependencies from the bare imports found in the compiled output pinned to the root versions, and runs `npm pack`.
- The tarball and a `SHA256SUMS` line are tracked in `docs/pkg/`. npm pack output is byte-stable for the same input,
  so a rebuild of an unchanged tree gives the same hash.
- The config the site uses is frozen into the package at build time. `configure(overrides)` in `src/config.ts` merges
  a partial config into the shared object after `parseConfig` accepts it; a rejected override changes nothing. Every
  module keeps reading `config`, so no function signature changed.
- `tests/core-package.test.ts` checks the hash, the file list (built files only), the version, the pinned dependencies
  and that the frozen config equals `config/tambat.json`, so a config or version change without a repack fails. It then
  installs the tarball into an empty folder with `npm ci --offline`, using a lockfile built from the root lockfile so
  only tarballs already in the npm cache are needed, and runs both examples against the installed package.

## Consequences

- A change to `src/core` or `config/tambat.json` needs `npx tsx scripts/pack-core.ts` before the commit; the config
  check catches a stale config, a code change alone is caught only when the examples break.
- `configure` mutates a module-level object: one config per process, which fits a wallet or a client.
- Undo: delete `docs/pkg/`, `packages/core/`, the script and the test; the site does not use any of them.
