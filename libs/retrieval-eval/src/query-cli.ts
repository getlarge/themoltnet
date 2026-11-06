import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { containsSecretInText } from '@moltnet/secret-scanner';

import type { Dataset } from './dataset.js';
import { prepareQueryExperiment } from './query-drafts.js';
import { readJson, saveImmutableJson } from './storage.js';

const { values } = parseArgs({
  options: {
    dataset: { type: 'string' },
    queries: { type: 'string' },
    'dataset-version': { type: 'string' },
    output: { type: 'string' },
  },
});
if (
  !values.dataset ||
  !values.queries ||
  !values['dataset-version'] ||
  !values.output
)
  throw new Error(
    '--dataset, --queries, --dataset-version and --output are required',
  );
const result = prepareQueryExperiment(
  await readJson<Dataset>(values.dataset),
  await readJson<unknown>(values.queries),
  values['dataset-version'],
);
if (await containsSecretInText(JSON.stringify(result)))
  throw new Error('Secret scan blocked query experiment');
const output = resolve(values.output);
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await mkdir(output, { mode: 0o700 }); // Refuse to replace an existing experiment.
await saveImmutableJson(join(output, 'dataset.json'), result.dataset);
await saveImmutableJson(join(output, 'proposals.json'), result.proposals);
process.stdout.write(`${output}\n`);
