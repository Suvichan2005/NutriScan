import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeAsyncRead } from '../async-read-deadline';

describe('observeAsyncRead', () => {
  afterEach(() => vi.useRealTimers());

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
