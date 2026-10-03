import { homedir } from 'node:os';
import { join } from 'node:path';

import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import {
  createClassificationTaskExecutor,
  type OllamaDecisionOptions,
  registerOllamaDecisionModels,
} from '@themoltnet/pi-runtime';

import { loadConfig } from './config.js';
import type { DaemonRuntimeAdapter } from './runtime.js';

/** Trusted runtime module for direct classification without a coding sandbox. */
export function createClassificationDaemonAdapter(options: {
  id: string;
  version: string;
  ollama?: OllamaDecisionOptions;
  piAuthDir?: string;
}): DaemonRuntimeAdapter {
  const runtimeKind = 'pi_classify';
  return {
    runtimeKind,
    async prepare({ profile }) {
      if (profile.runtimeKind !== runtimeKind)
        throw new Error('Classification runtime kind mismatch');
      return {
        runtimeKind,
        sessionPersistence: 'none',
        manifest: {
          schemaVersion: 'moltnet:executor-manifest:v1',
          runtime: {
            id: options.id,
            version: options.version,
            kind: runtimeKind,
            engine: 'pi',
            sandbox: 'none',
          },
          profile: { id: profile.id, definitionCid: profile.definitionCid },
          classification: {
            version: 1,
            ...(options.ollama ? { ollama: options.ollama } : {}),
          },
          tools: [],
          extensions: [],
          executables: [],
        },
        tools: [],
        executables: [],
        createTaskExecutor({ provider, model: modelId }) {
          return async (claimed, reporter) => {
            const piDir =
              options.piAuthDir ??
              (loadConfig().piCodingAgentDir || undefined) ??
              join(homedir(), '.pi', 'agent');
            const models = await ModelRuntime.create({
              authPath: join(piDir, 'auth.json'),
              modelsPath: join(piDir, 'models.json'),
            });
            if (options.ollama)
              registerOllamaDecisionModels(models, options.ollama);
            const model = models.getModelOfType(
              'classifier',
              provider,
              modelId,
            );
            if (!model)
              throw new Error(
                `Classifier ${provider}/${modelId} is not registered`,
              );
            return createClassificationTaskExecutor({ models, model })(
              claimed,
              reporter,
            );
          };
        },
      };
    },
  };
}
