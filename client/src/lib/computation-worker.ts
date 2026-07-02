/**
 * Computation worker manager.
 * Manages a WebWorker for heavy computations with automatic fallback
 * to main-thread execution when workers are unavailable.
 */

import { executeTask } from '@shared/computation';
import type {
  ComputationTask,
  ComputationRequest,
  ComputationResponse,
} from '@shared/computation';

type PendingResolve = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

let worker: Worker | null = null;
let workerFailed = false;
let idCounter = 0;
const pending = new Map<string, PendingResolve>();

function getWorker(): Worker | null {
  if (workerFailed) return null;
  if (worker) return worker;

  try {
    worker = new Worker(
      new URL('../workers/computation.worker.ts', import.meta.url),
      { type: 'module' },
    );

    worker.onmessage = (event: MessageEvent<ComputationResponse>) => {
      const { id, result, error } = event.data;
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);

      if (error) {
        entry.reject(new Error(error));
      } else {
        entry.resolve(result);
      }
    };

    worker.onerror = () => {
      // Worker failed to load — fall back to main thread for all future calls
      workerFailed = true;
      worker = null;
      // Reject all pending tasks so they can be retried on main thread
      for (const [id, entry] of pending) {
        pending.delete(id);
        entry.reject(new Error('Worker failed'));
      }
    };

    return worker;
  } catch {
    workerFailed = true;
    return null;
  }
}

function runOnMainThread<T>(task: ComputationTask): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      const result = executeTask(task);
      resolve(result as T);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * Run a computation task. Uses WebWorker if available, falls back to main thread.
 */
export async function runComputation<T = unknown>(task: ComputationTask): Promise<T> {
  const w = getWorker();

  if (!w) {
    return runOnMainThread<T>(task);
  }

  const id = String(++idCounter);

  return new Promise<T>((resolve, reject) => {
    pending.set(id, {
      resolve: resolve as (result: unknown) => void,
      reject,
    });

    const request: ComputationRequest = { id, task };
    w.postMessage(request);
  });
}

/**
 * Returns true if computations are running in a WebWorker (not main thread).
 */
export function isUsingWorker(): boolean {
  return !workerFailed && typeof Worker !== 'undefined';
}

/**
 * Terminate the worker. Useful for cleanup.
 */
export function terminateWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  for (const [id, entry] of pending) {
    pending.delete(id);
    entry.reject(new Error('Worker terminated'));
  }
}
