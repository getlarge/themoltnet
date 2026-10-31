/** Node-only writer used by daemon serve runs and live evals. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ollamaCloudModelData } from '@moltnet/provider-catalog';
import { type Static, Type } from 'typebox';

export const PiModelCostSchema = Type.Object(
  {
    input: Type.Number({ minimum: 0 }),
    output: Type.Number({ minimum: 0 }),
    cacheRead: Type.Number({ minimum: 0 }),
    cacheWrite: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type PiModelCost = Static<typeof PiModelCostSchema>;

/** Provider configuration accepts finite, nonnegative USD rates. */
export function isPiModelCost(value: unknown): value is PiModelCost {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const rates = value as Record<string, unknown>;
  return ['input', 'output', 'cacheRead', 'cacheWrite'].every(
    (key) =>
      typeof rates[key] === 'number' &&
      Number.isFinite(rates[key]) &&
      rates[key] >= 0,
  );
}

const ollamaModels = new Map(
  ollamaCloudModelData.map((model) => [model.id, model]),
);

/**
 * Every input modality Pi understands. Canonical for the repo: daemon
 * validation, CLI parsing and wire schemas derive their allowed values from
 * this list so they cannot drift from what Pi actually accepts.
 */
export const PI_MODEL_MODALITIES = ['text', 'image'] as const;
export const PI_CLASSIFIER_APIS = [
  'typesafe-system-one',
  'cloudflare-workers-ai-system-one',
  'llama-cpp-classify',
  'openai-decisions',
] as const;
export type PiClassifierApi = (typeof PI_CLASSIFIER_APIS)[number];
/** Default for existing declarations without a per-model API. */
export const PI_CLASSIFIER_API = PI_CLASSIFIER_APIS[0];
export function isPiClassifierApi(api: string): api is PiClassifierApi {
  return PI_CLASSIFIER_APIS.some((supported) => supported === api);
}

/** Input modalities Pi understands for a model entry. */
export type PiModelModality = (typeof PI_MODEL_MODALITIES)[number];

/**
 * A typed model declaration in the generated `models.json`. `input` declares
 * the modalities the model accepts. Pi treats an entry with no `input` as text-only, so a vision
 * model must declare `['text', 'image']` or image content parts never reach
 * the provider.
 */
export interface PiModelSpec {
  id: string;
  /** USD per million tokens; explicit rates override generated defaults. */
  cost?: PiModelCost;
  type?: 'chat' | 'classifier';
  api?: string;
  contextWindow?: number;
  input?: readonly PiModelModality[];
  reasoning?: boolean;
  thinkingLevelMap?: Readonly<Record<string, string>>;
  /** Explicit provider claim that strict JSON-schema function tools work. */
  supportsStrictMode?: boolean;
}

/** Serialized model declaration registered through Pi's native provider API. */
interface PiStoredModelSpec extends Omit<PiModelSpec, 'supportsStrictMode'> {
  compat?: { supportsStrictMode: boolean };
}

export interface WritePiProviderInput {
  /** Pi provider API kind, e.g. `openai-completions`. */
  api: string;
  /** Provider base URL. */
  baseUrl: string;
  /** Models exposed by this provider. */
  models: readonly PiModelSpec[];
  /** Optional Pi environment placeholder, e.g. `$OLLAMA_API_KEY`. */
  apiKeyEnvRef?: string;
  /** Whether this provider accepts the developer message role. */
  supportsDeveloperRole?: boolean;
}

interface WritePiConfigBase {
  /** `PI_CODING_AGENT_DIR` — where `models.json` + `settings.json` land. */
  piDir: string;
  /** Overrides or extends the generated settings document. */
  settings?: Readonly<Record<string, unknown>>;
}

export interface WriteSingleProviderPiConfigInput extends WritePiConfigBase {
  /** Pi provider id, e.g. `ollama-cloud`. */
  provider: string;
  /** Pi model id, e.g. `qwen3-coder:480b-cloud`. */
  model: string;
  cost?: PiModelCost;
  /** Input modalities for `model`. Omitted leaves Pi's text-only default. */
  input?: readonly PiModelModality[];
  /**
   * OpenAI-completions base URL for the provider. Defaults to Ollama Cloud.
   */
  baseUrl?: string;
  /**
   * Env-var reference (with `$`) holding the provider API key. Defaults to
   * `$OLLAMA_API_KEY`.
   */
  apiKeyEnvRef?: string;
  /** Explicit provider claim that strict JSON-schema function tools work. */
  supportsStrictMode?: boolean;
  /** Whether this provider accepts the developer message role. */
  supportsDeveloperRole?: boolean;
  providers?: never;
}

