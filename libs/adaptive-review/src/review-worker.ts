/** Private worker guardian: IPC disconnect also handles an abruptly killed host. */
import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { stopProcessGroup } from './process-group.js';

for (const stream of [process.stdout, process.stderr])
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== 'EPIPE') throw error;
  });
const [binary, ...args] = process.argv.slice(2);
if (!binary) throw new Error('Worker binary required');
const child = spawn(binary, args, {
  stdio: ['ignore', 'inherit', 'inherit'],
  detached: process.platform !== 'win32',
});
let stopping: Promise<void> | undefined;
const stop = () => {
  stopping ??= (
    child.pid ? stopProcessGroup(child.pid) : Promise.resolve()
  ).finally(() => {
    process.exitCode = process.exitCode ?? 0;
    if (process.connected) process.disconnect();
  });
  return stopping;
};
process.once('disconnect', () => {
  void stop();
});
process.on('SIGTERM', () => {
  void stop();
});
process.on('SIGINT', () => {
  void stop();
});
child.once('spawn', () =>
  process.stderr.write(
    JSON.stringify({
      event: 'review.worker.started',
      pid: child.pid,
      guardianPid: process.pid,
    }) + '\n',
  ),
);
try {
  const [code, signal] = (await once(child, 'exit')) as [
    number | null,
    NodeJS.Signals | null,
  ];
  if (!stopping) {
    if (process.connected)
      process.send?.(
        { event: 'review.worker.exited', pid: child.pid, code, signal },
        () => {},
      );
    process.exitCode = code ?? (signal ? 1 : 0);
    await stop();
  } else await stopping;
} catch (error) {
  process.stderr.write(
    `Unable to start worker: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
  await stop();
}
