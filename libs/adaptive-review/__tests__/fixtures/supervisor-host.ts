import type { StandaloneReviewInput } from '../../src/standalone.js';
import { withReviewWorkers } from '../../src/supervisor.js';

const controller = new AbortController();
process.once('SIGTERM', () => controller.abort());
try {
  await withReviewWorkers({
    input: JSON.parse(
      process.env.REVIEW_INPUT ?? '{}',
    ) as StandaloneReviewInput,
    cwd: process.cwd(),
    env: process.env,
    binary: process.env.TEST_BINARY ?? '',
    agent: 'fixture',
    signal: controller.signal,
    run: async (signal, ensureCapacity) => {
      await ensureCapacity();
      process.send?.('STARTED');
      await new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('stopped')), {
          once: true,
        });
      });
    },
  });
} catch {
  /* Expected host cancellation. */
}
if (process.connected) process.disconnect();
