/**
 * The WizardConnect session watch (web/keys/wizard-liveness.ts) against a fake session manager: an EventEmitter that
 * emits what the library emits (`walletready`, `messagereceived`, `reconnecting`, `disconnect`).
 */
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextError } from '../src/errors.js';
import { watchSession } from '../web/keys/wizard-liveness.js';

const GRACE = 30_000;

function setup() {
  const manager = new EventEmitter();
  const watch = watchSession(manager, { graceMs: GRACE });
  const closed = vi.fn();
  watch.onClose(closed);
  return { manager, watch, closed };
}

const isDisconnected = (e: unknown) => e instanceof TextError && e.key === 'wizard.disconnected';

describe('WizardConnect session watch', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('calls the listener once when the wallet disconnects after it connected', () => {
    const { manager, watch, closed } = setup();
    manager.emit('walletready');
    manager.emit('messagereceived', { action: 'pong' });
    manager.emit('disconnect', 'user_disconnect', 'bye');
    manager.emit('disconnect', 'user_disconnect', 'bye');
    expect(closed).toHaveBeenCalledTimes(1);
    expect(watch.ended).toBe(true);
    expect(manager.listenerCount('disconnect')).toBe(0);
  });

  it('rejects a sign request that is waiting when the wallet disconnects', async () => {
    const { manager, watch } = setup();
    manager.emit('walletready');
    const pending = watch.guard(new Promise<string>(() => undefined));
    manager.emit('disconnect');
    await expect(pending).rejects.toSatisfy(isDisconnected);
    await expect(watch.guard(Promise.resolve('late'))).rejects.toSatisfy(isDisconnected);
  });

  it('lets a request settle normally while the wallet stays', async () => {
    const { manager, watch, closed } = setup();
    manager.emit('walletready');
    await expect(watch.guard(Promise.resolve('signed'))).resolves.toBe('signed');
    await expect(watch.guard(Promise.reject(new Error('declined')))).rejects.toThrow('declined');
    expect(closed).not.toHaveBeenCalled();
  });

  it('a page that closes the session itself hears nothing, and nothing waiting is turned into an error', async () => {
    const { manager, watch, closed } = setup();
    manager.emit('walletready');
    const pending = watch.guard(Promise.resolve('signed'));
    watch.stop();
    manager.emit('disconnect');
    manager.emit('reconnecting');
    vi.advanceTimersByTime(GRACE * 2);
    expect(closed).not.toHaveBeenCalled();
    expect(watch.ended).toBe(false);
    await expect(pending).resolves.toBe('signed');
    expect(manager.listenerCount('disconnect') + manager.listenerCount('reconnecting')).toBe(0);
  });

  it('ends a session whose wallet went silent: reconnecting with no word for the grace period', () => {
    const { manager, closed } = setup();
    manager.emit('walletready');
    manager.emit('reconnecting');
    vi.advanceTimersByTime(GRACE - 1);
    expect(closed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('keeps a session whose wallet speaks again within the grace period', () => {
    const { manager, closed } = setup();
    manager.emit('walletready');
    manager.emit('reconnecting');
    vi.advanceTimersByTime(GRACE - 1);
    manager.emit('walletready');
    vi.advanceTimersByTime(GRACE * 2);
    expect(closed).not.toHaveBeenCalled();
  });

  it('a relay blip while the QR code waits does not end the pairing; a disconnect then does', () => {
    const { manager, closed } = setup();
    manager.emit('reconnecting');
    vi.advanceTimersByTime(GRACE * 2);
    expect(closed).not.toHaveBeenCalled();
    manager.emit('disconnect');
    expect(closed).toHaveBeenCalledTimes(1);
  });
});
