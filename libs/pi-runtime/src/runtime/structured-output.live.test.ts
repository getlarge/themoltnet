/** Opt-in provider probe: run with MOLTNET_LIVE_STRUCTURED_* environment variables. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { getSubmitOutputContract } from '@themoltnet/agent-runtime';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';

import { readLiveStructuredOutputConfig } from '../config.js';
import { writePiConfig } from '../pi-config.js';

const { provider, api, baseUrl, modelId, apiKey } =
  readLiveStructuredOutputConfig();
const enabled = !!(provider && api && baseUrl && modelId && apiKey);

describe.skipIf(!enabled)('live structured tool output', () => {
  it('sends strict schema through Pi and receives a schema-valid tool call', async () => {
    const piDir = mkdtempSync(join(tmpdir(), 'moltnet-structured-live-'));
    const schema = Type.Object(
      { kind: Type.Literal('probe'), count: Type.Integer() },
      { additionalProperties: false },
    );
    let payload: unknown;
    try {
      writePiConfig({
        piDir,
        providers: {
          [provider!]: {
            api: api!,
            baseUrl: baseUrl!,
            apiKeyEnvRef: '$MOLTNET_LIVE_STRUCTURED_API_KEY',
            models: [{ id: modelId!, supportsStrictMode: true }],
          },
        },
      });
      const runtime = await ModelRuntime.create({
        authPath: join(piDir, 'auth.json'),
        modelsPath: join(piDir, 'models.json'),
        refreshOnCreate: false,
      });
      const model = runtime.getModel(provider!, modelId!);
      expect(model).toBeDefined();

      const response = await runtime.completeSimple(
        model!,
        {
          messages: [
            {
              role: 'user',
              content: 'Call structured_probe with kind "probe" and count 7.',
              timestamp: Date.now(),
            },
          ],
          tools: [
            {
              name: 'structured_probe',
              description: 'Return the requested probe result.',
              parameters: schema,
              constrainedSampling: { type: 'json_schema', strict: 'require' },
            },
          ],
        },
        {
          apiKey,
          signal: AbortSignal.timeout(60_000),
          onPayload: (request) => {
            payload = request;
          },
        },
      );

      if (api === 'openai-completions') {
        const request = payload as {
          tools?: Array<{ function?: { strict?: boolean } }>;
        };
        expect(request.tools?.[0]?.function?.strict).toBe(true);
      }
      expect(response.stopReason, response.errorMessage).not.toBe('error');
      const call = response.content.find(
        (part) => part.type === 'toolCall' && part.name === 'structured_probe',
      );
      expect(call).toBeDefined();
      expect(
        Value.Check(
          schema,
          call?.type === 'toolCall' ? call.arguments : undefined,
        ),
      ).toBe(true);

      const contract = getSubmitOutputContract('fulfill_brief');
      expect(contract).not.toBeNull();
      payload = undefined;
      const taskResponse = await runtime.completeSimple(
        model!,
        {
          messages: [
            {
              role: 'user',
              content:
                'Call submit_fulfill_brief_output with branch "probe", commits [], pullRequestUrl null, diaryEntryIds [], and summary "Probe complete".',
              timestamp: Date.now(),
            },
          ],
          tools: [
            {
              name: contract!.toolName,
              description: contract!.description,
              parameters: contract!.parametersSchema,
              constrainedSampling: { type: 'json_schema', strict: 'prefer' },
            },
          ],
        },
        {
          apiKey,
          signal: AbortSignal.timeout(60_000),
          onPayload: (request) => {
            payload = request;
          },
        },
      );
      if (api === 'openai-completions') {
        const request = payload as {
          tools?: Array<{ function?: { strict?: boolean } }>;
        };
        expect(request.tools?.[0]?.function?.strict).toBe(true);
      }
      expect(taskResponse.stopReason, taskResponse.errorMessage).not.toBe(
        'error',
      );
      const taskCall = taskResponse.content.find(
        (part) => part.type === 'toolCall' && part.name === contract!.toolName,
      );
      expect(taskCall).toBeDefined();
      expect(
        Value.Check(
          contract!.parametersSchema,
          taskCall?.type === 'toolCall' ? taskCall.arguments : undefined,
        ),
      ).toBe(true);
    } finally {
      rmSync(piDir, { recursive: true, force: true });
    }
  }, 75_000);
});
