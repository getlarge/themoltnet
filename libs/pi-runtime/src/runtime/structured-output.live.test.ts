/** Opt-in provider probe: run with MOLTNET_LIVE_STRUCTURED_* environment variables. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { validateToolArguments } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { getSubmitOutputContract } from '@themoltnet/agent-runtime';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';

import { writePiConfig } from '../pi-config.js';
import { createSubmitOutputTool } from './submit-output-tool.js';

const provider = process.env['MOLTNET_LIVE_STRUCTURED_PROVIDER'];
const api = process.env['MOLTNET_LIVE_STRUCTURED_API'];
const baseUrl = process.env['MOLTNET_LIVE_STRUCTURED_BASE_URL'];
const modelId = process.env['MOLTNET_LIVE_STRUCTURED_MODEL'];
const apiKey = process.env['MOLTNET_LIVE_STRUCTURED_API_KEY'];
const enabled = !!(provider && api && baseUrl && modelId && apiKey);

describe.skipIf(!enabled)('live structured tool output', () => {
  it('sends strict schema through Pi and captures normalized task output', async () => {
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
      const submit = createSubmitOutputTool('fulfill_brief', {
        inputCid: 'bafy-live-probe',
        input: {
          brief: 'Live structured-output probe',
          successCriteria: {
            version: 1,
            gates: [
              {
                id: 'submit-output',
                kind: 'submit-tool-call',
                description: 'Submit valid structured output.',
                required: true,
              },
            ],
          },
        },
      });
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
      if (taskCall?.type !== 'toolCall') {
        throw new Error('Provider did not return the submit tool call');
      }
      const rawSchemaValid = Value.Check(
        contract!.parametersSchema,
        taskCall.arguments,
      );
      // Strict providers can still return optional nulls or malformed
      // verification; exercise the same repair and validation path as Pi.
      const prepared =
        submit.tool.prepareArguments?.(taskCall.arguments) ??
        taskCall.arguments;
      const validated = validateToolArguments(
        {
          name: contract!.toolName,
          description: contract!.description,
          parameters: contract!.parametersSchema,
        },
        { ...taskCall, arguments: prepared as Record<string, never> },
      );
      const result = await (
        submit.tool as unknown as {
          execute: (
            id: string,
            params: Record<string, unknown>,
          ) => Promise<{ isError?: boolean }>;
        }
      ).execute('live-probe', validated);
      expect(result.isError).toBeFalsy();
      expect(
        Value.Check(contract!.parametersSchema, submit.getCaptured()),
      ).toBe(true);
      expect(submit.getCallCount()).toBe(1);
      console.info(
        'live structured output:',
        JSON.stringify({
          provider,
          modelId,
          rawSchemaValid,
          captured: submit.getCallCount() === 1,
          repairKinds: submit.getCapturedRepairKinds(),
        }),
      );
    } finally {
      rmSync(piDir, { recursive: true, force: true });
    }
  }, 75_000);
});
