/** Node-only writer used by daemon serve runs and live evals. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every input modality Pi understands. Canonical for the repo: daemon
 * validation, CLI parsing and wire schemas derive their allowed values from
 * this list so they cannot drift from what Pi actually accepts.
 */
export const PI_MODEL_MODALITIES = ['text', 'image'] as const;

/** Input modalities Pi understands for a model entry. */
export type PiModelModality = (typeof PI_MODEL_MODALITIES)[number];

/**
 * A model entry in Pi's `models.json`. `input` declares the modalities the
 * model accepts. Pi treats an entry with no `input` as text-only, so a vision
 * model must declare `['text', 'image']` or image content parts never reach
 * the provider.
 */
export interface PiModelSpec {
  id: string;
  input?: readonly PiModelModality[];
}

/** Bare model id, or an entry declaring capabilities. */
export type PiModelEntry = string | PiModelSpec;

export interface WritePiProviderInput {
  /** Pi provider API kind, e.g. `openai-completions`. */
  api: string;
  /** Provider base URL. */
  baseUrl: string;
  /** Models exposed by this provider, as bare ids or capability entries. */
  models: readonly PiModelEntry[];
  /** Optional Pi environment placeholder, e.g. `$OLLAMA_API_KEY`. */
  apiKeyEnvRef?: string;
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
 * Normalise a model entry to Pi's on-disk shape. `input` is emitted only when
 * declared, so text-only entries keep their existing serialization.
 */
function toPiModel(entry: PiModelEntry): { id: string; input?: string[] } {
  if (typeof entry === 'string') return { id: entry };
  return {
    id: entry.id,
    ...(entry.input && entry.input.length > 0
      ? { input: [...entry.input] }
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
            models: provider.models.map(toPiModel),
          },
        ]),
      )
    : {
        [input.provider]: {
          api: 'openai-completions',
          apiKey: input.apiKeyEnvRef ?? '$OLLAMA_API_KEY',
          baseUrl: input.baseUrl ?? 'https://ollama.com/v1',
          models: [toPiModel({ id: input.model, input: input.input })],
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
