/* eslint-disable no-console */
import { parseArgs } from 'node:util';

import {
  writeCompiledPack,
  type WriteCompiledPackOptions,
} from '@moltnet/context-evals';

function csv(value: unknown): string[] | undefined {
  return typeof value === 'string'
    ? value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
    : undefined;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    allowPositionals: false,
    options: {
      'diary-id': { type: 'string' },
      'token-budget': { type: 'string', default: '4000' },
      'task-prompt': { type: 'string' },
      'include-tags': { type: 'string' },
      'exclude-tags': { type: 'string' },
      lambda: { type: 'string' },
      'w-recency': { type: 'string' },
      'w-importance': { type: 'string' },
      'model-tag': { type: 'string', default: 'manual' },
      'out-dir': { type: 'string' },
      out: { type: 'string' },
      'meta-out': { type: 'string' },
    },
    strict: false,
  });

  const diaryId =
    typeof values['diary-id'] === 'string' ? values['diary-id'] : '';
  if (!diaryId) {
    throw new Error('Pass --diary-id explicitly');
  }

  const options: WriteCompiledPackOptions = {
    diaryId,
    tokenBudget: parseInt(String(values['token-budget'] ?? '4000'), 10),
    taskPrompt:
      typeof values['task-prompt'] === 'string'
        ? values['task-prompt']
        : undefined,
    includeTags: csv(values['include-tags']),
    excludeTags: csv(values['exclude-tags']),
    lambda:
      typeof values['lambda'] === 'string'
        ? Number(values['lambda'])
        : undefined,
    wRecency:
      typeof values['w-recency'] === 'string'
        ? Number(values['w-recency'])
        : undefined,
    wImportance:
      typeof values['w-importance'] === 'string'
        ? Number(values['w-importance'])
        : undefined,
    modelTag:
      typeof values['model-tag'] === 'string' ? values['model-tag'] : 'manual',
    outputDir:
      typeof values['out-dir'] === 'string' ? values['out-dir'] : undefined,
    outputPath: typeof values['out'] === 'string' ? values['out'] : undefined,
    metadataPath:
      typeof values['meta-out'] === 'string' ? values['meta-out'] : undefined,
  };

  const result = await writeCompiledPack(options);

  console.log(`[compile-pack] wrote ${result.outputPath}`);
  console.log(`[compile-pack] wrote ${result.metadataPath}`);
  console.log(
    `[compile-pack] source entries: ${result.metadata.source_entry_ids.length}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
