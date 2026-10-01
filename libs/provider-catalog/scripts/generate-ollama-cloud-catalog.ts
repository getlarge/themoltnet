import { readFile, writeFile } from 'node:fs/promises';

import { format } from 'prettier';

// Ollama Cloud's OpenAI-compatible model list. It is public (no API key) and
// returns the ids the `ollama-cloud` provider accepts at https://ollama.com/v1;
// local-proxy `:cloud` aliases never appear here.
const source = 'https://ollama.com/v1/models';
const output = new URL(
  '../src/ollama-cloud-models.generated.ts',
  import.meta.url,
);
const check = process.argv.includes('--check');

type ModelList = { data?: { id?: unknown }[] };

const response = await fetch(source);
if (!response.ok) {
  throw new Error(`GET ${source} failed: ${response.status}`);
}
const body = (await response.json()) as ModelList;
const ids = (body.data ?? [])
  .map((model) => model.id)
  .filter((id): id is string => typeof id === 'string' && id.length > 0)
  .sort((left, right) => left.localeCompare(right));
if (ids.length === 0) {
  throw new Error(`GET ${source} returned no models`);
}

const generated = await format(
  `// Generated from ${source} by the provider-catalog generator.\n// Do not edit manually. Regenerate with generate:ollama-cloud.\n\nexport const ollamaCloudModelIds: readonly string[] = ${JSON.stringify(ids, null, 2)};\n`,
  { parser: 'typescript', singleQuote: true, trailingComma: 'all' },
);
const previous = await readFile(output, 'utf8').catch(() => '');

if (check) {
  if (previous !== generated) {
    throw new Error(
      'Ollama Cloud catalog is stale. Run pnpm exec nx run @moltnet/provider-catalog:generate:ollama-cloud.',
    );
  }
} else {
  await writeFile(output, generated);
}
