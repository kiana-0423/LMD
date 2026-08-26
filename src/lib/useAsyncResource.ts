import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One asynchronous read, with everything a page needs to render it honestly.
 *
 * Pages used to write `useEffect(() => { load().then(setState) }, [])`. Three things go wrong with
 * that, and all three were happening:
 *
 *   * A rejection has no handler, so a backend failure becomes an unhandled promise rejection and
 *     the page renders an empty table — indistinguishable from an empty workspace.
 *   * A response that arrives after the component unmounted still calls `setState`.
 *   * Two overlapping loads can resolve out of order, so a stale response overwrites a newer one.
 *     Typing in a search box is enough to produce this.
 *
 * `reload` is stable, so it can be called from an event handler or listed in a dependency array
 * without re-triggering the effect that owns it.
 */
export type AsyncResource<T> = {
  data: T | undefined;
  loading: boolean;
  /** The rejection value, untouched, so a caller can read its code. */
  error: unknown;
  /** Runs the loader again. Safe to call while one is already running. */
  reload: () => void;
};

export function useAsyncResource<T>(
  load: () => Promise<T>,
  dependencies: unknown[] = []
): AsyncResource<T> {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);

  // Identifies the most recent request. A response whose number is not the current one is stale
  // and is dropped rather than applied.
  const requestRef = useRef(0);
  const mountedRef = useRef(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const request = (requestRef.current += 1);
    setLoading(true);
    setError(undefined);

    loadRef
      .current()
      .then((value) => {
        if (!mountedRef.current || request !== requestRef.current) return;
        setData(value);
      })
      .catch((reason: unknown) => {
        if (!mountedRef.current || request !== requestRef.current) return;
        // Kept, not logged and discarded: the page shows it, with a retry beside it.
        setError(reason);
      })
      .finally(() => {
        if (!mountedRef.current || request !== requestRef.current) return;
        setLoading(false);
      });
    // `load` is read through a ref so an inline arrow function does not re-trigger this on every
    // render; the caller's dependency list is what decides when to re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, ...dependencies]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  return { data, loading, error, reload };
}

/** What a write reports back while it is running and after it finishes. */
export type AsyncAction<A extends unknown[]> = {
  run: (...args: A) => Promise<void>;
  running: boolean;
  error: unknown;
  /** Clears a failure once the user has seen it. */
  dismiss: () => void;
};

/**
 * One asynchronous write, with the refresh that has to follow it.
 *
 * A write that succeeds and leaves the table showing pre-write data is a write the user cannot
 * confirm happened. `onDone` is called after a successful run and is where the page reloads
 * whatever the write changed.
 */
export function useAsyncAction<A extends unknown[]>(
  perform: (...args: A) => Promise<unknown>,
  options: { onDone?: () => void; onError?: (error: unknown) => void } = {}
): AsyncAction<A> {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>();
  const mountedRef = useRef(true);
  const performRef = useRef(perform);
  performRef.current = perform;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (...args: A) => {
    setRunning(true);
    setError(undefined);
    try {
      await performRef.current(...args);
      if (mountedRef.current) optionsRef.current.onDone?.();
    } catch (reason: unknown) {
      // Never rethrown: an unhandled rejection from a click handler is invisible to the user and
      // noisy in the console. The caller reads `error`, or is told through `onError`.
      if (mountedRef.current) setError(reason);
      optionsRef.current.onError?.(reason);
    } finally {
      if (mountedRef.current) setRunning(false);
    }
  }, []);

  const dismiss = useCallback(() => setError(undefined), []);

  return { run, running, error, dismiss };
}
