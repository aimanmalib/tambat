/**
 * The end of a WalletConnect session (web/keys/walletconnect.ts `sessionEnd`) against a fake SignClient: an
 * EventEmitter that emits `session_delete` and `session_expire` as the library does when the wallet disconnects.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { isSessionEnd, sessionEnd } from '../web/keys/walletconnect.js';

const TOPIC = 'fake-topic';

describe('WalletConnect session end', () => {
  it('calls the listener once when the wallet deletes this session, and rejects a waiting request', async () => {
    const client = new EventEmitter();
    const ended = sessionEnd(client, TOPIC);
    const heard = vi.fn();
    ended.onEnd(heard);
    const pending = ended.guard(new Promise<string>(() => undefined));
    client.emit('session_delete', { topic: TOPIC });
    expect(heard).toHaveBeenCalledTimes(1);
    await expect(pending).rejects.toSatisfy(isSessionEnd);
    client.emit('session_delete', { topic: TOPIC });
    client.emit('session_expire', { topic: TOPIC });
    expect(heard).toHaveBeenCalledTimes(1);
    await expect(pending).rejects.toSatisfy(isSessionEnd);
    await expect(ended.guard(Promise.resolve('late'))).rejects.toSatisfy(isSessionEnd);
  });

  it('an expired session ends the same way', () => {
    const client = new EventEmitter();
    const heard = vi.fn();
    sessionEnd(client, TOPIC).onEnd(heard);
    client.emit('session_expire', { topic: TOPIC });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('ignores another session, and lets requests settle while the session lives', async () => {
    const client = new EventEmitter();
    const ended = sessionEnd(client, TOPIC);
    const heard = vi.fn();
    ended.onEnd(heard);
    client.emit('session_delete', { topic: 'another-topic' });
    expect(heard).not.toHaveBeenCalled();
    await expect(ended.guard(Promise.resolve('signed'))).resolves.toBe('signed');
    await expect(ended.guard(Promise.reject(new Error('declined')))).rejects.toThrow('declined');
  });
});
