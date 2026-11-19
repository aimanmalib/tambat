# 0014: Read commitments from several chain servers and require them to agree

Status: accepted

## Context

Commitments and revocations on BCH (ADR 0008, ADR 0013) are read over the Electrum protocol from Fulcrum servers in
`config.anchor.electrum`. Until now the reader opened the first server that answered and believed it. One server that lies
or lags could hide a revocation (so Pay shows a link for a withdrawn address), invent a commitment to another key (so Pay
refuses a good one), or move the "anchored since" block. The reader does not check proof of work or Merkle proofs, so the
cheapest defence is to ask more than one independent server.

## Decision

- `config.anchor.quorum` (an integer from 1 to the number of servers, 2 here) is checked by `parseConfig`.
- `src/core/chain-quorum.ts` `readQuorum` runs the same read against every configured server at once and compares the
  answers (the full list of commitments of the address, with blocks and block times).
- The rule is strict. The answer counts only when every server that answered gave the same answer and at least `quorum`
  answered. A server that cannot be reached, or fails while reading, is left out and named; it does not count against.
  Any answer that differs makes the result `unknown`, even when a majority agrees, because two honest servers never
  differ on a confirmed history for long, and a wrong "bound" is worse than no answer.
- `unknown` gives no verdict and no anchor. Look up and Pay say which servers answered differently or did not answer; Pay
  then shows the link with the same note as when the chain cannot be read (ADR 0013), never a refusal it cannot justify.
  The judges page never shows its check mark for `unknown`.
- When an answer counts, Look up, the judges page and `tambat anchor-lookup` show how many of the servers agreed.
- Reads that need only one server (receipts, the coins for a new commitment) still use the first server that answers
  (`firstAnswering`). A receipt's transaction is checked against its own signature and outputs, so a lying server can hide
  it but not forge it.

## Consequences

- A look-up opens one connection per configured server instead of one in total.
- A server that is a block behind just after a new commitment makes the result `unknown` for a few minutes.
- Tests use three fake sources (all agree, one lies, two down); no live server is needed (tests/chain-quorum.test.ts).

## Rollback

Set `config.anchor.quorum` to 1 and keep one server in `config.anchor.electrum`: the reader then behaves as before.
