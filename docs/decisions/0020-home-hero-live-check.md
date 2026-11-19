# 0020: The home page opens with a live check of a real binding

Status: accepted

## Context

The home page used to open with a headline and the Link form. A visitor had to make a binding, or know an npub to look up,
before seeing the protocol do anything. A real binding signed with a Paytaca wallet over WalletConnect is on the public
relays and anchored on BCH (docs/MEASURED.md), so the page can show it being checked as soon as it opens.

Two ways were weighed:

1. Show a recorded result (a screenshot or a stored step list). This is fast and never fails, but it shows nothing about
   the relays or the chain today, so it is a picture of a check, not a check.
2. Fetch the event from the relays and check it in the browser with the same code as Look up, showing each step as its
   result arrives.

## Decision

Option 2. `config/tambat.json` `hero` names the binding (npub and event id) and a time limit for each network step.
`src/core/hero-check.ts` asks the relays for that event id and author, runs `verifyBinding`, and reports the steps in the
order a verifier depends on them: found on the relays, Nostr signature, BCH signature, the signer owns the address, then
the address's commitment on BCH from an agreed read of the chain servers. It stops at the first failed step and the page
names it. The anchor step is extra: an unreadable chain or a missing commitment gives no mark and does not fail the
binding. The page yields to the browser after each report so each mark is drawn when its own check has returned; there
is no timer that paces the marks.

The `hero` section is read only by the web app. The library package (ADR 0018) carries a frozen copy of the config, so
`tests/core-package.test.ts` compares the packed config without app-only sections and checks that `src/core` never reads
them. A change to `hero` therefore does not require a new library release.

## Consequences

- The first screen depends on the relays. When none answers within `hero.timeoutMs`, the card says it could not check
  right now and which step failed; it never shows a mark it did not earn.
- On a phone the card fills the first screen and the Link form starts below it, reached by "Link your own keys".
- Undo: render the old headline in `web/App.tsx` `Home` and drop the `HeroCard`; nothing else depends on it.
