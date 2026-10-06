import { executionCapabilityOfferFromPiManifest } from '@moltnet/execution-integrations/pi';
import {
  agentSigningCapability,
  buildPiExecutorManifest,
  createGondolinDurableTaskExecutor,
  defineGondolinTemplate,
  definePiRuntime,
  GONDOLIN_BASE_EXECUTABLES,
  GONDOLIN_TOOL_NAMES,
  MOLTNET_TOOL_NAMES,
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
      if (
        runtime.extensions.some(
          (extension) => extension.kind !== 'durable_extension',
        )
      ) {
        throw new Error(
          'Migrate coding-agent session extensions to definePiExtension({ extension: nativeDurableExtension })',
        );
      }
      const builtInToolNames = [
        ...PI_KERNEL_TOOL_NAMES,
        ...(input.profile.models.classification ? ['classify'] : []),
      ];
      const resolvedTemplate = await resolveTemplate(input.onProgress);
      const manifest = await buildPiExecutorManifest({
        runtime,
        profile: input.profile,
        template: resolvedTemplate,
        builtInToolNames,
      });
      const extensionTools = runtime.extensions.flatMap(
        (extension) => extension.declaredTools,
      );
      const prepared: PreparedDaemonRuntime = {
        runtimeKind: runtime.runtimeKind,
        manifest: {
          ...manifest,
          durability: {
            format: 'pi-durable.v1',
            recovery: 'same-agent-valid-lease',
            workspace: 'persistent-mount',
          },
        },
        tools: [
          ...builtInToolNames,
          ...runtime.tools.map((tool) => tool.descriptor.name),
          ...extensionTools,
        ],
        executables: resolvedTemplate.executables,
        createTaskExecutor: (options) =>
          createGondolinDurableTaskExecutor({
            ...options,
            runtimeDefinition: runtime,
            template: resolvedTemplate,
            runtimeKind: runtime.runtimeKind,
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
  version: '2',
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
