import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { containsSecretInText } from '@moltnet/secret-scanner';

import type { Dataset } from '../dataset.js';
import { readJson, saveImmutableJson, workspacePath } from '../storage.js';
import { type CorpusManifest, prepareCorpus } from './potato-corpus.js';
import { WorkspaceStore } from './workspace.js';

const { values } = parseArgs({
  options: {
    'potato-items': { type: 'string' },
    'potato-manifest': { type: 'string' },
    annotations: { type: 'string' },
    reviewer: { type: 'string' },
    output: { type: 'string' },
    apply: { type: 'boolean' },
    workspace: { type: 'string' },
    init: { type: 'boolean' },
    import: { type: 'string' },
    'source-map': { type: 'string' },
    action: { type: 'string' },
    revision: { type: 'string' },
    freeze: { type: 'boolean' },
  },
});
const store = new WorkspaceStore(workspacePath('themoltnet', values.workspace));
if (
  [
    values.init,
    values.import,
    values.action,
    values.freeze,
    values['potato-items'],
    values['potato-manifest'],
  ].filter(Boolean).length > 1
)
  throw new Error('Choose one workspace operation');
if (values.action || values.freeze || values['potato-manifest']) {
  if (values.revision === undefined || !/^\d+$/.test(values.revision))
    throw new Error('A non-negative --revision is required');
}
if (values.apply && !values['potato-manifest'])
  throw new Error('--apply requires --potato-manifest');
if (values['potato-items']) {
  if (!values.output) throw new Error('Preparation requires --output');
  const manifest = prepareCorpus(
    (await store.read()).dataset,
    await readFile(values['potato-items'], 'utf8'),
  );
  if (await containsSecretInText(JSON.stringify(manifest)))
    throw new Error('Secret scan blocked manifest export');
  await saveImmutableJson(values.output, manifest);
  process.stdout.write(`${values.output}\n`);
} else if (values['potato-manifest']) {
  if (!values.annotations || !values.reviewer)
    throw new Error('Import requires --annotations and --reviewer');
  const receipt = await store.importCorpus(
    Number(values.revision),
    await readJson<CorpusManifest>(values['potato-manifest']),
    await readFile(values.annotations, 'utf8'),
    values.reviewer,
    values.apply,
  );
  process.stdout.write(JSON.stringify(receipt) + '\n');
}
if (values.init) await store.synthetic();
if (values.import)
  await store.initialize(
    await readJson<Dataset>(values.import),
    values['source-map']
      ? await readJson<Record<string, string>>(values['source-map'])
      : {},
  );
if (values.action)
  await store.mutate(
    Number(values.revision),
    await readJson<Record<string, unknown>>(values.action),
  );
if (values.freeze) {
  const result = await store.freeze(Number(values.revision));
  process.stdout.write(`${result.path}\n`);
} else {
  const workspace = await store.read();
  process.stdout.write(
    JSON.stringify({
      revision: workspace.revision,
      entries: workspace.dataset.entries.length,
      queries: workspace.dataset.queries.length,
      judgments: workspace.dataset.judgments.length,
    }) + '\n',
  );
}
