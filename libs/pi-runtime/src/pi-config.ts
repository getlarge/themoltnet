/** Node-only writer used by daemon serve runs and live evals. */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface WritePiProviderInput {
  /** Pi provider API kind, e.g. `openai-completions`. */
  api: string;
  /** Provider base URL. */
  baseUrl: string;
  /** Model ids exposed by this provider. */
  models: readonly string[];
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
  baseUrl?: never;
  apiKeyEnvRef?: never;
}

export type WritePiConfigInput =
  | WriteSingleProviderPiConfigInput
  | WriteMultiProviderPiConfigInput;

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
            models: provider.models.map((id) => ({ id })),
          },
        ]),
      )
    : {
        [input.provider]: {
          api: 'openai-completions',
          apiKey: input.apiKeyEnvRef ?? '$OLLAMA_API_KEY',
          baseUrl: input.baseUrl ?? 'https://ollama.com/v1',
          models: [{ id: input.model }],
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
