/**
 * Shared helpers for writing the throwaway agent credentials and Pi
 * provider/model config a live eval run needs. Extracted verbatim (then
 * parameterized over provider/model) from
 * `apps/agent-daemon-e2e/src/live-ollama.e2e.test.ts` so the per-PR smoke test
 * and the nightly matrix runner share exactly one copy.
 *
 * Node-only (fs). Not imported by the pure reader/builder/gate path.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface WriteAgentCredentialsInput {
  /** Root under which `.moltnet/<agentName>/` is created. */
  agentRoot: string;
  agentName: string;
  clientId: string;
  clientSecret: string;
  /** REST API base URL the daemon talks to. */
  apiUrl: string;
}

/**
 * Write a throwaway `.moltnet/<agentName>/moltnet.json` + `env` for a live run.
 * The keypair fields are placeholders — the daemon authenticates via the
 * OAuth2 client credentials, not these keys.
 */
export function writeAgentCredentials(input: WriteAgentCredentialsInput): void {
  const agentDir = join(input.agentRoot, '.moltnet', input.agentName);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, 'moltnet.json'),
    JSON.stringify(
      {
        identity_id: randomUUID(),
        registered_at: new Date().toISOString(),
        oauth2: {
          client_id: input.clientId,
          client_secret: input.clientSecret,
        },
        keys: {
          public_key: 'ed25519:e2e',
          private_key: 'ed25519:e2e',
          fingerprint: 'E2E-AGENT-EVAL',
        },
        endpoints: {
          api: input.apiUrl,
          mcp: `${input.apiUrl}/mcp`,
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  writeFileSync(
    join(agentDir, 'env'),
    `MOLTNET_AGENT_NAME=${input.agentName}\n`,
    'utf8',
  );
}

export interface WritePiConfigInput {
  /** `PI_CODING_AGENT_DIR` — where `models.json` + `settings.json` land. */
  piDir: string;
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
  apiKeyRef?: string;
}

/**
 * Write a Pi `models.json` + `settings.json` pinned to a single provider/model
 * into `piDir`. The model is pinned deliberately: a live eval measures ONE
 * model per run so the score is attributable.
 */
export function writePiConfig(input: WritePiConfigInput): void {
  const baseUrl = input.baseUrl ?? 'https://ollama.com/v1';
  const apiKeyRef = input.apiKeyRef ?? '$OLLAMA_API_KEY';
  writeFileSync(
    join(input.piDir, 'models.json'),
    JSON.stringify(
      {
        providers: {
          [input.provider]: {
            api: 'openai-completions',
            apiKey: apiKeyRef,
            baseUrl,
            models: [{ id: input.model }],
          },
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  writeFileSync(
    join(input.piDir, 'settings.json'),
    JSON.stringify(
      {
        defaultModel: input.model,
        defaultProvider: input.provider,
        enableInstallTelemetry: false,
        enabledModels: [`${input.provider}/${input.model}`],
        packages: ['npm:@themoltnet/pi-extension'],
        transport: 'sse',
        treeFilterMode: 'default',
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}
