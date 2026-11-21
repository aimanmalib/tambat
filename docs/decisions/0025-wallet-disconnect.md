# 0025: Noticing a wallet that disconnects after it connected

Status: accepted.

## Context

Before this change the WizardConnect option listened for `disconnect` only until the wallet connected (the `ready`
promise). A wallet that ended the session later, at the preview or while the page waited for the signature, left the
page on the preview or on "Confirm in your wallet" with nothing happening. The WalletConnect option (Paytaca) did not
listen for the end of the session at all: after Disconnect in the wallet the page still showed the address as
connected, and a sign request would wait for an answer that never came.

What the libraries do, read from the installed packages on 2026-11-21:

- `@wizardconnect/dapp` 0.2.8, `DappConnectionManager`: emits `disconnect` when the wallet sends a Disconnect message
  (after an 8 second grace, in case the wallet reconnects at once). A wallet that closes its app or loses its network
  sends nothing; the manager pings every 10 seconds and, with no answer for 75 seconds, emits `reconnecting`. The
  relay link status `reconnecting` is also emitted as `reconnecting`. It never emits `disconnect` for silence.
- `@walletconnect/sign-client`: emits `session_delete` with the session topic when the wallet disconnects, and
  `session_expire` when the session runs out.

## Decision

- WizardConnect: `web/keys/wizard-liveness.ts` watches the manager's own events for the whole session. It ends the
  session once on `disconnect`, or when `reconnecting` follows a connected wallet and the wallet sends nothing for
  `config.wizardConnect.livenessSeconds` (30). A relay blip while the QR code waits does not end the pairing. The
  session's `onClose(listener)` reports the end; a sign request still waiting is rejected at that moment. Once the
  wallet returned the signed transaction the watch stops, so a wallet that leaves afterwards does not undo the proof.
  No ping of our own is added: the page reads the library's status.
- `WizardConnectOption` listens to `onClose` at every step after pairing (pairing, planning, preview, signing): it
  closes its side, goes back to the Connect button and shows `wizard.disconnected` ("The wallet ended the connection.
  Connect again to continue."). Results that arrive after the end (a plan, a rejected signature) are dropped. A
  session the page closes itself (after a proof, or when the page unmounts) shows nothing.
- WalletConnect: `sessionEnd` in `web/keys/walletconnect.ts` listens for `session_delete` and `session_expire` of the
  approved topic. The signer's `onEnd` reports it, and requests still waiting are rejected. `KeysContext` forgets the
  signer, and the Link and Demo pages show `bch.wcEnded` above the Connect button.

## Tests

`tests/wizard-liveness.test.ts` and `tests/wc-session-end.test.ts` run the watches against fake event emitters.
`e2e/wizard-disconnect.spec.ts` (fake WizardConnect wallet, `e2e/wizard-fake.ts`) ends the session at the preview and
while signing, and `e2e/paytaca-login.spec.ts` deletes the WalletConnect session after it connected; both expect the
Connect button and the reason within two seconds, in Chromium and WebKit on an iPhone 13 screen.

## Limits

These are tests with fake wallets at the library boundary. How long a real wallet takes to be noticed depends on the
wallet: an explicit Disconnect is noticed after the library's 8 second grace; a silent wallet after the library's 75
seconds plus `livenessSeconds`.

## Rollback

Revert the commit; no stored data or protocol is involved.
