# 0006: One-file offline verifier

Status: accepted

## Context

A binding is only decentralised if people can check it without this site. The CLI already does that, but needs Node and a
clone. A single HTML file that anyone can save, hash and open from disk covers the same ground for people without a toolchain,
and lets a reviewer confirm that nothing in the check depends on the Tambat server.

## Decision

- Build `verifier/` with Vite and `vite-plugin-singlefile` (MIT, maintained) into `dist-verifier/tambat-verify.html`: every
  script, style and the libauth secp256k1 WebAssembly inline. `npm run build:verifier` prints the SHA-256 and writes
  `tambat-verify.html.sha256`.
- The verifier imports `src/core/` (verify, discover) and the look-up checklist component; nothing is copied. Text comes from
  `lang/en.json` and `lang/ms.json`; `?lang=ms` picks Malay.
- Input: a pasted kind 10011 event is checked with no network (the `newest` step is skipped, as in the CLI); an npub, hex key
  or address is looked up on relays listed in an editable field, defaulting to `nostr.relays` at build time.
- The file carries a meta Content-Security-Policy: `default-src 'none'`, inline script and style, `'wasm-unsafe-eval'`,
  `connect-src ws: wss:`. Opened from disk it can reach relays and nothing else.
- The server serves the same bytes at `/verify/` and as a download, with a stricter header policy derived from the meta tag:
  `'unsafe-inline'` is replaced by the SHA-256 of each inline block, plus `frame-ancestors 'none'`.
- Reproducible: two builds of one commit give identical bytes (unit test), and the README quotes the hash of the current
  build (the same test fails when it drifts). The file embeds no commit id or time, so it changes only when its inputs do.

## Consequences

- The file is about 0.7 MB, mostly React and the WebAssembly; acceptable for a download.
- Any change under `src/core/`, `web/ui/`, `lang/` or `config/` that the verifier imports changes the hash, and the README
  must be updated in the same commit.
- Undo: drop the `build:verifier` step and the `/verify/` routes; nothing else depends on them.
