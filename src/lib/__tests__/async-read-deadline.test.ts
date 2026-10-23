import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeAsyncRead } from '../async-read-deadline';
import { chooseUntouchedStartupProfile } from '../profile-startup';
import { defaultProfile } from '../contracts';

describe('observeAsyncRead', () => {
  afterEach(() => vi.useRealTimers());

  it('applies a normal profile read without waiting for the deadline', async () => {
    const onTimeout = vi.fn();
    const onValue = vi.fn();
    const onError = vi.fn();

    observeAsyncRead(() => Promise.resolve('remembered profile'), 800, { onTimeout, onValue, onError });
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    expect(onValue).toHaveBeenCalledOnce();
    expect(onValue).toHaveBeenCalledWith('remembered profile');
    expect(onTimeout).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('accepts a delayed read that finishes before the startup deadline', async () => {
    vi.useFakeTimers();
    let resolveRead!: (value: string) => void;
    const read = new Promise<string>(resolve => { resolveRead = resolve; });
    const onTimeout = vi.fn();
    const onValue = vi.fn();
    const onError = vi.fn();

    observeAsyncRead(() => read, 800, { onTimeout, onValue, onError });
    await vi.advanceTimersByTimeAsync(650);
    resolveRead('remembered profile');
    await Promise.resolve();
    await Promise.resolve();

    expect(onValue).toHaveBeenCalledOnce();
    expect(onTimeout).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('releases the startup gate after a failed profile read', async () => {
    const failure = new Error('IndexedDB unavailable');
    const onTimeout = vi.fn();
    const onValue = vi.fn();
    const onError = vi.fn();

    observeAsyncRead(() => Promise.reject(failure), 800, { onTimeout, onValue, onError });
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(onValue).not.toHaveBeenCalled();
  });

  it('releases the startup gate on timeout and still delivers a late read', async () => {
    vi.useFakeTimers();
    let resolveRead!: (value: string) => void;
    const read = new Promise<string>(resolve => { resolveRead = resolve; });
    const onTimeout = vi.fn();
    const onValue = vi.fn();
    const onError = vi.fn();

    observeAsyncRead(() => read, 2500, { onTimeout, onValue, onError });
    await vi.advanceTimersByTimeAsync(2500);
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(onValue).not.toHaveBeenCalled();

    resolveRead('remembered profile');
    await Promise.resolve();
    await Promise.resolve();
    expect(onValue).toHaveBeenCalledWith('remembered profile');
    expect(onError).not.toHaveBeenCalled();
  });

  it('cancels pending callbacks when the owner unmounts', async () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const onValue = vi.fn();
    const onError = vi.fn();
    const stop = observeAsyncRead(() => new Promise<string>(() => {}), 2500, { onTimeout, onValue, onError });

    stop();
    await vi.advanceTimersByTimeAsync(2500);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(onValue).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});

describe('profile startup race handling', () => {
  it('does not apply a late saved profile over choices already edited in the tab', () => {
    const remembered = { ...defaultProfile, goals: 'Previously saved goal' };
    const currentSession = { ...defaultProfile, goals: 'Current user choice' };

    expect(chooseUntouchedStartupProfile(remembered, currentSession, true)).toBeUndefined();
  });

  it('prefers the remembered profile when the user has not started editing', () => {
    const remembered = { ...defaultProfile, goals: 'Saved goal' };
    const session = { ...defaultProfile, goals: 'Session goal' };

    expect(chooseUntouchedStartupProfile(remembered, session, false)).toEqual(remembered);
    expect(chooseUntouchedStartupProfile(null, session, false)).toEqual(session);
  });
});
