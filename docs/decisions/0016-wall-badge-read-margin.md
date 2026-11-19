# 0016: Read wall badges for entries just below the fold

Status: accepted

## Context

The wall shows "Anchored since block N" on an entry only after reading the chain for it (ADR 0014), and it reads the chain
only for entries on screen (`web/ui/SinceBadge.tsx`), so a long wall does not open chain connections for entries nobody
looks at. On an iPhone 13 (390 by 664 CSS pixels) the live wall showed no badge on the Paytaca entry, while desktop
Chromium showed it. One explanation offered was that WebKit allows one WebSocket per chain server, so later reads stall.

Measured on the live site, 2026-11-19 08:2x UTC, WebKit with the iPhone 13 profile and desktop Chromium, counting every
WebSocket the page opened (`page.on('websocket')`), each in a fresh browser:

| engine | scrolled | entries | Paytaca entry | `data-since-read` | badge | sockets per chain server |
| --- | --- | --- | --- | --- | --- | --- |
| WebKit iPhone 13 | no | 4, tops at 571, 858, 1145, 1432 px | third | yes, no, no, no | none after 30 s | 1 |
| WebKit iPhone 13 | each entry into view | 4 | third | yes, yes, yes, yes | block 977901 | 4 |
| Chromium 1280 by 900 | no | 4, two per row | third | yes, yes, yes, yes | block 977901 | 4 |

- `data-since-read="no"` means the observer for that entry never fired, so no read started; it is not a failed read.
- After scrolling, WebKit opened four sockets to each of the three servers, one per entry, all closed afterwards, and the
  badge appeared. The one-socket explanation does not hold.
- Cause: on a phone the wall is one column, so only the first entry is on screen at first. The Paytaca entry starts about
  1.7 screens down and was read only once scrolled to, then took a few seconds to show its badge.

## Decision

- `IntersectionObserver` takes a `rootMargin` from config, `wall.sinceRootMargin` (`0px 0px 100% 0px`: one extra screen
  below the fold), checked by `parseConfig` (`isRootMargin`, 1 to 4 lengths in px or %). Entries within a screen below the
  fold are read at load, so their badge is usually there when the reader scrolls to them. Entries further down are still
  read only when they come near, `wall.chainConcurrency` at a time.
- `createReadOnce` (`src/core/since.ts`) keeps each finished read for the life of the page, so an entry is not read again
  when it scrolls back into view or the wall is drawn again. A read that throws is forgotten and may be tried again.

## Consequences

- At load a phone reads up to about three entries instead of one: a few more connections, and fewer badges that appear late.
- `e2e/since.spec.ts` checks on a 390 by 664 screen in WebKit and Chromium that the third entry, below the fold, is read
  and badged before any scroll, that the last entry is not, and that an entry further down is badged after scrolling a
  screen at a time. With the margin set to `0px` that test fails.
- To go back: set `wall.sinceRootMargin` to `0px`.
