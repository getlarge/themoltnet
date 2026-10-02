import { readFile, writeFile } from 'node:fs/promises';

import { format } from 'prettier';

// Ollama Cloud's public endpoints (no API key): the OpenAI-compatible model
// list gives the ids the `ollama-cloud` provider accepts at
// https://ollama.com/v1 (no local-proxy `:cloud` aliases), and /api/show gives
// each model's capabilities, thinking levels, and context length.
const origin = 'https://ollama.com';
const output = new URL(
  '../src/ollama-cloud-models.generated.ts',
  import.meta.url,
);
const check = process.argv.includes('--check');
const SHOW_CONCURRENCY = 4;

type OllamaCloudModel = {
  id: string;
  contextWindow: number;
  vision: boolean;
  tools: boolean;
  /** Ollama thinking values: `off`/`on` for boolean, else named levels. */
  thinkingLevels?: string[];
  defaultThinkingLevel?: string;
};

type ShowResponse = {
  capabilities?: unknown;
  thinking?: { values?: unknown; default?: unknown };
  model_info?: Record<string, unknown>;
};

async function getJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${origin}${path}`, init);
  if (!response.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${path} failed: ${response.status}`,
    );
  }
  return response.json();
}

function thinkingLevel(value: unknown): string {
  if (value === false) return 'off';
  if (value === true) return 'on';
  if (typeof value === 'string' && /^[a-z]+$/.test(value)) return value;
  throw new Error(`unexpected Ollama thinking value ${JSON.stringify(value)}`);
}

async function describe(id: string): Promise<OllamaCloudModel> {
  const show = (await getJson('/api/show', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: id }),
  })) as ShowResponse;
  const capabilities = Array.isArray(show.capabilities)
    ? show.capabilities
    : [];
  const contextWindow = Object.entries(show.model_info ?? {}).find(([key]) =>
    key.endsWith('.context_length'),
  )?.[1];
  if (typeof contextWindow !== 'number') {
    throw new Error(`/api/show ${id} has no context_length`);
  }
  const model: OllamaCloudModel = {
    id,
    contextWindow,
    vision: capabilities.includes('vision'),
    tools: capabilities.includes('tools'),
  };
  if (!capabilities.includes('thinking')) return model;
  const values = Array.isArray(show.thinking?.values)
    ? show.thinking.values.map(thinkingLevel)
    : ['on'];
  const fallback = values.includes('off') ? 'off' : values[0];
  return {
    ...model,
    thinkingLevels: values,
    defaultThinkingLevel:
      show.thinking?.default === undefined
        ? fallback
        : thinkingLevel(show.thinking.default),
  };
}

const list = (await getJson('/v1/models')) as { data?: { id?: unknown }[] };
const ids = (list.data ?? [])
  .map((model) => model.id)
  .filter((id): id is string => typeof id === 'string' && id.length > 0)
  .sort((left, right) => left.localeCompare(right));
if (ids.length === 0) throw new Error('GET /v1/models returned no models');

const models: OllamaCloudModel[] = [];
for (let index = 0; index < ids.length; index += SHOW_CONCURRENCY) {
  models.push(
    ...(await Promise.all(
      ids.slice(index, index + SHOW_CONCURRENCY).map(describe),
    )),
  );
}

const generated = await format(
  `// Generated from ${origin}/v1/models and ${origin}/api/show by the\n// provider-catalog generator. Do not edit manually.\n// Regenerate with generate:ollama-cloud.\n\nexport type OllamaCloudModel = {\n  id: string;\n  contextWindow: number;\n  vision: boolean;\n  tools: boolean;\n  thinkingLevels?: readonly string[];\n  defaultThinkingLevel?: string;\n};\n\nexport const ollamaCloudModelData: readonly OllamaCloudModel[] = ${JSON.stringify(models, null, 2)};\n`,
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
