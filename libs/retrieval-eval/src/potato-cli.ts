import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { containsSecretInText } from '@moltnet/secret-scanner';

import type { Dataset } from './dataset.js';
import { type Ranking, rescore } from './metrics.js';
import { importPotato, type PotatoManifest, preparePotato } from './potato.js';
import { readJson, saveImmutableJson } from './storage.js';

const { values } = parseArgs({
  options: {
    dataset: { type: 'string' },
    'full-corpus': { type: 'boolean' },
    run: { type: 'string' },
    manifest: { type: 'string' },
    annotations: { type: 'string' },
    reviewer: { type: 'string' },
    output: { type: 'string' },
  },
});
if (!values.dataset || !values.output)
  throw new Error('--dataset and --output are required');
const dataset = await readJson<Dataset>(values.dataset);
const run = values.run
  ? await readJson<{ dataset: Dataset; rankings: Ranking[] }>(values.run)
  : undefined;
const output = values.output;
async function saveChecked(value: unknown) {
  if (await containsSecretInText(JSON.stringify(value)))
    throw new Error('Secret scan blocked export');
  await saveImmutableJson(output, value);
}
if (values.annotations) {
  if (!values.manifest || !values.reviewer)
    throw new Error('Import requires --manifest and --reviewer');
  const result = importPotato(
    dataset,
    await readJson<PotatoManifest>(values.manifest),
    await readFile(values.annotations, 'utf8'),
    values.reviewer,
  );
  await saveChecked({
    ...result,
    results: run
      ? rescore(run.dataset, result.dataset, run.rankings)
      : undefined,
  });
} else {
  if (!run) throw new Error('Preparation requires --run');
  rescore(run.dataset, dataset, run.rankings); // Reject incompatible saved rankings.
  await saveChecked(
    preparePotato(dataset, run.rankings, values['full-corpus']),
  );
}
process.stdout.write(`${values.output}\n`);
