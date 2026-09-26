import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format } from 'prettier';

const output = new URL(
  '../src/pi-runtime-models.generated.ts',
  import.meta.url,
);
const check = process.argv.includes('--check');
const packageRoot = dirname(
  fileURLToPath(import.meta.resolve('@earendil-works/pi-ai')),
);

type PiModel = {
  id: string;
  name: string;
  api: string;
  reasoning: boolean;
  input: string[];
  contextWindow: number;
  maxTokens: number;
};

// Request fields supported by the Pi transport used for each static provider.
// Keep this explicit when adding a provider: model metadata alone does not
// describe which profile options its request endpoint accepts.
const requestOptionCapabilitiesByApi = {
  'anthropic-messages': {
    supportsTemperature: true,
    supportsTopP: true,
    supportsTopK: true,
    supportsMaxOutputTokens: true,
  },
  'openai-codex-responses': {
    supportsTemperature: false,
    supportsTopP: false,
    supportsTopK: false,
    supportsMaxOutputTokens: false,
  },
} as const;

function requestOptionsForApi(api: string) {
  const capabilities =
    requestOptionCapabilitiesByApi[
      api as keyof typeof requestOptionCapabilitiesByApi
    ];
  if (!capabilities) {
    throw new Error(`Request option capabilities are not reviewed for ${api}`);
  }
  return capabilities;
}

async function readProvider(provider: 'anthropic' | 'openai-codex') {
  const source = join(packageRoot, 'providers', 'data', `${provider}.json`);
  const catalog = JSON.parse(await readFile(source, 'utf8')) as Record<
    string,
    Record<string, PiModel>
  >;
  return Object.values(catalog)
    .flatMap((models) => Object.values(models))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((model) => ({
      provider,
      model: model.id,
      displayName: `${provider === 'anthropic' ? 'Anthropic' : 'OpenAI Codex'} · ${model.name}`,
      description: 'Generated from Pi static provider catalog.',
      capabilities: {
        supportsReasoning: model.reasoning,
        supportsVision: model.input.includes('image'),
        ...requestOptionsForApi(model.api),
        contextWindow: model.contextWindow,
        maxOutputTokens: model.maxTokens,
      },
    }));
}

const entries = [
  ...(await readProvider('anthropic')),
  ...(await readProvider('openai-codex')),
];
const generated = await format(
  `// Generated from Pi by the provider-catalog generator.\n// Do not edit manually.\nimport type { RuntimeModelCatalogEntry } from './types.js';\n\nexport const piRuntimeModels: readonly RuntimeModelCatalogEntry[] = ${JSON.stringify(entries, null, 2)};\n`,
  {
    parser: 'typescript',
    singleQuote: true,
    trailingComma: 'all',
  },
);
const previous = await readFile(output, 'utf8');

if (check) {
  if (previous !== generated) {
    throw new Error(
      'Pi runtime catalog is stale. Run pnpm --filter @moltnet/provider-catalog generate:pi.',
    );
  }
} else {
  await writeFile(output, generated);
}
