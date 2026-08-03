/**
 * React hook for running heavy computations via WebWorker.
 * Provides loading state, error handling, and automatic fallback.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { runComputation, isUsingWorker, terminateWorker } from '@/lib/computation-worker';
import type { ComputationTask } from '@contracts/computation';

interface UseComputationWorkerResult<T> {
  /** Execute a computation task */
  compute: (task: ComputationTask) => Promise<T>;
  /** The most recent result */
  data: T | null;
  /** Whether a computation is in progress */
  isPending: boolean;
  /** The most recent error */
  error: Error | null;
  /** Whether the worker is being used (vs main-thread fallback) */
  usingWorker: boolean;
  /** Reset state */
  reset: () => void;
}

export function useComputationWorker<T = unknown>(): UseComputationWorkerResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const compute = useCallback(async (task: ComputationTask): Promise<T> => {
    setIsPending(true);
    setError(null);

    try {
      const result = await runComputation<T>(task);
      if (mountedRef.current) {
        setData(result);
        setIsPending(false);
      }
      return result;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      if (mountedRef.current) {
        setError(e);
        setIsPending(false);
      }
      throw e;
    }
  }, []);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setIsPending(false);
  }, []);

  return {
    compute,
    data,
    isPending,
    error,
    usingWorker: isUsingWorker(),
    reset,
  };
}

/** Cleanup hook - call on app unmount if desired */
export { terminateWorker };
