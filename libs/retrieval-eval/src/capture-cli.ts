import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs, promisify } from 'node:util';

import { sampleEntries, type SourceEntry } from './capture.js';
import { type Dataset, entryHash } from './dataset.js';
import { hash } from './hash.js';
import { clean, WorkspaceStore } from './review/workspace.js';
import { saveImmutableJson, workspacePath } from './storage.js';

const { values } = parseArgs({
  options: {
    diary: { type: 'string' },
    workspace: { type: 'string' },
    seed: { type: 'string' },
    size: { type: 'string', default: '300' },
  },
});
if (!values.diary || !values.workspace || !values.seed)
  throw new Error('--diary, --workspace and --seed are required');
const execute = promisify(execFile);
const entries: SourceEntry[] = [];
let total: number | undefined;
const capturedAt = new Date().toISOString();
for (let offset = 0; total === undefined || offset < total; ) {
  const { stdout } = await execute(
    'moltnet',
    [
      'entry',
      'list',
      '--diary-id',
      values.diary,
      '--limit',
      '100',
      '--offset',
      String(offset),
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  const page = JSON.parse(stdout) as { items: SourceEntry[]; total: number };
  if (
    !Number.isSafeInteger(page.total) ||
    page.total < 0 ||
    !Array.isArray(page.items)
  )
    throw new Error('Invalid source pagination');
  if (total !== undefined && page.total !== total)
    throw new Error(
      'Population changed during capture; retry with a new workspace',
    );
  total = page.total;
  if (!page.items.length && offset < total)
    throw new Error('Incomplete source pagination');
  entries.push(...page.items);
  offset += page.items.length;
  process.stderr.write(`Enumerated ${entries.length}/${total}\n`);
}
if (entries.length !== total) throw new Error('Population count mismatch');
const sampled = sampleEntries(entries, Number(values.size), values.seed);
const version = `diary-capture-${capturedAt.replaceAll(/[:.]/g, '-')}`;
const sourceMap: Record<string, string> = {};
const copies: Dataset['entries'] = [];
for (const source of sampled) {
  const id = `entry-${hash([version, source.id]).slice(0, 20)}`;
  const entry = {
    id,
    title: await clean(source.title ?? ''),
    content: await clean(source.content),
    tags: await Promise.all((source.tags ?? []).map(clean)),
    importance: source.importance,
    createdAt: source.createdAt,
  };
  copies.push({ ...entry, contentHash: entryHash(entry) });
  sourceMap[id] = source.id;
}
const dataset: Dataset = {
  schemaVersion: 1,
  version,
  labelRevision: 0,
  capturedAt,
  timePolicy: 'relative-capture-v1',
  provenance: {
    description:
      'Fresh sanitized diary derivatives using the recovered sampling recipe; not a recovery of the missing snapshot. Pagination is not a transactional snapshot. Original signatures do not apply.',
    sampling: {
      strategy: 'seeded-round-robin-type-primary-scope-quarter',
      populationSize: total,
      sampleSize: copies.length,
      captureVersion: version,
      seed: values.seed,
    },
  },
  entries: copies,
  queries: [],
  judgments: [],
};
await new WorkspaceStore(
  workspacePath('themoltnet', values.workspace),
).initialize(dataset, sourceMap);
await saveImmutableJson(
  join(workspacePath('themoltnet', values.workspace), 'capture.json'),
  {
    diaryId: values.diary,
    capturedAt,
    completedAt: new Date().toISOString(),
    datasetHash: hash(dataset),
    sampling: dataset.provenance.sampling,
    recipeHash: hash(
      await readFile(new URL('./capture.ts', import.meta.url), 'utf8'),
    ),
  },
);
process.stdout.write(
  JSON.stringify({
    version,
    population: total,
    sampled: copies.length,
    approved: 0,
  }) + '\n',
);
