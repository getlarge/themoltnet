import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { resolveRepoRoot } from '../repo.js';
import { loadScenarioCatalog } from './catalog.js';
import { executeCommand } from './command.js';
import { DockerSandboxAdapter } from './docker-sandbox-adapter.js';
import { runAdapterProbe } from './runner.js';
import { sanitizeProbeRunForPersistence } from './sanitize.js';
import type { SandboxProbeRun } from './types.js';

const revision = await executeCommand('git', ['rev-parse', 'HEAD']);
if (revision.exitCode !== 0) throw new Error(revision.stderr);

const probeRoot = await mkdtemp(path.join(os.tmpdir(), 'moltnet-sbx-1972-'));
const runId = `${Date.now()}-${process.pid}`;
const appName = process.env.MOLTNET_DOCKER_SANDBOX_APP_NAME;
if (!appName) {
  throw new Error(
    'MOLTNET_DOCKER_SANDBOX_APP_NAME is required for an isolated Docker Sandbox daemon',
  );
}
const adapter = new DockerSandboxAdapter({ appName });
const catalog = await loadScenarioCatalog();
let interruptedBy: NodeJS.Signals | undefined;
let interruptCleanup: ReturnType<DockerSandboxAdapter['close']> | undefined;
const interrupt = (signal: NodeJS.Signals): void => {
  interruptedBy = signal;
  process.exitCode = signal === 'SIGINT' ? 130 : 143;
  interruptCleanup ??= adapter.close();
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
    process.stderr.write(
      `[sandbox-policy] interrupted by ${interruptedBy}; evidence was not persisted\n`,
    );
  } else {
    const outputDirectory = path.join(
      await resolveRepoRoot(),
      'tools/test-fixtures/sandbox-policy/observed/docker-sandbox',
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
    const persistedRun = JSON.parse(persisted) as SandboxProbeRun;
    await writeFile(temporaryOutputPath, persisted);
    await rename(temporaryOutputPath, outputPath);
    temporaryOutputPath = undefined;
    process.stdout.write(`${outputPath}\n`);
    process.exitCode =
      persistedRun.violations.length > 0 ||
      !persistedRun.cleanupComplete ||
      persistedRun.controls.some(
        (control) =>
          control.requestedIntent.required &&
          (control.state === 'failed' || control.state === 'failed-open'),
      )
        ? 1
        : 0;
  }
} finally {
  process.removeListener('SIGINT', onSigint);
  process.removeListener('SIGTERM', onSigterm);
  if (temporaryOutputPath) await rm(temporaryOutputPath, { force: true });
  await interruptCleanup;
}
