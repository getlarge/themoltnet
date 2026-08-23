import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadScenarioCatalog } from './catalog.js';
import { executeCommand } from './command.js';
import { DockerSandboxAdapter } from './docker-sandbox-adapter.js';
import { runAdapterProbe } from './runner.js';
import { sanitizeForPersistence } from './sanitize.js';

const revision = await executeCommand('git', ['rev-parse', 'HEAD']);
if (revision.exitCode !== 0) throw new Error(revision.stderr);

const probeRoot = await mkdtemp(path.join(os.tmpdir(), 'moltnet-sbx-1972-'));
const runId = `${Date.now()}-${process.pid}`;
const credential = `probe-${crypto.randomUUID()}`;
const rotatedCredential = `probe-rotated-${crypto.randomUUID()}`;
const adapter = new DockerSandboxAdapter({
  fixtureCredential: credential,
  rotatedCredential,
});
const catalog = await loadScenarioCatalog();
const run = await runAdapterProbe({
  adapter,
  catalog,
  runId,
  sourceRevision: revision.stdout.trim(),
  probeRoot,
});

const outputDirectory = path.resolve(
  'tools/test-fixtures/sandbox-policy/observed/docker-sandbox',
);
await mkdir(outputDirectory, { recursive: true });
const platform = `${run.backend.version}-${run.backend.os}-${run.backend.architecture}`;
const outputPath = path.join(outputDirectory, `${platform}.json`);
const persisted = sanitizeForPersistence(run, {
  machinePaths: [probeRoot],
  sensitiveValues: [credential, rotatedCredential],
  replacements: { [runId]: '<run-id>' },
});
await writeFile(outputPath, persisted);
process.stdout.write(`${outputPath}\n`);
