import {
  buildPiExecutorManifest,
  createPiTaskExecutor,
  defineGondolinTemplate,
  definePiRuntime,
  GONDOLIN_BASE_EXECUTABLES,
  GONDOLIN_TOOL_NAMES,
  MOLTNET_TOOL_NAMES,
  type PiRuntimeDefinition,
} from '@themoltnet/pi-runtime';
import { createExecutorAttestor } from '@themoltnet/sdk';

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
      const resolvedTemplate = await resolveTemplate(input.onProgress);
      const manifest = await buildPiExecutorManifest({
        runtime,
        profile: input.profile,
        template: resolvedTemplate,
        builtInToolNames: PI_KERNEL_TOOL_NAMES,
      });
      const attestor = await createExecutorAttestor({
        manifest: manifest as unknown as Record<string, unknown>,
        configDir: input.configDir,
      });
      const extensionTools = runtime.extensions.flatMap(
        (extension) => extension.declaredTools,
      );
      return {
        runtimeKind: runtime.runtimeKind,
        manifest: manifest as unknown as Record<string, unknown>,
        attestor,
        tools: [
          ...PI_KERNEL_TOOL_NAMES,
          ...runtime.tools.map((tool) => tool.descriptor.name),
          ...extensionTools,
        ],
        executables: resolvedTemplate.executables,
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
            resolvedVmTemplate: resolvedTemplate,
          }),
      };
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
});

export const defaultPiDaemonAdapter = createPiDaemonAdapter(
  defaultPiRuntimeDefinition,
);
