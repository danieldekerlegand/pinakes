/**
 * WebWorker for heavy computations.
 * Offloads linguistic distance, correlation scoring, and other CPU-intensive
 * work from the main thread.
 */

import { executeTask } from '@contracts/computation';
import type { ComputationRequest, ComputationResponse } from '@contracts/computation';

self.onmessage = (event: MessageEvent<ComputationRequest>) => {
  const { id, task } = event.data;
  const start = performance.now();

  try {
    const result = executeTask(task);
    const response: ComputationResponse = {
      id,
      result,
      duration: performance.now() - start,
    };
    self.postMessage(response);
  } catch (err) {
    const response: ComputationResponse = {
      id,
      error: err instanceof Error ? err.message : String(err),
      duration: performance.now() - start,
    };
    self.postMessage(response);
  }
};
