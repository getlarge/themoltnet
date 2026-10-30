/**
 * Opt-in model-only shape probe for the committed structure scenarios.
 *
 * Run from the repo root with:
 * MOLTNET_LIVE_CODEX_STRUCTURE=1 pnpm exec nx run @themoltnet/pi-runtime:test --run src/runtime/structured-output.codex.live.test.ts --skipNxCache
 *
 * This calls the scenario outputContract directly as a strict function tool.
 * It measures Pi/Codex sampling before MoltNet submit-tool repair or task
 * acceptance; the daemon baseline remains the end-to-end protocol measure.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';

const enabled = process.env.MOLTNET_LIVE_CODEX_STRUCTURE === '1';
const modelId = process.env.MOLTNET_LIVE_CODEX_MODEL ?? 'gpt-6-sol';
const repeats = Number(process.env.MOLTNET_LIVE_CODEX_REPEATS ?? '4');
const authPath =
  process.env.MOLTNET_LIVE_CODEX_AUTH_PATH ??
  join(homedir(), '.config', 'moltnet', 'pi', 'auth.json');
const corpusRoot = join(import.meta.dirname, '../../../..', 'evals-v2');
const scenarioSlugs = ['structure-release-risk', 'structure-signal-triage'];

interface ShapeProbeCell {
  scenario: string;
  run: number;
  strict: boolean;
  stopReason: string | null;
  toolCalls: number;
  shapeValid: boolean;
  error?: string;
}

describe.skipIf(!enabled)('Codex strict output-contract shape probe', () => {
  it('measures raw tool arguments before runtime repair', async () => {
    if (!Number.isInteger(repeats) || repeats < 1) {
      throw new Error('MOLTNET_LIVE_CODEX_REPEATS must be a positive integer');
    }
    if (!existsSync(authPath)) {
      throw new Error(
        'Pi Codex login missing; run moltnet-agent providers login openai-codex',
      );
    }
    const runtime = await ModelRuntime.create({
      authPath,
      modelsPath: join(dirname(authPath), 'models.json'),
      refreshOnCreate: false,
    });
    const model = runtime.getModel('openai-codex', modelId);
    if (!model) {
      throw new Error(
        runtime.getError() ?? `openai-codex/${modelId} was not found`,
      );
    }

    const cells: ShapeProbeCell[] = [];
    for (const slug of scenarioSlugs) {
      const scenarioDir = join(corpusRoot, slug);
      const prompt = readFileSync(join(scenarioDir, 'prompt.md'), 'utf8');
      const evalConfig = JSON.parse(
        readFileSync(join(scenarioDir, 'eval.json'), 'utf8'),
      ) as { outputContract: { schema: TSchema } };
      const schema = evalConfig.outputContract.schema;

      for (let run = 1; run <= repeats; run++) {
        const cell: ShapeProbeCell = {
          scenario: slug,
          run,
          strict: false,
          stopReason: null,
          toolCalls: 0,
          shapeValid: false,
        };
        try {
          const response = await runtime.completeSimple(
            model,
            {
              messages: [
                {
                  role: 'user',
                  content: `${prompt}\n\nCall submit_result with the structured assessment.`,
                  timestamp: Date.now(),
                },
              ],
              tools: [
                {
                  name: 'submit_result',
                  description: 'Submit the structured assessment.',
                  parameters: schema,
                  constrainedSampling: {
                    type: 'json_schema',
                    strict: 'require',
                  },
                },
              ],
            },
            {
              signal: AbortSignal.timeout(90_000),
              onPayload: (payload) => {
                const request = payload as {
                  tools?: Array<{ name?: string; strict?: boolean }>;
                };
                cell.strict =
                  request.tools?.find((tool) => tool.name === 'submit_result')
                    ?.strict === true;
              },
            },
          );
          cell.stopReason = response.stopReason;
          const calls = response.content.filter(
            (part) => part.type === 'toolCall' && part.name === 'submit_result',
          );
          cell.toolCalls = calls.length;
          cell.shapeValid =
            calls.length === 1 &&
            calls[0]?.type === 'toolCall' &&
            Value.Check(schema, calls[0].arguments);
          if (response.errorMessage) cell.error = response.errorMessage;
        } catch (error) {
          cell.error = error instanceof Error ? error.message : String(error);
        }
        cells.push(cell);
        console.log(
          `[codex-shape] ${slug} ${run}/${repeats}: ${cell.shapeValid ? 'PASS' : 'FAIL'} strict=${cell.strict} stop=${cell.stopReason ?? 'none'}`,
        );
      }
    }

    const outPath = resolve(
      process.env.MOLTNET_LIVE_CODEX_OUT ??
        join(tmpdir(), 'moltnet-codex-structure-probe.json'),
    );
    writeFileSync(
      outPath,
      JSON.stringify(
        { provider: 'openai-codex', model: modelId, cells },
        null,
        2,
      ) + '\n',
      'utf8',
    );
    expect(cells).toHaveLength(scenarioSlugs.length * repeats);
    expect(cells.every((cell) => cell.strict)).toBe(true);
  }, 3_600_000);
});
