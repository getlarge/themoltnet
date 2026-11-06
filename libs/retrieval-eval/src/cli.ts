import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { baselineDataset, type Dataset } from './dataset.js';
import { hash } from './hash.js';
import { rescore } from './metrics.js';
import { type Run, runEvaluation } from './runner.js';
import { readJson, saveImmutableJson, workspacePath } from './storage.js';
const { values } = parseArgs({
  options: {
    dataset: { type: 'string' },
    workspace: { type: 'string' },
    rescore: { type: 'string' },
    'top-k': { type: 'string' },
    repeats: { type: 'string' },
  },
});
const dataset = values.dataset
  ? await readJson<Dataset>(values.dataset)
  : baselineDataset();
const root = workspacePath('themoltnet', values.workspace);
if (values.rescore) {
  const original = await readJson<Run>(values.rescore);
  const report = {
    originalRunId: original.id,
    dataset,
    results: rescore(original.dataset, dataset, original.rankings),
  };
  const output = join(root, 'reports', `${hash(report)}.json`);
  try {
    await saveImmutableJson(output, report);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  process.stdout.write(`${output}\n`);
} else {
  const result = await runEvaluation(dataset, root, {
    topKs:
      values['top-k'] === undefined ? undefined : [Number(values['top-k'])],
    repeats: values.repeats === undefined ? undefined : Number(values.repeats),
  });
  process.stdout.write(
    JSON.stringify({
      run: result.id,
      status: result.status,
      searches: result.rankings.length,
    }) + '\n',
  );
}
