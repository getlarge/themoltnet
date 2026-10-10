import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  ClassifierApi,
  ClassifierContext,
  ClassifierModel,
  ClassifierResult,
} from '@earendil-works/pi-ai';
import { classify } from '@earendil-works/pi-ai/api/typesafe-system-one';
import {
  ModelRuntime,
  type ToolDefinition,
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
import stripJsonComments from 'strip-json-comments';
import { Type } from 'typebox';
import { Value } from 'typebox/value';

import { resolvePiCodingAgentDir } from '../config.js';
import { PI_CLASSIFIER_API } from '../pi-config.js';
import {
  classifyProviderFailure,
  sanitizeProviderDiagnostic,
} from './provider-error-classification.js';

const ClassifierDeclaration = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    type: Type.Literal('classifier'),
    api: Type.Optional(Type.Literal(PI_CLASSIFIER_API)),
    contextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
    input: Type.Optional(
      Type.Array(Type.Union([Type.Literal('text'), Type.Literal('image')])),
    ),
  },
  { additionalProperties: false },
);

/** One provider catalog and Pi-owned credential resolver; codemode is only a consumer. */
export async function createRuntimeModels(
  piDir: string,
): Promise<ModelRuntime> {
  const modelsPath = join(piDir, 'models.json');
  const models = await ModelRuntime.create({
    authPath: join(piDir, 'auth.json'),
    modelsPath,
  });
  if (models.getError()) return models;
  let document: {
    providers?: Record<
      string,
      { baseUrl?: string; models?: Array<{ id: string; type?: string }> }
    >;
  };
  try {
    document = JSON.parse(
      stripJsonComments(
        (await readFile(modelsPath, 'utf8')).replace(/^\uFEFF/u, ''),
      ),
    ) as typeof document;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return models;
    throw error;
  }
  for (const [provider, config] of Object.entries(document.providers ?? {})) {
    const declarations = config.models ?? [];
    if (
      declarations.some(
        (model) =>
          model.type !== undefined &&
          model.type !== 'chat' &&
          model.type !== 'classifier',
      )
    )
      throw new Error(`Unsupported model type for provider "${provider}"`);
    const classifiers = declarations.filter(
      (model) => model.type === 'classifier',
    );
    if (!classifiers.length) continue;
    if (!Value.Check(Type.Array(ClassifierDeclaration), classifiers))
      throw new Error(
        `Invalid classifier declaration for provider "${provider}"`,
      );
    // The daemon's model declarations have unique ids. Reject ambiguous config
    // rather than let Pi's chat-only JSON loader silently replace a chat model.
    if (
      new Set(declarations.map((model) => model.id)).size !==
      declarations.length
    )
      throw new Error(`Duplicate model declaration for provider "${provider}"`);
    const ids = new Set(classifiers.map((model) => model.id));
    models.registerProvider(provider, {
      baseUrl: config.baseUrl,
      classifiers: { [PI_CLASSIFIER_API]: { classify } },
      models: [
        // Pi 1.0's JSON loader constructs chat models even for classifier entries.
        // Remove those interpretations and replace existing classifiers by id;
        // retain every other Pi-composed model, override and provider credential.
        ...models
          .getAllModels(provider)
          .filter((model) => !ids.has(model.id) || model.type === 'image'),
        ...classifiers.map((model) => ({
          ...model,
          type: 'classifier' as const,
          api: model.api ?? PI_CLASSIFIER_API,
          contextWindow: model.contextWindow ?? 8192,
          name: model.id,
          input: model.input ?? ['text' as const],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        })),
      ],
    });
  }
  return models;
}

export interface ClassifierSelection {
  provider: string;
  model: string;
}

type Classifier = {
  models: Pick<ModelRuntime, 'classify'>;
  model: ClassifierModel<ClassifierApi>;
};

export function resolveClassifier(
  models: ModelRuntime,
  selection: ClassifierSelection,
): Classifier {
  const model = models.getModelOfType(
    'classifier',
    selection.provider,
    selection.model,
  );
  if (!model)
    throw new Error(
      `Classifier ${selection.provider}/${selection.model} is not registered`,
    );
  return { models, model };
}

function classificationOutput(
  result: ClassifierResult,
  input: ClassifyInput,
): ClassifyOutput {
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
  return output;
}

/** Expose the profile-selected classifier without replacing the chat model. */
export function createClassifierTool(classifier: Classifier) {
  return {
    name: 'classify',
    label: 'Classify',
    description: `Classify bounded state using the configured ${classifier.model.provider}/${classifier.model.id} classifier. Answers are model predictions, not authorization.`,
    parameters: ClassifyInput,
    async execute(_id: string, input: ClassifyInput, signal?: AbortSignal) {
      signal?.throwIfAborted();
      if (!Value.Check(ClassifyInput, input))
        throw new Error('Invalid classification input');
      const result = await classifier.models.classify(
        classifier.model,
        {
          state: input.state,
          questions: input.questions,
        } as ClassifierContext,
        { signal },
      );
      signal?.throwIfAborted();
      if (result.stopReason !== 'stop')
        throw new Error(
          sanitizeProviderDiagnostic(result.errorMessage ?? result.stopReason),
        );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(classificationOutput(result, input)),
          },
        ],
        details: {},
      };
    },
  } satisfies ToolDefinition<typeof ClassifyInput>;
}

/** Same task executor and provider credentials, without constructing a coding VM. */
export async function executeProfileClassificationTask(
  selection: ClassifierSelection | null | undefined,
  ...args: Parameters<TaskExecutor>
) {
  if (!selection)
    throw new Error('This runtime profile has no classifier configured');
  const models = await createRuntimeModels(resolvePiCodingAgentDir());
  return createClassificationTaskExecutor(resolveClassifier(models, selection))(
    ...args,
  );
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
    let providerFailure: ReturnType<typeof classifyProviderFailure> | undefined;
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
      let result: ClassifierResult;
      try {
        result = await options.models.classify(
          options.model,
          {
            state: input.state,
            questions: input.questions,
          } as ClassifierContext,
          { signal: reporter.cancelSignal },
        );
      } catch (error) {
        if (!reporter.cancelSignal.aborted)
          providerFailure = classifyProviderFailure(
            error instanceof Error ? error.message : undefined,
          );
        throw error;
      }
      if (result.usage) {
        usage.inputTokens = result.usage.input;
        usage.outputTokens = result.usage.output;
        usage.cacheReadTokens = result.usage.cacheRead;
        usage.cacheWriteTokens = result.usage.cacheWrite;
      }
      if (result.stopReason !== 'stop') {
        const failure =
          result.stopReason === 'aborted'
            ? undefined
            : classifyProviderFailure(result.errorMessage ?? result.stopReason);
        outcome = {
          ...base,
          status: result.stopReason === 'aborted' ? 'cancelled' : 'failed',
          output: null,
          outputCid: null,
          usage,
          durationMs: Date.now() - started,
          error: {
            code: failure?.code ?? 'classification_failed',
            message: sanitizeProviderDiagnostic(
              result.errorMessage ?? result.stopReason,
            ),
            retryable: failure?.retryable ?? false,
          },
        };
      } else {
        const output = classificationOutput(result, input);
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
          code: providerFailure?.code ?? 'classification_failed',
          message: sanitizeProviderDiagnostic(
            error instanceof Error ? error.message : 'Classification failed',
          ),
          retryable: providerFailure?.retryable ?? false,
        },
      };
    } finally {
      await reporter.close();
    }
  };
}
