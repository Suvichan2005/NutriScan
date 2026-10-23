/** Observe a browser read without allowing a slow store to block the app indefinitely. */
export function observeAsyncRead<T>(
  read: () => Promise<T>,
  timeoutMs: number,
  handlers: {
    onTimeout: () => void;
    onValue: (value: T) => void;
    onError: (error: unknown) => void;
  },
): () => void {
  let active = true;
  let settled = false;
  const timer = setTimeout(() => {
    if (active && !settled) handlers.onTimeout();
  }, timeoutMs);

  void Promise.resolve().then(read).then(value => {
    if (!active) return;
    settled = true;
    clearTimeout(timer);
    handlers.onValue(value);
  }, error => {
    if (!active) return;
    settled = true;
    clearTimeout(timer);
    handlers.onError(error);
  });

  return () => {
    active = false;
    clearTimeout(timer);
  };
}
