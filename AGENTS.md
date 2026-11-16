# Notes for agents

Notes for anyone (person or coding agent) working in this repository.

## Layout

- `src/core/` pure TypeScript: CashAddr, BCH signed messages, Nostr events, binding, discovery, sign-in, DID documents.
- `bin/` command-line verifier.
- `server/` small Fastify server for the demo relying app and static files.
- `web/` Vite + React page. All user-facing text comes from `lang/`.
- `config/tambat.json` every value that may change (relays, timeouts, network, event kinds, origins). Code reads it.
- `lang/en.json`, `lang/ms.json` UI text, English and Malay, same keys.
- `docs/decisions/` short architecture decision records.

## Rules

- Everything tracked is in English. Malay appears only in `lang/ms.json`.
- Keys stay with the user. No private key is sent to the server, logged, or committed.
- No BCH transactions are built or broadcast. Paying an identity is a BIP21 URI that the user's wallet handles.
- Small modules (aim for 300 lines or fewer). Record a decision as an ADR when the plan leaves it open.
- Small commits, plain English messages, no history rewrites.

## Commands

Node 22 (`.nvmrc`), npm.

- `npm ci` install.
- `npm test` unit tests (vitest, no network).
- `npm run gate` lint, types, unit tests and build.