export interface WriteMultiProviderPiConfigInput extends WritePiConfigBase {
  /** Provider registry keyed by Pi provider id. */
  providers: Readonly<Record<string, WritePiProviderInput>>;
  provider?: never;
  model?: never;
  input?: never;
  baseUrl?: never;
  apiKeyEnvRef?: never;
}

export type WritePiConfigInput =
  | WriteSingleProviderPiConfigInput
  | WriteMultiProviderPiConfigInput;

/**
 * Keep model types explicit in the generated catalog. Legacy declarations
 * without a type are chat; capabilities are emitted only when declared.
 */
function toPiModel(entry: PiModelSpec, baseUrl: string): PiStoredModelSpec {
  const endpoint = new URL(baseUrl);
  const cloudModel =
    endpoint.origin === 'https://ollama.com' &&
    endpoint.pathname.replace(/\/$/, '') === '/v1'
      ? ollamaModels.get(entry.id)
      : undefined;
  // A classifier is priced by its input-only rate, a chat model by its full
  // rate; neither falls back to the other.
  const cloudCost =
    entry.type === 'classifier' ? cloudModel?.classifierCost : cloudModel?.cost;
  const cost = entry.cost ?? cloudCost;
  return {
    id: entry.id,
    ...(cost ? { cost: { ...cost } } : {}),
    type: entry.type ?? 'chat',
    ...(entry.api ? { api: entry.api } : {}),
    ...(entry.contextWindow !== undefined
      ? { contextWindow: entry.contextWindow }
      : {}),
    ...(entry.input && entry.input.length > 0
      ? { input: [...entry.input] }
      : {}),
    ...(entry.reasoning !== undefined ? { reasoning: entry.reasoning } : {}),
    ...(entry.thinkingLevelMap
      ? { thinkingLevelMap: { ...entry.thinkingLevelMap } }
      : {}),
    ...(entry.supportsStrictMode !== undefined
      ? { compat: { supportsStrictMode: entry.supportsStrictMode } }
      : {}),
  };
}

/**
 * Write Pi `models.json` + `settings.json`. Eval callers use the single-provider
 * form so scores stay attributable; serve callers may supply many providers.
 */
export function writePiConfig(input: WritePiConfigInput): void {
  const multiProvider = 'providers' in input && input.providers !== undefined;
  const providers = multiProvider
    ? Object.fromEntries(
        Object.entries(input.providers).map(([id, provider]) => [
          id,
          {
            api: provider.api,
            ...(provider.apiKeyEnvRef ? { apiKey: provider.apiKeyEnvRef } : {}),
            baseUrl: provider.baseUrl,
            ...(provider.supportsDeveloperRole !== undefined
              ? {
                  compat: {
                    supportsDeveloperRole: provider.supportsDeveloperRole,
                  },
                }
              : {}),
            models: provider.models.map((model) =>
              toPiModel(model, provider.baseUrl),
            ),
          },
        ]),
      )
    : {
        [input.provider]: {
          api: 'openai-completions',
          apiKey: input.apiKeyEnvRef ?? '$OLLAMA_API_KEY',
          baseUrl: input.baseUrl ?? 'https://ollama.com/v1',
          ...(input.supportsDeveloperRole !== undefined
            ? {
                compat: {
                  supportsDeveloperRole: input.supportsDeveloperRole,
                },
              }
            : {}),
          models: [
            toPiModel(
              {
                id: input.model,
                cost: input.cost,
                input: input.input,
                supportsStrictMode: input.supportsStrictMode,
              },
              input.baseUrl ?? 'https://ollama.com/v1',
            ),
          ],
        },
      };
  writeFileSync(
    join(input.piDir, 'models.json'),
    JSON.stringify({ providers }, null, 2) + '\n',
    'utf8',
  );
  const defaultSettings = multiProvider
    ? { enableInstallTelemetry: false }
    : {
        defaultModel: input.model,
        defaultProvider: input.provider,
        enableInstallTelemetry: false,
        enabledModels: [`${input.provider}/${input.model}`],
        packages: ['npm:@themoltnet/pi-extension'],
        transport: 'sse',
        treeFilterMode: 'default',
      };
  writeFileSync(
    join(input.piDir, 'settings.json'),
    JSON.stringify({ ...defaultSettings, ...input.settings }, null, 2) + '\n',
    'utf8',
  );
}
