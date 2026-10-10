import { executionCapabilityOfferFromPiManifest } from '@moltnet/execution-integrations/pi';
import {
  agentSigningCapability,
  buildPiClassifierExecutorManifest,
  buildPiExecutorManifest,
  createPiTaskExecutor,
  defineGondolinTemplate,
  definePiRuntime,
  GONDOLIN_BASE_EXECUTABLES,
  GONDOLIN_TOOL_NAMES,
  MOLTNET_TOOL_NAMES,
  type PiExecutorManifest,
  type PiRuntimeDefinition,
} from '@themoltnet/pi-runtime';

import { registerRuntimeExecutionOffer } from './lib/runtime-governance.js';
import type { DaemonRuntimeAdapter, PreparedDaemonRuntime } from './runtime.js';

export const PI_KERNEL_TOOL_NAMES = [
  ...GONDOLIN_TOOL_NAMES,
  'subagent',
  ...MOLTNET_TOOL_NAMES,
] as const;

export function createPiDaemonAdapter(
  runtime: PiRuntimeDefinition,
): DaemonRuntimeAdapter {
  const templateCache = new Map<
    string,
    Promise<Awaited<ReturnType<PiRuntimeDefinition['vm']['resolve']>>>
  >();

  const resolveTemplate = (onProgress?: (message: string) => void) => {
    const key = `${runtime.vm.id}\0${runtime.vm.version}`;
    const cached = templateCache.get(key);
    if (cached) return cached;
    const pending = runtime.vm.resolve({ onProgress });
    templateCache.set(key, pending);
    void pending.catch(() => templateCache.delete(key));
    return pending;
  };

  return {
    runtimeKind: runtime.runtimeKind,
    async prepare(input): Promise<PreparedDaemonRuntime> {
      if (input.profile.runtimeKind !== runtime.runtimeKind) {
        throw new Error(
          `Runtime profile ${input.profile.id} requires "${input.profile.runtimeKind}", ` +
            `but this daemon adapter provides "${runtime.runtimeKind}".`,
        );
      }
      const builtInToolNames = [
        ...(input.profile.models.generation ? PI_KERNEL_TOOL_NAMES : []),
        ...(input.profile.models.generation &&
        input.profile.models.classification
          ? ['classify']
          : []),
      ];
      const resolvedTemplate = input.profile.models.generation
        ? await resolveTemplate(input.onProgress)
        : null;
      let manifest: PiExecutorManifest;
      if (resolvedTemplate) {
        manifest = await buildPiExecutorManifest({
          runtime,
          profile: input.profile,
          template: resolvedTemplate,
          builtInToolNames,
        });
      } else if (input.profile.models.classification) {
        manifest = buildPiClassifierExecutorManifest({
          runtime,
          profile: input.profile,
          classifier: input.profile.models.classification,
        });
      } else {
        throw new Error('Runtime profile has no model configured');
      }
      const extensionTools = resolvedTemplate
        ? runtime.extensions.flatMap((extension) => extension.declaredTools)
        : [];
      const prepared: PreparedDaemonRuntime = {
        runtimeKind: runtime.runtimeKind,
        manifest: manifest as unknown as Record<string, unknown>,
        tools: [
          ...builtInToolNames,
          ...(resolvedTemplate
            ? runtime.tools.map((tool) => tool.descriptor.name)
            : []),
          ...extensionTools,
        ],
        executables: resolvedTemplate?.executables ?? [],
        createTaskExecutor: (options) =>
          createPiTaskExecutor({
            ...options,
            sandboxConfig: {
              ...options.sandboxConfig,
              // VM construction and resume provisioning are operator-owned.
              // Never execute legacy profile-supplied provisioning fields.
              snapshot: undefined,
              resumeCommands: undefined,
            },
            runtimeDefinition: runtime,
            resolvedVmTemplate: resolvedTemplate ?? undefined,
          }),
      };
      registerRuntimeExecutionOffer(prepared, (executorFingerprint) =>
        executionCapabilityOfferFromPiManifest(manifest, {
          executorFingerprint,
        }),
      );
      return prepared;
    },
  };
}

export const defaultPiRuntimeDefinition = definePiRuntime({
  id: 'moltnet-default-pi',
  version: '1',
  vm: defineGondolinTemplate({
    id: 'moltnet-default-gondolin',
    version: '1',
    executables: GONDOLIN_BASE_EXECUTABLES,
  }),
  hostCapabilities: [agentSigningCapability],
});

export const defaultPiDaemonAdapter = createPiDaemonAdapter(
  defaultPiRuntimeDefinition,
);
