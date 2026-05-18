/**
 * Global limit for concurrent vision inference (esp. local vLLM + multi-camera).
 */

import { getVisionConcurrencyLimit } from './visionModels.js';

let active = 0;
const waiters: Array<() => void> = [];

function acquire(): Promise<void> {
  return new Promise((resolve) => {
    const attempt = () => {
      const limit = getVisionConcurrencyLimit();
      if (active < limit) {
        active++;
        resolve();
      } else {
        waiters.push(attempt);
      }
    };
    attempt();
  });
}

function release(): void {
  active--;
  const next = waiters.shift();
  if (next) next();
}

/**
 * Run `fn` while holding a slot in the global vision concurrency pool.
 */
export async function withVisionConcurrency<T>(fn: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await fn();
  } finally {
    release();
  }
}
