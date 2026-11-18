# 0012: Named wallet errors, and no wallet request for unconfirmed coins

Status: accepted (both parts)

## Context

When a wallet refused a WalletConnect request, the page showed `Something went wrong. Details: [object Object]`.
WalletConnect rejects `client.request` with a plain JSON-RPC error object `{ code, message, data? }`, not an `Error`, and
`errorText` turned anything that was not an `Error` into text with `String(e)`. Every wallet path (sign-in, binding, anchor)
and the one-file verifier go through `errorText`, so the fix lives there.

## Sources of the codes

- `@walletconnect/utils` (already a dependency) `getSdkError`: `USER_REJECTED` 5000, `USER_REJECTED_METHODS` 5002,
  `UNSUPPORTED_CHAINS` 5100, `UNSUPPORTED_METHODS` 5101, `UNSUPPORTED_ACCOUNTS` 5103, `USER_DISCONNECTED` 6000,
  `EXPIRED` 6; `getInternalError` `WC_METHOD_UNSUPPORTED` 10001. Read from the installed `dist`, not from memory.
- The Paytaca wallet answers a refusal with `{ code: 5000, message: 'User rejected' }`, an unknown method with JSON-RPC
  `-32601`, and every signing failure with JSON-RPC `-32603` plus a message. EIP-1193 `4001` (user rejected) is used by
  other wallets.
- The BCH WalletConnect method spec (`bch_signTransaction`) defines no error codes of its own.

## Decision

- The code to reason table lives in `config/tambat.json` as `walletConnect.errorCodes` (name to list of integers), checked
  by `src/config.ts`: integers only, no code under two names. The text is `errors.wallet.<name>` in `lang/en.json` and
  `lang/ms.json`. Adding a code or a reason is a config and language file change, not a code change.
- `errorText` reads `code` (a number, or digits as text) and `message` from any object. A listed code gives its named
  reason. An unlisted code gives `errors.wallet.other` with the wallet's message and code inside the translated sentence,
  or `errors.wallet.otherCode` when there is no message. Anything else falls back to `errors.unexpected` with the message,
  or a short JSON form capped at `walletConnect.errorDetailMaxChars`. `[object Object]` cannot be produced.
- No "unknown coins" reason: Paytaca reports an input it cannot sign under the generic `-32603`, so there is no stable
  code to map. Its message is still shown through `errors.wallet.other`.
- No new package (an error serializer was considered): the fix is a few lines and the release is pinned.
- Confirmed coins only: the chain server's `listunspent` height (0 or less is the mempool) is kept on each coin, and
  `anchorFromCoins` (`src/core/anchor.ts`) builds the transaction from coins already in a block when
  `anchor.confirmedCoinsOnly` is `true` (the default). When only unconfirmed coins would pay the fee, the page says
  `anchor.unconfirmed` (wait for one confirmation, about 10 minutes) and the wallet is not asked: BCH allows spending
  unconfirmed coins, but a wallet or its indexer may refuse coins it has not seen yet, and one block is cheaper than an
  approval that fails. With the setting `false`, every coin is spent and a wallet error while unconfirmed coins are in
  the transaction gets the hint `anchor.hintUnconfirmed`.
- The anchor help paragraph names the 54-character address. It wraps through a CSSOM style on the element (allowed by
  the `style-src` policy), so the offer fits at 320 px. It can move to `web/styles.css` as `.option__help` later.

## Rollback

`git revert` the commits, or redeploy the previous image. Codes can be removed from the config without a code change,
and `anchor.confirmedCoinsOnly: false` turns the confirmed-coins check off.
