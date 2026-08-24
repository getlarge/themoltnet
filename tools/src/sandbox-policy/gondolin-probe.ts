import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadScenarioCatalog } from './catalog.js';
import { executeCommand } from './command.js';
import { GondolinAdapter } from './gondolin-adapter.js';
import { runAdapterProbe } from './runner.js';
import { sanitizeProbeRunForPersistence } from './sanitize.js';

const revision = await executeCommand('git', ['rev-parse', 'HEAD']);
if (revision.exitCode !== 0) throw new Error(revision.stderr);

const probeRoot = await mkdtemp(
  path.join(os.tmpdir(), 'moltnet-gondolin-1972-'),
);
const runId = `${Date.now()}-${process.pid}`;
const adapter = new GondolinAdapter();
const catalog = await loadScenarioCatalog();
let interruptedBy: NodeJS.Signals | undefined;
const interrupt = (signal: NodeJS.Signals): void => {
  interruptedBy = signal;
  process.exitCode = signal === 'SIGINT' ? 130 : 143;
  void adapter.close();
};
const onSigint = (): void => interrupt('SIGINT');
const onSigterm = (): void => interrupt('SIGTERM');
process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);

let temporaryOutputPath: string | undefined;
try {
  const run = await runAdapterProbe({
    adapter,
    catalog,
    runId,
    sourceRevision: revision.stdout.trim(),
    probeRoot,
  });
  if (interruptedBy) {
    throw new Error(`Gondolin probe interrupted by ${interruptedBy}`);
  }

  const outputDirectory = path.resolve(
    'tools/test-fixtures/sandbox-policy/observed/gondolin',
  );
  await mkdir(outputDirectory, { recursive: true });
  const platform = `${run.backend.version}-${run.backend.os}-${run.backend.architecture}`;
  const outputPath = path.join(outputDirectory, `${platform}.json`);
  temporaryOutputPath = `${outputPath}.tmp-${process.pid}`;
  const persisted = sanitizeProbeRunForPersistence(run, {
    machinePaths: [probeRoot],
    sensitiveValues: adapter.sensitiveValues(),
    replacements: { [runId]: '<run-id>' },
  });
  await writeFile(temporaryOutputPath, persisted);
  await rename(temporaryOutputPath, outputPath);
  temporaryOutputPath = undefined;
  process.stdout.write(`${outputPath}\n`);
} finally {
  process.removeListener('SIGINT', onSigint);
  process.removeListener('SIGTERM', onSigterm);
  if (temporaryOutputPath) await rm(temporaryOutputPath, { force: true });
}
