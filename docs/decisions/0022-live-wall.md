# 0022: The wall keeps itself current and counts only what it read

Status: accepted

## Context

The wall read the relays once and offered a "Check again" button. A binding published while the page was open did not
show until the reader pressed it, and the page gave no summary of what it had checked. A full read pages back through
up to `wall.maxPages` pages per relay and verifies every event in the browser; on the live site that took 29 to 35 s
under load (docs/MEASURED.md, Wall), so repeating it on a timer would keep the page busy for good.

Options weighed:

1. Repeat the full read every interval. Simple, but slow and heavy on the relays.
2. Keep the events already read, ask each relay only for its newest page on a timer, and hold an open subscription for
   new kind `10011` events between checks.
3. Subscription only. A relay that drops the subscription silently would leave the wall stale with no sign of it.

## Decision

Option 2. `loadWall` fills a pool of raw relay results; `refreshWall` asks each relay for one newest page, adds what is
new to the pool and verifies the whole pool again, so a binding replaced since the last read drops and a new one joins.
The subscription (`web/wall/subscribe.ts`, `since` = when the page opened) passes events on unverified; a burst is
verified together after a short pause. The timer (`web/wall/refresh-loop.ts`) runs every `wall.refreshSeconds` (5 to 120,
default 30), never overlaps a check still running, stops while the tab is hidden and checks at once when it shows again
past due. The button is gone.

The strip above the wall counts, from this page's own reads only: verified bindings listed, anchored among the entries
whose chain read finished ("N of M read"), on-chain proofs (a dash while a proof transaction is not read yet),
attestations of the listed bindings (one query, a dash when no relay answered), relays answering, the newest anchor block
read, and the time of the last check in UTC. A number that was not read is a dash, never a zero. The counts are a polite
live region; the time sits outside it so a screen reader is not interrupted every interval.

`wall.refreshSeconds` is read by the web app only, so the packed library (`docs/pkg/`) does not carry it and was not
repacked.

## Consequences

- Chain reads for "anchored since" badges stay once per binding per page (ADR 0016); a revocation on the chain shows
  on the next page load, not on the next interval.
- With a 30 s interval a visible wall asks each relay for one page twice a minute.
- Rollback: restore a manual button by calling `refreshWall` from it; the pool and strip do not depend on the timer.
