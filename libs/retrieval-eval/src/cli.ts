import { parseArgs } from 'node:util';

import { baselineDataset, type Dataset } from './dataset.js';
import { runEvaluation } from './runner.js';
import { readJson, workspacePath } from './storage.js';
const { values } = parseArgs({
  options: { dataset: { type: 'string' }, workspace: { type: 'string' } },
});
const dataset = values.dataset
  ? await readJson<Dataset>(values.dataset)
  : baselineDataset();
const result = await runEvaluation(
  dataset,
  workspacePath('themoltnet', values.workspace),
);
process.stdout.write(
  JSON.stringify({
    run: result.id,
    status: result.status,
    searches: result.rankings.length,
  }) + '\n',
);
