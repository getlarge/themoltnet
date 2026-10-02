import type {
  ClassifierApi,
  ClassifierContext,
  ClassifierModel,
} from '@earendil-works/pi-ai';
import { classify } from '@earendil-works/pi-ai/api/typesafe-system-one';
import {
  createCodemodeExtension,
  type ExtensionAPI,
  type ModelRuntime,
} from '@earendil-works/pi-coding-agent';
import { computeJsonCid } from '@moltnet/crypto-service/json-cid';
import {
  CLASSIFY_TYPE,
  ClassifyInput,
  ClassifyOutput,
  type TaskOutput,
  type TaskUsage,
  validateClassifyOutput,
} from '@moltnet/tasks';
import type { TaskExecutor } from '@themoltnet/agent-runtime';
import { Value } from 'typebox/value';

import { sanitizeProviderDiagnostic } from './runtime/execute-pi-task.js';
import { definePiExtension } from './runtime-definition.js';

/** Explicit capability contribution: native codemode remains subject to tool policy. */
export function piCodemode() {
  return definePiExtension({
    id: 'moltnet-codemode-v1',
    declaredTools: ['codemode'],
    factory: (pi) =>
      createCodemodeExtension()({
        ...pi,
        // Installing this contribution is the operator's explicit activation.
        registerTool: (tool) =>
          pi.registerTool({ ...tool, defaultActive: true }),
      }),
  });
}

export interface OllamaDecisionOptions {
  baseUrl?: string;
  models: readonly { id: string; contextWindow: number }[];
}

/** Separate provider identity prevents replacing the operator's Ollama chat catalog. */
export function registerOllamaDecisionModels(
  target:
    | Pick<ExtensionAPI, 'registerProvider'>
    | Pick<ModelRuntime, 'registerProvider'>,
  options: OllamaDecisionOptions,
): void {
  target.registerProvider('ollama-decision', {
    baseUrl: options.baseUrl ?? 'http://127.0.0.1:11434/v1',
    apiKey: 'ollama',
    classifiers: { 'typesafe-system-one': { classify } },
    models: options.models.map((model) => ({
      type: 'classifier' as const,
      id: model.id,
      name: model.id,
      contextWindow: model.contextWindow,
      api: 'typesafe-system-one',
      input: ['text' as const],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    })),
  });
}

export function ollamaDecisionExtension(options: OllamaDecisionOptions) {
  return (pi: ExtensionAPI) => registerOllamaDecisionModels(pi, options);
}

/** The direct task path uses the same Pi model operation as native codemode. */
export function createClassificationTaskExecutor(options: {
  models: Pick<ModelRuntime, 'classify'>;
  model: ClassifierModel<ClassifierApi>;
}): TaskExecutor {
  return async (claimed, reporter) => {
    const started = Date.now();
    const usage: TaskUsage = {
      inputTokens: 0,
      outputTokens: 0,
      provider: options.model.provider,
      model: options.model.id,
    };
    const base = { taskId: claimed.task.id, attemptN: claimed.attemptN };
    let outcome: TaskOutput;
    try {
      await reporter.open(base);
      reporter.cancelSignal.throwIfAborted();
      if (
        claimed.task.taskType !== CLASSIFY_TYPE ||
        !Value.Check(ClassifyInput, claimed.task.input)
      ) {
        throw new Error('Expected a valid classify task');
      }
      const input = claimed.task.input;
      const result = await options.models.classify(
        options.model,
        { state: input.state, questions: input.questions } as ClassifierContext,
        { signal: reporter.cancelSignal },
      );
      if (result.usage) {
        usage.inputTokens = result.usage.input;
        usage.outputTokens = result.usage.output;
        usage.cacheReadTokens = result.usage.cacheRead;
        usage.cacheWriteTokens = result.usage.cacheWrite;
      }
      if (result.stopReason !== 'stop') {
        outcome = {
          ...base,
          status: result.stopReason === 'aborted' ? 'cancelled' : 'failed',
          output: null,
          outputCid: null,
          usage,
          durationMs: Date.now() - started,
          error: {
            code: 'classification_failed',
            message: sanitizeProviderDiagnostic(
              result.errorMessage ?? result.stopReason,
            ),
            retryable: false,
          },
        };
      } else {
        const output: ClassifyOutput = {
          version: 1,
          provider: result.provider,
          model: result.model,
          answers: result.answers,
          ...(result.usage
            ? {
                usage: {
                  inputTokens: result.usage.input,
                  outputTokens: result.usage.output,
                },
              }
            : {}),
        };
        if (!Value.Check(ClassifyOutput, output))
          throw new Error('Invalid classifier response');
        const error = validateClassifyOutput(output, input);
        if (error) throw new Error(error);
        reporter.cancelSignal.throwIfAborted();
        outcome = {
          ...base,
          status: 'completed',
          output,
          outputCid: await computeJsonCid(output),
          usage,
          durationMs: Date.now() - started,
        };
      }
      await reporter.finalize(usage);
      return outcome;
    } catch (error) {
      return {
        ...base,
        status: reporter.cancelSignal.aborted ? 'cancelled' : 'failed',
        output: null,
        outputCid: null,
        usage,
        durationMs: Date.now() - started,
        error: {
          code: 'classification_failed',
          message: sanitizeProviderDiagnostic(
            error instanceof Error ? error.message : 'Classification failed',
          ),
          retryable: false,
        },
      };
    } finally {
      await reporter.close();
    }
  };
}
